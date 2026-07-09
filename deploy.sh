#!/bin/bash

# Ensure local workspace binaries are in the path (e.g. locally downloaded Terraform)
export PATH="$PATH:$(pwd)/.bin"

# Exit immediately if any command exits with a non-zero status
set -e


# Setup clean log styling
BOLD='\033[1;32m'
NC='\033[0m' # No Color
INFO='\033[1;34m'
WARN='\033[1;33m'

echo -e "${BOLD}===================================================================${NC}"
echo -e "${BOLD}   GCP Project Bootstrap & Consolidated Cloud Run Deployment        ${NC}"
echo -e "${BOLD}===================================================================${NC}"

# Check for required parameters
if [ "$#" -lt 2 ]; then
  echo -e "${WARN}Usage: $0 <PROJECT_ID> <BILLING_ACCOUNT_ID> [REGION]${NC}"
  echo ""
  echo "Arguments:"
  echo "  PROJECT_ID          The unique ID of the new GCP project to create (e.g. hr-vacation-lab-123)"
  echo "  BILLING_ACCOUNT_ID  Your billing account ID to link the new project (e.g. 012345-6789AB-CDEF01)"
  echo "  REGION              (Optional) Deployment region. Defaults to us-central1"
  echo ""
  exit 1
fi

PROJECT_ID="$1"
BILLING_ACCOUNT_ID="$2"
REGION="${3:-us-central1}"
REPO_NAME="ce-sample-hr-vacation-repo"

echo -e "${INFO}[1/7] Initializing GCP Configuration...${NC}"
# Check if user is logged into gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
  echo "Error: You do not appear to be logged in to gcloud. Please run 'gcloud auth login' first."
  exit 1
fi

# Create project if it doesn't exist
echo "Checking if project $PROJECT_ID exists..."
if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
  echo "Project $PROJECT_ID already exists. Using existing project."
else
  echo "Creating new GCP project: $PROJECT_ID..."
  gcloud projects create "$PROJECT_ID" --name="AlloyDB HR Vacation Lab"
fi

# Link project to billing
echo "Linking project $PROJECT_ID to billing account $BILLING_ACCOUNT_ID..."
gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT_ID"

# Set current project context
echo "Setting gcloud project context to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

echo -e "${INFO}[2/7] Enabling Required Google APIs (this can take up to 2-3 minutes)...${NC}"
gcloud services enable \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  vpcaccess.googleapis.com \
  alloydb.googleapis.com \
  dns.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com

echo -e "${INFO}[3/7] Creating Artifact Registry Repository...${NC}"
if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
  echo "Repository $REPO_NAME already exists in region $REGION."
else
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Classroom HR Vacation Application Registry"
fi

echo -e "${INFO}[4/7] Submitting Monolithic App Image Build to Google Cloud Build...${NC}"
gcloud builds submit --tag "${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/app:latest" .

echo -e "${INFO}[5/7] Generating Terraform tfvars File...${NC}"
cat <<EOF > terraform/terraform.tfvars
project_id = "$PROJECT_ID"
region     = "$REGION"
zone       = "${REGION}-a"
EOF
echo "Variables written to terraform/terraform.tfvars"

echo -e "${INFO}[6/7] Initializing and Running Terraform...${NC}"
cd terraform
terraform init
terraform apply -auto-approve
cd ..

echo -e "${BOLD}===================================================================${NC}"
echo -e "${BOLD} 🎉 Project Bootstrap & AlloyDB Deployment Completed Successfully! ${NC}"
echo -e "${BOLD}===================================================================${NC}"
echo "Project ID:        $PROJECT_ID"
echo "Region:            $REGION"
echo ""
echo "👉 NEXT STEPS FOR STUDENTS:"
echo "1. Retrieve your Global Load Balancer IP address from the Terraform outputs or the GCP Console."
echo "2. Access the Load Balancer IP over HTTPS (using the self-signed certificate)."
echo "3. Complete the Lab Challenges listed in the portal to explore AlloyDB failovers and read scaling!"
echo "==================================================================="
