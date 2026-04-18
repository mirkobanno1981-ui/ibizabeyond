#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="europe-west1"
REPO_NAME="ibizabeyond-repo"
VM_NAME="ibizabeyond-unified"
ZONE="europe-west1-b"

echo "Setting up GCP Project: $PROJECT_ID"

# 1. Enable APIs
echo "Enabling necessary APIs..."
gcloud services enable \
    compute.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com

# 2. Create Artifact Registry (if skip if exists)
echo "Ensuring Artifact Registry exists..."
gcloud artifacts repositories create $REPO_NAME \
    --repository-format=docker \
    --location=$REGION \
    --description="Ibiza Beyond Docker repository" 2>/dev/null || echo "Repo already exists"

# 3. Build & Push Frontend to GCP
echo "Building and pushing Frontend..."
gcloud builds submit --config cloudbuild.yaml .

# 4. Create VM Instance with Docker pre-installed (using COS - Container Optimized OS or standard Debian with script)
# We use Debian 12 and install Docker for more flexibility with Docker Compose
echo "Creating VM instance $VM_NAME..."
gcloud compute instances create $VM_NAME \
    --zone=$ZONE \
    --machine-type=e2-medium \
    --network-interface=network-tier=PREMIUM,stack-type=IPV4_ONLY,subnet=default \
    --maintenance-policy=MIGRATE \
    --provisioning-model=STANDARD \
    --service-account=$(gcloud iam service-accounts list --filter="displayName:default" --format="value(email)") \
    --scopes=https://www.googleapis.com/auth/cloud-platform \
    --tags=http-server,https-server \
    --create-disk=auto-delete=yes,boot=yes,device-name=$VM_NAME,image=projects/debian-cloud/global/images/debian-12-bookworm-v20240312,mode=rw,size=20,type=projects/$PROJECT_ID/zones/$ZONE/diskTypes/pd-balanced \
    --no-shielded-secure-boot \
    --shielded-vtpm \
    --shielded-integrity-monitoring \
    --labels=goog-ec-src=vm_add-gcloud \
    --metadata=startup-script="#!/bin/bash
    sudo apt-get update
    sudo apt-get install -y docker.io docker-compose git
    sudo systemctl start docker
    sudo systemctl enable docker
    
    # Clone the repository (User needs to provide a token or SSH key if private)
    mkdir -p /app
    cd /app
    git clone https://github.com/mirkobanno1981-ui/ibizabeyond.git .
    
    # Start n8n
    docker-compose -f docker-compose.n8n.yml up -d
    "

# 5. Open Firewall ports
echo "Configuring Firewall..."
gcloud compute firewall-rules create allow-http-https-n8n \
    --direction=INGRESS \
    --priority=1000 \
    --network=default \
    --action=ALLOW \
    --rules=tcp:80,tcp:443,tcp:5678 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=http-server,https-server

echo "############################################################"
echo "# VM setup started!"
echo "# 1. Wait a few minutes for the VM to initialize."
echo "# 2. Get External IP: gcloud compute instances list --filter='name=$VM_NAME'"
echo "# 3. n8n will be available at http://[EXTERNAL_IP]:5678"
echo "# IMPORTANT: You may need to update WEBHOOK_URL in .env.n8n"
echo "############################################################"
gcloud compute instances list --filter="name=$VM_NAME"
