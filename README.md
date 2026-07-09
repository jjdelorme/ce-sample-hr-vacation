# HR Vacation Request Subsystem - Interactive Classroom Simulator

Welcome to the **Vacation Request Subsystem** lab application! This repository contains a fully containerized, interactive web simulator designed for students and system architects to learn about Google Cloud Platform (GCP) private network designs, relational vs. NoSQL transaction patterns, and high-availability mitigation strategies.

---

## 📖 Scenario Overview

The Vacation Request Subsystem handles scheduling and accrued balance logic for international subsidiaries across the **Retail, Healthcare, and Financial Services** sectors. 

Currently, the application runs as a **single-region** service isolated inside a private Google Cloud Virtual Private Cloud (VPC) network. All services communicate internally, securely shielded from public internet exposure.

### Core Google Cloud Services Used:
1. **Cloud Run (app)**: Serves the consolidated monolithic application container (both UI and transactional API) with strict internal-only ingress, so it can be accessed strictly through the load balancer.
2. **AlloyDB for PostgreSQL**: Primary enterprise-grade relational database management system, handling workflows, notifications, employees, and accrual balances with multi-region active-passive disaster recovery.
3. **Cloud DNS**: Manages private DNS zones inside our Virtual Private Cloud to abstract database hostnames and support zero-code-change regional failovers.
4. **Virtual Private Cloud (VPC)**: The private networking boundary. Utilizes **Serverless VPC Access connectors** and **Private Service Connect / Private Service Networking** to isolate the database and serverless runtimes inside internal networks.

---

## 🧪 Simulation Features

This application embeds a beautiful **Diagnostics & Sim playground** that lets you learn interactively:
* **Role Swap Selector**: Take on roles ranging from a sales associate in the US to clinical directors in the UK and VP of Compliance in Japan. Swapping roles updates your profile context, department boundaries, and accrual balances.
* **Animated Network Topology**: Submitting a request triggers a live, animated traffic trace across a Google Cloud architecture diagram. Watch the packet route from the **Browser** to the **GCLB**, down to the **Cloud Run App**, through the private VPC gateway, down to the **AlloyDB Cluster** in real time.
* **Real-Time DB Inspectors**:
  * **Mock AlloyDB Console**: Watch consolidated relational tables (`employees`, `accrual_balances`, `departments`, `workflows`, `notifications`) change as you submit requests or approve them.
* **Interactive Rules Validation Engine**: Experience industry-grade regulatory limits:
  * **Retail Blackouts**: Restricts requests during holiday shopping rushes (Nov 15 - Jan 5) without VP escalation.
  * **Healthcare On-Call Coverage**: Restricts time off if more than 30% of a department's staff are off concurrently (ensuring 70%+ patient safety coverage).
  * **Financial Quarter Close Constraints**: Blocks scheduling requests during the final 5 business days of fiscal quarters for SOX/audit regulations. Enforces block-leave policies of at least 10 consecutive business days.

---

## 🛠️ Getting Started Locally

You can spin up this application locally using standard Node.js or Docker.

### Running with Node.js:
1. Ensure you have Node.js 18+ installed.
2. Initialize dependencies:
   ```bash
   npm install
   ```
3. Boot the server:
   ```bash
   npm start
   ```
4. Access the portal in your browser at `http://localhost:8080`.

### Running with Docker:
1. Build the local image:
   ```bash
   docker build -t hr-vacation-app .
   ```
2. Run the container on port 8080:
   ```bash
   docker run -p 8080:8080 hr-vacation-app
   ```

---

## ☁️ Deploying to Google Cloud

To deploy this application to your active Google Cloud Platform (GCP) project, we provide a single, unified bootstrapping and deployment script (`deploy.sh`) in the root of the project.

This script automates:
1. Project creation (if needed) and billing account linkage.
2. Enabling required services: `compute.googleapis.com`, `servicenetworking.googleapis.com`, `vpcaccess.googleapis.com`, `alloydb.googleapis.com`, `dns.googleapis.com`, `run.googleapis.com`, `artifactregistry.googleapis.com`, `cloudbuild.googleapis.com`.
3. Creating the Artifact Registry repository.
4. Submitting a single monolithic container image build to Cloud Build.
5. Automatically writing localized parameters to `terraform/terraform.tfvars`.
6. Executing `terraform init` and `terraform apply` to deploy all private resources, AlloyDB cluster and instances, Serverless NEG, and GCLB load balancer.

Run the script as follows:
```bash
chmod +x deploy.sh
./deploy.sh <PROJECT_ID> <BILLING_ACCOUNT_ID> [REGION]
```

By default, the application is deployed as a **secure single-region service** inside `us-central1`. To fulfill the organizational security policies:
1. Ingress to the Cloud Run service is locked to load balancing only.
2. An **External HTTP/HTTPS Application Load Balancer (GCLB)** is configured to front the Cloud Run service, serving traffic securely.

---

## 🎓 Coursework: Upgrading to Multi-Region Load Balancing

To support low-latency global transactions for subsidiaries in Europe and Asia, students must upgrade the baseline single-region configuration into a **highly available, multi-regional topology**. 

Follow these step-by-step instructions to update your application code and IaC templates to be multi-regional:

### Step 1: Declare a Second Regional Cloud Run App Service
In `terraform/main.tf`, declare a new regional Cloud Run app service in a second region (e.g., `europe-west1`):
```hcl
resource "google_cloud_run_v2_service" "app_europe" {
  name     = "hr-vacation-app-europe"
  location = "europe-west1"
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app_repo.repository_id}/app:latest"
      ports {
        container_port = 8080
      }
      env {
        name  = "DB_WRITE_HOST"
        value = "write-db.hr-vacation.internal"
      }
      env {
        name  = "DB_READ_HOST"
        value = "read-db.hr-vacation.internal"
      }
      env {
        name  = "DB_PASS"
        value = random_password.alloydb_password.result
      }
    }
    # Enforce routing outbound traffic through Serverless VPC Connector
    vpc_access {
      connector = google_vpc_access_connector.vpc_connector.id
      egress    = "ALL_TRAFFIC"
    }
  }
}
```

### Step 2: Create a European Serverless NEG
Define a regional serverless Network Endpoint Group (NEG) targeting the new European Cloud Run app service:
```hcl
resource "google_compute_region_network_endpoint_group" "serverless_neg_europe" {
  name                  = "hr-vacation-neg-europe"
  network_endpoint_type = "SERVERLESS"
  region                = "europe-west1"
  cloud_run {
    service = google_cloud_run_v2_service.app_europe.name
  }
}
```

### Step 3: Register Both Regional NEGs to the Backend Service
Update the existing backend service (`google_compute_backend_service.backend_service`) to route traffic to both the US and Europe NEGs. GCLB will automatically direct clients to the nearest region using Anycast IP routing:
```hcl
resource "google_compute_backend_service" "backend_service" {
  name                  = "hr-vacation-backend-service"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  # Primary US Backend
  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }

  # Failover / Latency-Optimized Europe Backend
  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg_europe.id
  }
}
```

### Step 4: Configure Cross-Region AlloyDB Replication & Private DNS
To ensure highly available relational transactions and seamless regional failovers, configure an AlloyDB Primary cluster in `us-central1` and an asynchronous Secondary replica cluster in `europe-west1` with Continuous Storage-level log streaming. Declare the Secondary cluster and instance in Terraform:
```hcl
# AlloyDB Secondary DR Cluster in europe-west1
resource "google_alloydb_cluster" "secondary" {
  cluster_id   = "hr-vacation-cluster-secondary"
  location     = "europe-west1"
  cluster_type = "SECONDARY"

  network_config {
    network = google_compute_network.vpc_network.id
  }

  secondary_config {
    primary_cluster_name = google_alloydb_cluster.primary.name
  }

  deletion_protection = false
}

# Secondary replica instance in europe-west1
resource "google_alloydb_instance" "secondary_instance" {
  cluster       = google_alloydb_cluster.secondary.name
  instance_id   = "hr-vacation-secondary-instance"
  instance_type = "SECONDARY"

  machine_config {
    cpu_count = 2
  }

  depends_on = [google_alloydb_instance.primary_instance]
}
```

And map private DNS records inside Cloud DNS to provide abstraction endpoints:
```hcl
# Map DB_WRITE_HOST: write-db.hr-vacation.internal -> Primary AlloyDB IP
resource "google_dns_record_set" "write_dns" {
  name         = "write-db.hr-vacation.internal."
  managed_zone = google_dns_managed_zone.private_zone.name
  type         = "A"
  ttl          = 60
  rrdatas      = [google_alloydb_instance.primary_instance.ip_address]
}
```

### Step 5: Verify the Multi-Regional Setup & Failover
1. Apply the updated Terraform configuration (`terraform apply`).
2. Verify that GCLB forwards traffic to both `us-central1` and `europe-west1` based on user location.
3. Access the portal and inspect the simulated terminal logs. Confirm that requests are routed securely to the nearest database node!
4. Practice a simulated disaster recovery failover by promoting the Secondary AlloyDB cluster in `europe-west1` and redirecting Cloud DNS `write-db.hr-vacation.internal.` record to point to the promoted instance without redeploying the backend.
