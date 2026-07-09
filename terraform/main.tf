terraform {
  required_version = ">= 1.3.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

# -------------------------------------------------------------
# 1. FOUNDATIONAL VIRTUAL PRIVATE CLOUD (VPC)
# -------------------------------------------------------------

resource "google_compute_network" "vpc_network" {
  name                    = "hr-vacation-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet_regional" {
  name          = "hr-vacation-subnet-us"
  ip_cidr_range = "10.0.1.0/24"
  network       = google_compute_network.vpc_network.id
  region        = var.region
}

# Serverless VPC Access Connector
resource "google_vpc_access_connector" "vpc_connector" {
  name          = "hr-vpc-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc_network.name
}

# Private Service Networking (For Private AlloyDB communication)
resource "google_compute_global_address" "private_ip_alloc" {
  name          = "private-ip-alloc-sql"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc_network.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc_network.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_alloc.name]
}

# -------------------------------------------------------------
# 2. RANDOM PASSWORD FOR ALLOYDB CLUSTER
# -------------------------------------------------------------

resource "random_password" "alloydb_password" {
  length  = 16
  special = false
}

# -------------------------------------------------------------
# 3. PRIMARY ALLOYDB CLUSTER & INSTANCE (us-central1)
# -------------------------------------------------------------

resource "google_alloydb_cluster" "primary" {
  cluster_id = "hr-vacation-cluster-primary"
  location   = var.region # us-central1
  
  network_config {
    network = google_compute_network.vpc_network.id
  }

  initial_user {
    password = random_password.alloydb_password.result
  }
}

# Primary read-write instance (2-vCPU node)
resource "google_alloydb_instance" "primary_instance" {
  cluster       = google_alloydb_cluster.primary.name
  instance_id   = "hr-vacation-primary-instance"
  instance_type = "PRIMARY"

  machine_config {
    cpu_count = 2
  }

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

# -------------------------------------------------------------
# 4. ZERO-CODE-CHANGE DNS ENDPOINTS (Cloud DNS Private Zone)
# -------------------------------------------------------------

resource "google_dns_managed_zone" "private_zone" {
  name        = "hr-vacation-private-zone"
  dns_name    = "hr-vacation.internal."
  description = "Internal Private Zone for DB abstraction and seamless failovers"
  
  visibility = "private"
  
  private_visibility_config {
    networks {
      network_url = google_compute_network.vpc_network.id
    }
  }
}

# Map DB_WRITE_HOST: write-db.hr-vacation.internal -> Primary AlloyDB Private IP
resource "google_dns_record_set" "write_dns" {
  name         = "write-db.hr-vacation.internal."
  managed_zone = google_dns_managed_zone.private_zone.name
  type         = "A"
  ttl          = 60
  rrdatas      = [google_alloydb_instance.primary_instance.ip_address]
}

# Map DB_READ_HOST: read-db.hr-vacation.internal -> Primary AlloyDB Private IP (resolving to local read pools)
resource "google_dns_record_set" "read_dns" {
  name         = "read-db.hr-vacation.internal."
  managed_zone = google_dns_managed_zone.private_zone.name
  type         = "A"
  ttl          = 60
  rrdatas      = [google_alloydb_instance.primary_instance.ip_address]
}

# -------------------------------------------------------------
# 5. ARTIFACT REGISTRY & COMPUTE LAYER (Cloud Run Services)
# -------------------------------------------------------------

resource "google_artifact_registry_repository" "app_repo" {
  repository_id = "ce-sample-hr-vacation-repo"
  format        = "DOCKER"
}

# Cloud Run (Monolithic Application Service)
resource "google_cloud_run_v2_service" "app_service" {
  name     = "hr-vacation-app"
  location = var.region
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

# Allow IAM invocation for GCLB / Authenticated proxy requests
resource "google_cloud_run_v2_service_iam_member" "app_public" {
  name     = google_cloud_run_v2_service.app_service.name
  location = google_cloud_run_v2_service.app_service.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# -------------------------------------------------------------
# 6. GLOBAL EXTERNAL LOAD BALANCER (GCLB)
# -------------------------------------------------------------

# Serverless NEG (Network Endpoint Group) targeting the Cloud Run Monolith
resource "google_compute_region_network_endpoint_group" "serverless_neg" {
  name                  = "hr-vacation-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run {
    service = google_cloud_run_v2_service.app_service.name
  }
}

# Backend Service for GCLB with IAP disabled
resource "google_compute_backend_service" "backend_service" {
  name                  = "hr-vacation-backend-service"
  protocol              = "HTTP"
  port_name             = "http"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.serverless_neg.id
  }
}

# Global URL Map mapping GCLB incoming paths to the serverless backend
resource "google_compute_url_map" "url_map" {
  name            = "hr-vacation-url-map"
  default_service = google_compute_backend_service.backend_service.id
}

# Target HTTP Proxy for plaintext dev validation
resource "google_compute_target_http_proxy" "http_proxy" {
  name    = "hr-vacation-http-proxy"
  url_map = google_compute_url_map.url_map.id
}

# Global HTTP Forwarding Rule
resource "google_compute_global_forwarding_rule" "http_forwarding_rule" {
  name                  = "hr-vacation-http-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_proxy.id
}

# Cryptographic resources for Load Balancer SSL Termination
resource "tls_private_key" "key" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "tls_self_signed_cert" "cert" {
  private_key_pem = tls_private_key.key.private_key_pem

  subject {
    common_name  = "hr-vacation.gcp-lab.internal"
    organization = "Google Cloud Lab Classroom"
  }

  validity_period_hours = 8760 # 1 year

  allowed_uses = [
    "key_encipherment",
    "digital_signature",
    "server_auth",
  ]
}

resource "google_compute_ssl_certificate" "self_signed" {
  name        = "hr-vacation-self-signed-cert"
  private_key = tls_private_key.key.private_key_pem
  certificate = tls_self_signed_cert.cert.cert_pem
}

# Target HTTPS Proxy for SSL termination at GCLB
resource "google_compute_target_https_proxy" "https_proxy" {
  name             = "hr-vacation-https-proxy"
  url_map          = google_compute_url_map.url_map.id
  ssl_certificates = [google_compute_ssl_certificate.self_signed.id]
}

# Global HTTPS Forwarding Rule
resource "google_compute_global_forwarding_rule" "https_forwarding_rule" {
  name                  = "hr-vacation-https-forwarding-rule"
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.https_proxy.id
}




