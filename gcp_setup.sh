#!/bin/bash

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="europe-west1"
SERVICE_NAME="ibizabeyond-frontend"
REPO_NAME="ibizabeyond-repo"

echo "Using Project ID: $PROJECT_ID"

# 1. Enable needed APIs
echo "Enabling APIs..."
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com

# 2. Create Artifact Registry repository
echo "Creating Artifact Registry repository..."
gcloud artifacts repositories create $REPO_NAME \
    --repository-format=docker \
    --location=$REGION \
    --description="Ibiza Beyond Docker repository"

# 3. List next steps
echo "############################################################"
echo "# Setup Complete!"
echo "############################################################"
echo "# To deploy your project, run:"
echo "# gcloud builds submit --config cloudbuild.yaml ."
echo "############################################################"
