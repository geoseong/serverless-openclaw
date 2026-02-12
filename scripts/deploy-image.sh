#!/bin/bash
set -euo pipefail

# Deploy container image to ECR with optional SOCI index
# Usage: ./scripts/deploy-image.sh [--soci]
#
# Prerequisites:
#   - AWS CLI configured (profile via AWS_PROFILE or .env)
#   - Docker running
#   - For --soci: soci CLI installed (Linux only)
#     Install: https://github.com/awslabs/soci-snapshotter/releases

REGION="${AWS_REGION:-ap-northeast-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/serverless-openclaw"
ENABLE_SOCI=false

for arg in "$@"; do
  case $arg in
    --soci) ENABLE_SOCI=true ;;
  esac
done

echo "=== Build & Deploy Container Image ==="
echo "ECR: ${ECR_REPO}"
echo "SOCI: ${ENABLE_SOCI}"

# Step 1: Build
echo ""
echo "[1/4] Building Docker image..."
docker build -t serverless-openclaw:latest -f packages/container/Dockerfile .

# Step 2: Tag & Push
echo ""
echo "[2/4] Logging in to ECR..."
aws ecr get-login-password --region "${REGION}" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo ""
echo "[3/4] Pushing image to ECR..."
docker tag serverless-openclaw:latest "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

# Step 3: SOCI Index (optional, Linux only)
if [ "${ENABLE_SOCI}" = true ]; then
  echo ""
  echo "[4/4] Creating SOCI index..."

  if ! command -v soci &> /dev/null; then
    echo "ERROR: soci CLI not found. Install from:"
    echo "  https://github.com/awslabs/soci-snapshotter/releases"
    echo ""
    echo "Quick install (Linux amd64):"
    echo "  wget https://github.com/awslabs/soci-snapshotter/releases/latest/download/soci-snapshotter-grpc-linux-amd64.tar.gz"
    echo "  tar -xzf soci-snapshotter-grpc-linux-amd64.tar.gz"
    echo "  sudo mv soci /usr/local/bin/"
    exit 1
  fi

  # Pull image locally for soci to index
  docker pull "${ECR_REPO}:latest"

  # Create and push SOCI index
  soci create "${ECR_REPO}:latest"
  soci push "${ECR_REPO}:latest"

  echo "SOCI index pushed to ECR. Fargate will use lazy loading on next task launch."
else
  echo ""
  echo "[4/4] Skipping SOCI index (use --soci to enable, Linux only)"
fi

echo ""
echo "=== Deploy complete ==="
echo "Image: ${ECR_REPO}:latest"

# Check image size
IMAGE_SIZE=$(docker images serverless-openclaw:latest --format "{{.Size}}")
echo "Image size: ${IMAGE_SIZE}"
