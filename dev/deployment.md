# 실전 배포 가이드 (실제 경험 기반)

이 문서는 실제 배포 과정에서 겪은 문제들과 해결 방법을 순서대로 정리한 가이드입니다.

---

## 배포 전 체크리스트

- [ ] Node.js v20+ 설치 확인
- [ ] AWS CLI v2 설치 확인
- [ ] AWS CDK CLI v2.170+ 설치 확인
- [ ] Docker 설치 확인
- [ ] AWS 계정 및 프로필 설정 완료
- [ ] Anthropic API Key 준비

---

## 1단계: 프로젝트 준비

### 1-1. 저장소 클론 및 의존성 설치

```bash
# 저장소 클론
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# 의존성 설치
npm install

# 보안 취약점 수정 (선택사항)
npm audit fix
```

> **문제 발생 시**: [npm audit 가이드](./npmaudit.md) 참고

### 1-2. 환경변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 편집
# AWS_PROFILE=your-profile-name
# AWS_REGION=ap-northeast-2
# FARGATE_CPU=1024
# FARGATE_MEMORY=2048
```

**주의**: `.env` 파일에 주석이나 빈 줄이 있으면 export 시 에러 발생

```bash
# 환경변수 로드 (주석 제거)
export $(grep -v '^#' .env | xargs)

# 확인
echo $AWS_PROFILE
echo $AWS_REGION
```

### 1-3. TypeScript 빌드

```bash
# 전체 빌드
npm run build
```

> **빌드 에러 발생 시**: [TypeScript 빌드 문제 해결](./troubleshooting.md#typescript-빌드-실패-serverless-openclawshared-모듈을-찾을-수-없음) 참고

**가장 흔한 에러**: `@serverless-openclaw/shared` 모듈을 찾을 수 없음

**해결 방법**:
```bash
# shared 패키지 강제 재빌드
rm -f packages/shared/tsconfig.tsbuildinfo
npx tsc --build packages/shared/tsconfig.json --force

# 전체 재빌드
npm run build
```

### 1-4. Web UI 빌드 (필수!)

```bash
cd packages/web
npx vite build
cd ../..
```

**중요**: 이 단계를 건너뛰면 CDK synth 시 에러 발생
```
ValidationError: Cannot find asset at /path/to/packages/web/dist
```

---

## 2단계: AWS 계정 준비

### 2-1. AWS 프로필 확인

```bash
# 프로필 설정 확인
aws configure list --profile $AWS_PROFILE

# 계정 ID 확인
aws sts get-caller-identity --profile $AWS_PROFILE
```

### 2-2. CDK Bootstrap

```bash
# 계정 ID 가져오기
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --profile $AWS_PROFILE)

# CDK Bootstrap (계정당 1회만 실행)
npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION --profile $AWS_PROFILE
```

---

## 3단계: Secrets 준비

### 3-1. 필요한 Secret 값 준비

| Secret | 생성 방법 | 필수 여부 |
|--------|----------|----------|
| BridgeAuthToken | `openssl rand -hex 32` | 필수 |
| OpenclawGatewayToken | `openssl rand -hex 32` | 필수 |
| AnthropicApiKey | [Anthropic Console](https://console.anthropic.com/) | 필수 |
| TelegramBotToken | @BotFather에서 생성 | 선택 |
| TelegramWebhookSecret | `openssl rand -hex 32` | 선택 (Telegram 사용 시) |

> **OpenclawGatewayToken 생성 방법**: [상세 가이드](./openclaw-gateway-token-setup.md) 참고

### 3-2. SecretsStack 배포

**중요**: `packages/cdk` 디렉토리에서 실행해야 함!

```bash
# packages/cdk로 이동
cd packages/cdk

# Without Telegram (권장 - 나중에 추가 가능)
npx cdk deploy SecretsStack \
  --parameters "BridgeAuthToken=$(openssl rand -hex 32)" \
  --parameters "OpenclawGatewayToken=$(openssl rand -hex 32)" \
  --parameters "AnthropicApiKey=<YOUR_ANTHROPIC_API_KEY>" \
  --parameters "TelegramBotToken=unused" \
  --parameters "TelegramWebhookSecret=unused" \
  --profile $AWS_PROFILE
```

**배포 확인**:
```bash
# CloudFormation 스택 확인
aws cloudformation describe-stacks \
  --stack-name SecretsStack \
  --profile $AWS_PROFILE

# SSM Parameter 확인
aws ssm get-parameter \
  --name /serverless-openclaw/secrets/openclaw-gateway-token \
  --with-decryption \
  --profile $AWS_PROFILE
```

---

## 4단계: 인프라 배포

### 4-1. 전체 스택 배포

```bash
# packages/cdk 디렉토리에서 실행
npx cdk deploy --all --profile $AWS_PROFILE --require-approval broadening
```

**예상 소요 시간**: 10-15분

**배포 순서** (자동):
1. NetworkStack (VPC, Subnets, Security Groups)
2. StorageStack (DynamoDB, S3, ECR)
3. AuthStack (Cognito)
4. ComputeStack (ECS Cluster, Task Definition)
5. ApiStack (API Gateway, Lambda Functions)
6. WebStack (CloudFront, S3 Web Hosting)

### 4-2. 개별 스택 배포 (선택사항)

문제 발생 시 개별 배포로 디버깅:

```bash
# 1. 기본 인프라
npx cdk deploy NetworkStack --profile $AWS_PROFILE
npx cdk deploy StorageStack --profile $AWS_PROFILE

# 2. 인증 및 컴퓨팅
npx cdk deploy AuthStack --profile $AWS_PROFILE
npx cdk deploy ComputeStack --profile $AWS_PROFILE

# 3. API 및 Lambda
npx cdk deploy ApiStack --profile $AWS_PROFILE

# 4. Web UI
npx cdk deploy WebStack --profile $AWS_PROFILE
```

---

## 5단계: Docker 이미지 배포

### 5-1. ECR 로그인

```bash
# 루트 디렉토리로 이동
cd ../..

# ECR 로그인
aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### 5-2. Docker 이미지 빌드 및 푸시

```bash
# 이미지 빌드
docker build -f packages/container/Dockerfile -t serverless-openclaw .

# 이미지 태그
docker tag serverless-openclaw:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest

# ECR에 푸시
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
```

**또는 스크립트 사용**:
```bash
./scripts/deploy-image.sh
```

---

## 6단계: 배포 확인

### 6-1. CDK Output 확인

```bash
# WebStack Output
aws cloudformation describe-stacks \
  --stack-name WebStack \
  --query "Stacks[0].Outputs" \
  --profile $AWS_PROFILE

# ApiStack Output
aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs" \
  --profile $AWS_PROFILE
```

### 6-2. 주요 Output 값

| Output Key | 용도 |
|-----------|------|
| `WebStack.WebAppUrl` | Web UI 접속 URL |
| `ApiStack.WebSocketApiEndpoint` | WebSocket 연결 URL |
| `ApiStack.HttpApiEndpoint` | REST API URL |
| `AuthStack.UserPoolId` | Cognito User Pool ID |
| `AuthStack.UserPoolClientId` | Cognito Client ID |

---

## 7단계: 테스트 사용자 생성

### 7-1. Cognito 사용자 생성

```bash
# Makefile 사용 (권장)
make user-create EMAIL=test@example.com PASS="TestPass123!"

# 또는 수동
aws cognito-idp sign-up \
  --client-id <CLIENT_ID> \
  --username test@example.com \
  --password "TestPass123!" \
  --user-attributes Name=email,Value=test@example.com \
  --profile $AWS_PROFILE

aws cognito-idp admin-confirm-sign-up \
  --user-pool-id <USER_POOL_ID> \
  --username test@example.com \
  --profile $AWS_PROFILE
```

### 7-2. Web UI 접속 테스트

1. `WebStack.WebAppUrl`로 접속
2. 생성한 계정으로 로그인
3. 채팅 메시지 전송 테스트

---

## 흔한 문제 및 해결 방법

### 문제 1: `--app is required` 에러

**원인**: 잘못된 디렉토리에서 cdk 명령어 실행

**해결**:
```bash
cd packages/cdk
npx cdk deploy ...
```

### 문제 2: `Cannot find asset at packages/web/dist`

**원인**: Web UI 빌드 안 함

**해결**:
```bash
cd packages/web
npx vite build
cd ../..
```

### 문제 3: `@serverless-openclaw/shared` 모듈 에러

**원인**: TypeScript composite 빌드 캐시 문제

**해결**:
```bash
rm -f packages/shared/tsconfig.tsbuildinfo
npx tsc --build packages/shared/tsconfig.json --force
npm run build
```

### 문제 4: Docker 이미지 푸시 실패

**원인**: ECR 로그인 안 됨

**해결**:
```bash
aws ecr get-login-password --region $AWS_REGION --profile $AWS_PROFILE \
  | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

---

## Telegram 추가 (선택사항)

나중에 Telegram을 추가하려면: [Telegram 추가 가이드](./add-telegram-later.md)

---

## 배포 완료 체크리스트

- [ ] SecretsStack 배포 완료
- [ ] 모든 CDK 스택 배포 완료 (6개)
- [ ] Docker 이미지 ECR에 푸시 완료
- [ ] Cognito 테스트 사용자 생성 완료
- [ ] Web UI 접속 및 로그인 성공
- [ ] 채팅 메시지 전송 테스트 성공

---

## 다음 단계

- [Telegram 추가하기](./add-telegram-later.md)
- [문제 해결 가이드](./troubleshooting.md)
- [로컬 테스트](./localtest.md)

---

**작성일**: 2025-02-17  
**기반**: 실제 배포 경험 및 발생한 문제들
