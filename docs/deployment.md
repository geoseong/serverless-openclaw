# 배포 가이드

클린 AWS 계정에서 Serverless OpenClaw를 배포하는 전체 과정을 안내합니다.

---

## 1. 사전 요구사항

| 항목 | 최소 버전 | 확인 명령 |
|------|----------|----------|
| AWS CLI | v2 | `aws --version` |
| AWS CDK CLI | v2.170+ | `npx cdk --version` |
| Node.js | v20+ | `node -v` |
| Docker | 최신 | `docker --version` |
| npm | v9+ | `npm -v` |

### AWS 계정 설정

```bash
# AWS CLI 프로필 설정
aws configure --profile serverless-openclaw

# CDK Bootstrap (계정당 최초 1회)
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION> --profile serverless-openclaw
```

---

## 2. 시크릿 설정 (Secrets Manager)

배포 전에 AWS Secrets Manager에 3개의 시크릿을 수동 생성해야 합니다.

```bash
# Bridge 인증 토큰 (Lambda ↔ Fargate 통신용)
aws secretsmanager create-secret \
  --name "serverless-openclaw/bridge-auth-token" \
  --secret-string "<YOUR_BRIDGE_TOKEN>" \
  --profile serverless-openclaw

# OpenClaw Gateway 토큰
aws secretsmanager create-secret \
  --name "serverless-openclaw/openclaw-gateway-token" \
  --secret-string "<YOUR_GATEWAY_TOKEN>" \
  --profile serverless-openclaw

# Anthropic API 키
aws secretsmanager create-secret \
  --name "serverless-openclaw/anthropic-api-key" \
  --secret-string "<YOUR_ANTHROPIC_API_KEY>" \
  --profile serverless-openclaw
```

> **bridge-auth-token** 은 임의의 긴 문자열을 생성하여 사용합니다 (예: `openssl rand -hex 32`).

### Telegram 봇 사용 시 (선택)

```bash
# Telegram Bot Token (@BotFather에서 발급)
aws secretsmanager create-secret \
  --name "serverless-openclaw/telegram-bot-token" \
  --secret-string "<YOUR_TELEGRAM_BOT_TOKEN>" \
  --profile serverless-openclaw
```

---

## 3. 빌드

```bash
# 저장소 클론
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# 의존성 설치
npm install

# TypeScript 빌드
npm run build

# Web UI 빌드 (CDK synth 전에 반드시 필요)
cd packages/web && npx vite build && cd ../..
```

> **중요:** `packages/web/dist/` 디렉토리가 존재해야 CDK synth가 성공합니다. `WebStack`의 `BucketDeployment`가 이 경로의 존재를 검증합니다.

---

## 4. 배포

### 전체 스택 한 번에 배포

```bash
cd packages/cdk
npx cdk deploy --all --profile serverless-openclaw --require-approval broadening
```

### 스택별 순서 배포 (선택)

의존 관계에 따른 배포 순서:

```bash
cd packages/cdk

# 1단계: 기반 인프라
npx cdk deploy NetworkStack StorageStack --profile serverless-openclaw

# 2단계: 인증 + 컴퓨팅
npx cdk deploy AuthStack --profile serverless-openclaw
npx cdk deploy ComputeStack --profile serverless-openclaw

# 3단계: API Gateway + Lambda
npx cdk deploy ApiStack --profile serverless-openclaw

# 4단계: 웹 UI
npx cdk deploy WebStack --profile serverless-openclaw
```

### Docker 이미지 푸시

Fargate 컨테이너를 실행하려면 ECR에 Docker 이미지를 푸시해야 합니다.

```bash
# ECR 로그인
aws ecr get-login-password --region <REGION> --profile serverless-openclaw \
  | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

# 이미지 빌드 + 푸시
cd packages/container
docker build --platform linux/arm64 -t serverless-openclaw .
docker tag serverless-openclaw:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
```

---

## 5. 배포 후 설정

### Telegram Webhook 등록 (Telegram 사용 시)

배포 후 CDK Output에서 `HttpApiEndpoint` 값을 확인하고 webhook을 등록합니다.

```bash
# scripts/setup-telegram-webhook.sh 사용
chmod +x scripts/setup-telegram-webhook.sh
./scripts/setup-telegram-webhook.sh

# 또는 수동 등록
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<HTTP_API_ENDPOINT>/telegram",
    "secret_token": "<TELEGRAM_SECRET_TOKEN>"
  }'
```

### Cognito 테스트 사용자 생성

```bash
# 사용자 생성
aws cognito-idp sign-up \
  --client-id <USER_POOL_CLIENT_ID> \
  --username user@example.com \
  --password "YourPassword1!" \
  --profile serverless-openclaw

# 이메일 인증 (관리자 권한으로 강제 확인)
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <USER_POOL_ID> \
  --username user@example.com \
  --profile serverless-openclaw
```

---

## 6. 환경변수 참조표

CDK Output에서 확인할 수 있는 주요 값:

| CDK Output | 용도 |
|------------|------|
| `WebStack.WebAppUrl` | 웹 UI 접속 URL |
| `WebStack.DistributionDomainName` | CloudFront 도메인 |
| `ApiStack.WebSocketApiEndpoint` | WebSocket 연결 URL |
| `ApiStack.HttpApiEndpoint` | REST API + Telegram webhook URL |
| `AuthStack.UserPoolId` | Cognito User Pool ID |
| `AuthStack.UserPoolClientId` | Cognito App Client ID |
| `ComputeStack.ClusterArn` | ECS 클러스터 ARN |
| `StorageStack.EcrRepositoryUri` | Docker 이미지 푸시 대상 |

### 웹 UI 로컬 개발용 `.env.local`

```env
VITE_WS_URL=<ApiStack.WebSocketApiEndpoint>
VITE_API_URL=<ApiStack.HttpApiEndpoint>
VITE_COGNITO_USER_POOL_ID=<AuthStack.UserPoolId>
VITE_COGNITO_CLIENT_ID=<AuthStack.UserPoolClientId>
```

---

## 7. 검증

### 웹 UI 접속

1. `WebStack.WebAppUrl` (CloudFront URL)에 접속
2. 회원가입 또는 로그인
3. 채팅 메시지 전송 → 에이전트 응답 확인

### WebSocket 연결 테스트

```bash
# wscat 사용
npm install -g wscat
wscat -c "<WebSocketApiEndpoint>?token=<ID_TOKEN>"
> {"action":"sendMessage","data":{"message":"hello"}}
```

### Telegram 테스트

1. Telegram에서 봇에게 메시지 전송
2. "깨우는 중..." 응답 확인 (cold start)
3. 에이전트 응답 확인

### ECS 태스크 상태 확인

```bash
aws ecs list-tasks --cluster serverless-openclaw --profile serverless-openclaw
aws ecs describe-tasks --cluster serverless-openclaw --tasks <TASK_ARN> --profile serverless-openclaw
```

---

## 8. 업데이트 / 삭제

### 업데이트

```bash
# 코드 변경 후
npm run build
cd packages/web && npx vite build && cd ../..
cd packages/cdk && npx cdk deploy --all --profile serverless-openclaw
```

### OpenClaw 컨테이너 업데이트

```bash
# 새 이미지 빌드 + 푸시
cd packages/container
docker build --platform linux/arm64 -t serverless-openclaw .
docker tag serverless-openclaw:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/serverless-openclaw:latest

# 실행 중인 태스크가 있으면 재시작 (다음 요청 시 새 이미지로 기동)
```

### 전체 삭제

```bash
cd packages/cdk
npx cdk destroy --all --profile serverless-openclaw
```

> `removalPolicy: DESTROY`가 설정되어 있어 DynamoDB 테이블, S3 버킷, ECR 리포지토리가 함께 삭제됩니다. **프로덕션 데이터가 있다면 백업 후 삭제하세요.**

---

## 9. 트러블슈팅

### CDK synth 실패: `Cannot find asset`

```
Error: Cannot find asset at /path/to/packages/web/dist
```

**원인:** Web UI 빌드가 선행되지 않음
**해결:** `cd packages/web && npx vite build`

### CDK deploy 실패: `Secret not found`

```
Error: Secrets Manager can't find the specified secret
```

**원인:** Secrets Manager에 시크릿 미생성
**해결:** [2. 시크릿 설정](#2-시크릿-설정-secrets-manager) 참조

### Fargate 태스크 시작 실패

```bash
# CloudWatch 로그 확인
aws logs tail /ecs/serverless-openclaw --follow --profile serverless-openclaw
```

**일반적인 원인:**
- ECR에 이미지 미푸시 → Docker 이미지 빌드+푸시 수행
- Secrets Manager 접근 권한 부족 → CDK 재배포
- 메모리 부족 → `ComputeStack`에서 `memoryLimitMiB` 조정

### WebSocket 연결 실패

**원인:** Cognito ID 토큰 만료 또는 미전달
**해결:** 유효한 ID 토큰을 `?token=` 쿼리로 전달

### Telegram webhook 미응답

```bash
# Webhook 상태 확인
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

**일반적인 원인:**
- Webhook URL 미등록 → `scripts/setup-telegram-webhook.sh` 실행
- secret token 불일치 → Secrets Manager 값과 webhook 등록 시 사용한 값 확인
- Lambda 에러 → CloudWatch 로그에서 `telegram-webhook` 함수 확인
