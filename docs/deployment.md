# Deployment Guide

This guide covers the complete process for deploying Serverless OpenClaw on a clean AWS account.

---

## 1. Prerequisites

| Item | Minimum Version | Verification Command |
|------|----------------|---------------------|
| AWS CLI | v2 | `aws --version` |
| AWS CDK CLI | v2.170+ | `npx cdk --version` |
| Node.js | v20+ | `node -v` |
| Docker | Latest | `docker --version` |
| npm | v9+ | `npm -v` |

### AWS Account Setup

```bash
# Configure AWS CLI profile
aws configure --profile <YOUR_PROFILE_NAME>
```

### Configure `.env`

Copy the example file and set your AWS profile name:

```bash
cp .env.example .env
# Edit .env with your values:
#   AWS_PROFILE=your-aws-profile-name
#   AWS_REGION=ap-northeast-2
```

Then load the environment before running any AWS/CDK commands:

```bash
export $(cat .env | xargs)
```

> `.env` is in `.gitignore` and will not be committed. See `.env.example` for the template.

### CDK Bootstrap

```bash
# CDK Bootstrap (once per account)
export $(cat .env | xargs)
npx cdk bootstrap aws://<ACCOUNT_ID>/$AWS_REGION
```

---

## 2. Secret Setup (Secrets Manager)

Before deployment, you must manually create 3 secrets in AWS Secrets Manager.

```bash
# Bridge auth token (for Lambda ↔ Fargate communication)
aws secretsmanager create-secret \
  --name "serverless-openclaw/bridge-auth-token" \
  --secret-string "<YOUR_BRIDGE_TOKEN>" \
  --profile $AWS_PROFILE

# OpenClaw Gateway token
aws secretsmanager create-secret \
  --name "serverless-openclaw/openclaw-gateway-token" \
  --secret-string "<YOUR_GATEWAY_TOKEN>" \
  --profile $AWS_PROFILE

# Anthropic API key
aws secretsmanager create-secret \
  --name "serverless-openclaw/anthropic-api-key" \
  --secret-string "<YOUR_ANTHROPIC_API_KEY>" \
  --profile $AWS_PROFILE
```

> **bridge-auth-token** should be a randomly generated long string (e.g., `openssl rand -hex 32`).

### When Using Telegram Bot (Optional)

```bash
# Telegram Bot Token (issued by @BotFather)
aws secretsmanager create-secret \
  --name "serverless-openclaw/telegram-bot-token" \
  --secret-string "<YOUR_TELEGRAM_BOT_TOKEN>" \
  --profile $AWS_PROFILE
```

---

## 3. Build

```bash
# Clone the repository
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# Install dependencies
npm install

# TypeScript build
npm run build

# Web UI build (required before CDK synth)
cd packages/web && npx vite build && cd ../..
```

> **Important:** The `packages/web/dist/` directory must exist for CDK synth to succeed. `WebStack`'s `BucketDeployment` validates the existence of this path.

---

## 4. Deployment

### Deploy All Stacks at Once

```bash
cd packages/cdk
npx cdk deploy --all --profile $AWS_PROFILE --require-approval broadening
```

### Deploy Stacks Individually (Optional)

Deployment order based on dependencies:

```bash
cd packages/cdk

# Step 1: Base infrastructure
npx cdk deploy NetworkStack StorageStack --profile $AWS_PROFILE

# Step 2: Auth + Compute
npx cdk deploy AuthStack --profile $AWS_PROFILE
npx cdk deploy ComputeStack --profile $AWS_PROFILE

# Step 3: API Gateway + Lambda
npx cdk deploy ApiStack --profile $AWS_PROFILE

# Step 4: Web UI
npx cdk deploy WebStack --profile $AWS_PROFILE
```

### Push Docker Image

To run the Fargate container, you need to push a Docker image to ECR.

```bash
# ECR login
aws ecr get-login-password --region <REGION> --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# Build + push image
cd packages/container
docker build --platform linux/arm64 -t serverless-openclaw .
docker tag serverless-openclaw:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
```

---

## 5. Post-Deployment Configuration

### Register Telegram Webhook (When Using Telegram)

After deployment, check the `HttpApiEndpoint` value from CDK Output and register the webhook.

```bash
# Using scripts/setup-telegram-webhook.sh
chmod +x scripts/setup-telegram-webhook.sh
./scripts/setup-telegram-webhook.sh

# Or manual registration
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<HTTP_API_ENDPOINT>/telegram",
    "secret_token": "<TELEGRAM_SECRET_TOKEN>"
  }'
```

### Create Cognito Test User

```bash
# Create user
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username user@example.com \
  --password "YourPassword1!" \
  --profile $AWS_PROFILE

# Verify email (force confirm with admin privileges)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <USER_POOL_ID> \
  --username user@example.com \
  --profile $AWS_PROFILE
```

---

## 6. Environment Variables Reference

Key values available from CDK Output:

| CDK Output | Purpose |
|------------|---------|
| `WebStack.WebAppUrl` | Web UI access URL |
| `WebStack.DistributionDomainName` | CloudFront domain |
| `ApiStack.WebSocketApiEndpoint` | WebSocket connection URL |
| `ApiStack.HttpApiEndpoint` | REST API + Telegram webhook URL |
| `AuthStack.UserPoolId` | Cognito User Pool ID |
| `AuthStack.UserPoolClientId` | Cognito App Client ID |
| `ComputeStack.ClusterArn` | ECS cluster ARN |
| `StorageStack.EcrRepositoryUri` | Docker image push target |

### `.env.local` for Web UI Local Development

```env
VITE_WS_URL=<ApiStack.WebSocketApiEndpoint>
VITE_API_URL=<ApiStack.HttpApiEndpoint>
VITE_COGNITO_USER_POOL_ID=<AuthStack.UserPoolId>
VITE_COGNITO_CLIENT_ID=<AuthStack.UserPoolClientId>
```

---

## 7. Verification

### Web UI Access

1. Navigate to `WebStack.WebAppUrl` (CloudFront URL)
2. Sign up or log in
3. Send a chat message → verify agent response

### WebSocket Connection Test

```bash
# Using wscat
npm install -g wscat
wscat -c "<WebSocketApiEndpoint>?token=<ID_TOKEN>"
> {"action":"sendMessage","data":{"message":"hello"}}
```

### Telegram Test

1. Send a message to the bot in Telegram
2. Verify "Waking up..." response (cold start)
3. Verify agent response

### Check ECS Task Status

```bash
aws ecs list-tasks --cluster serverless-openclaw --profile $AWS_PROFILE
aws ecs describe-tasks --cluster serverless-openclaw --tasks <TASK_ARN> --profile $AWS_PROFILE
```

---

## 8. Update / Teardown

### Update

```bash
# After code changes
npm run build
cd packages/web && npx vite build && cd ../..
cd packages/cdk && npx cdk deploy --all --profile $AWS_PROFILE
```

### Update OpenClaw Container

```bash
# Build + push new image
cd packages/container
docker build --platform linux/arm64 -t serverless-openclaw .
docker tag serverless-openclaw:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest

# If there are running tasks, restart them (next request will launch with the new image)
```

### Full Teardown

```bash
cd packages/cdk
npx cdk destroy --all --profile $AWS_PROFILE
```

> Since `removalPolicy: DESTROY` is set, DynamoDB tables, S3 buckets, and ECR repositories will be deleted together. **If you have production data, back it up before deleting.**

---

## 9. Troubleshooting

### CDK synth failure: `Cannot find asset`

```
Error: Cannot find asset at /path/to/packages/web/dist
```

**Cause:** Web UI build was not run beforehand
**Solution:** `cd packages/web && npx vite build`

### CDK deploy failure: `Secret not found`

```
Error: Secrets Manager can't find the specified secret
```

**Cause:** Secrets not created in Secrets Manager
**Solution:** See [2. Secret Setup](#2-secret-setup-secrets-manager)

### Fargate Task Startup Failure

```bash
# Check CloudWatch logs
aws logs tail /ecs/serverless-openclaw --follow --profile $AWS_PROFILE
```

**Common causes:**
- Image not pushed to ECR → build and push Docker image
- Insufficient Secrets Manager access permissions → redeploy with CDK
- Insufficient memory → adjust `memoryLimitMiB` in `ComputeStack`

### WebSocket Connection Failure

**Cause:** Cognito ID token expired or not provided
**Solution:** Pass a valid ID token via `?token=` query parameter

### Telegram Webhook Not Responding

```bash
# Check webhook status
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

**Common causes:**
- Webhook URL not registered → run `scripts/setup-telegram-webhook.sh`
- Secret token mismatch → verify Secrets Manager value matches the value used during webhook registration
- Lambda error → check CloudWatch logs for `telegram-webhook` function
