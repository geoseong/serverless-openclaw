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

**ECR(Elastic Container Registry) 동작 원리**:
- ECR은 AWS의 Docker 이미지 저장소 (Docker Hub의 AWS 버전)
- Fargate는 ECR에서 이미지를 가져와서 컨테이너 실행
- 인증 시 username은 항상 `AWS`, password는 12시간 유효한 임시 토큰 사용
- 참고: [AWS ECR 인증 공식 문서](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)

**빌드 및 푸시 과정**:
1. 로컬에서 Docker 이미지 빌드 (`serverless-openclaw:latest`)
2. ECR 경로로 태그 추가 (같은 이미지에 ECR 주소 붙이기)
3. ECR에 푸시 (AWS 클라우드로 업로드)

```bash
# 이미지 빌드 (OpenClaw 다운로드 포함, 시간 소요)
docker build -f packages/container/Dockerfile -t serverless-openclaw .

# 이미지 태그 (ECR 경로 추가)
docker tag serverless-openclaw:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest

# ECR에 푸시
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
```

**또는 스크립트 사용**:
```bash
./scripts/deploy-image.sh
```

### 5-3. TaskState 리셋 (중요!)

**Docker 이미지를 재배포할 때마다 반드시 실행해야 함!**

**이유**: 
- 컨테이너가 실패하면 DynamoDB TaskState가 "Starting" 상태로 남음
- 새 컨테이너 시작 시 기존 TaskState가 있으면 "이미 실행 중"으로 판단하여 시작 안 됨
- 결과: 메시지 보내도 응답 없음

**해결 방법**:
```bash
# 1. 현재 TaskState 확인
aws dynamodb scan \
  --table-name serverless-openclaw-TaskState \
  --region $AWS_REGION \
  --profile $AWS_PROFILE \
  --query "Items[*].PK.S"

# 2. 사용자별 TaskState 삭제
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#<user-id>"}}' \
  --region $AWS_REGION \
  --profile $AWS_PROFILE
```

**예시**:
```bash
# 출력 예시:
# [
#     "USER#24a8ad7c-7021-70f6-7a7c-3e52faa2c335",
#     "USER#telegram:337607235"
# ]

# Web UI 사용자 삭제
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#24a8ad7c-7021-70f6-7a7c-3e52faa2c335"}}' \
  --region ap-northeast-2

# Telegram 사용자 삭제 (사용 시)
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#telegram:337607235"}}' \
  --region ap-northeast-2
```

**자동화 스크립트** (선택사항):
```bash
# 모든 TaskState 삭제 (Web UI + Telegram 모두)
aws dynamodb scan \
  --table-name serverless-openclaw-TaskState \
  --region $AWS_REGION \
  --profile $AWS_PROFILE \
  --query "Items[*].PK.S" \
  --output text | \
  xargs -I {} aws dynamodb delete-item \
    --table-name serverless-openclaw-TaskState \
    --key '{"PK":{"S":"{}"}}' \
    --region $AWS_REGION \
    --profile $AWS_PROFILE
```

**Telegram 사용 시 주의**:
- Telegram 사용자 ID는 `USER#telegram:<user-id>` 형식
- Web UI 사용자와 별도로 관리됨
- Telegram 메시지 전송 시에도 TaskState 확인 및 삭제 필요

**주의**: 
- TaskState 삭제는 실행 중인 컨테이너에 영향 없음
- 다음 메시지 전송 시 새 컨테이너가 시작됨
- 프로덕션 환경에서는 자동 정리 로직 추가 권장

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

### 7-3. Runtime Config 동작 원리 (참고)

**문제**: Web UI가 Cognito 설정을 어떻게 알아야 할까?

**해결**: Runtime Config 방식 사용
- WebStack 배포 시 `config.json` 자동 생성 및 S3 배포
- 브라우저가 앱 로드 시 `/config.json` 요청
- CloudFormation Output 값들이 자동으로 주입됨

**장점**:
- `.env` 파일에 plain 값 저장 불필요
- CloudFormation Output 변경 시 WebStack만 재배포
- Web 재빌드 불필요
- 값 변경이 자동으로 반영됨

**config.json 내용** (자동 생성):
```json
{
  "cognitoUserPoolId": "ap-northeast-2_lpJNz3cLy",
  "cognitoClientId": "4f6ucnfrf433v672kql4q3oudv",
  "webSocketUrl": "wss://xxx.execute-api.amazonaws.com/prod",
  "apiUrl": "https://xxx.execute-api.amazonaws.com"
}
```

**보안**: 이 값들은 공개되어도 안전함
- Cognito User Pool ID/Client ID는 브라우저 앱에서 필수로 노출
- 실제 인증은 사용자 이메일/비밀번호로 이루어짐
- API 접근은 Cognito JWT 토큰으로 보호됨
- 민감한 값(API Key 등)은 SSM Parameter에 암호화 저장

**구현 위치**:
- `packages/cdk/lib/stacks/web-stack.ts`: config.json 생성
- `packages/web/src/config.ts`: config 로드 로직
- `packages/web/src/main.tsx`: 앱 시작 전 config 로드

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
- [ ] **TaskState 리셋 완료 (Docker 재배포 시 필수!)**
- [ ] Cognito 테스트 사용자 생성 완료
- [ ] Web UI 접속 및 로그인 성공
- [ ] 채팅 메시지 전송 테스트 성공

---

## 재배포 시 주의사항

### Docker 이미지 재배포 시

**반드시 TaskState 리셋!**
```bash
# 1. TaskState 확인
aws dynamodb scan --table-name serverless-openclaw-TaskState --region $AWS_REGION --query "Items[*].PK.S"

# 2. 각 사용자별 삭제
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#<user-id>"}}' \
  --region $AWS_REGION
```

### ComputeStack 재배포 시

**DEPLOYMENT_VERSION 증가 필수!**
- `packages/cdk/lib/stacks/compute-stack.ts`에서 `DEPLOYMENT_VERSION` 값 증가
- Lambda가 새 TaskDefinition을 인식하도록 함
- ApiStack도 함께 재배포

```bash
# ComputeStack과 ApiStack 함께 배포
npx cdk deploy ComputeStack ApiStack --profile $AWS_PROFILE
```

---

## 다음 단계

- [Telegram 추가하기](./add-telegram-later.md)
- [문제 해결 가이드](./troubleshooting.md)
- [로컬 테스트](./localtest.md)

---

**작성일**: 2025-02-17  
**기반**: 실제 배포 경험 및 발생한 문제들
