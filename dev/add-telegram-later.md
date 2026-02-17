# Telegram 나중에 추가하기

## 개요

처음에 "Without Telegram"으로 배포한 후, 나중에 Telegram 기능을 추가하는 방법입니다.

## 전제 조건

- SecretsStack이 이미 배포되어 있음
- Telegram 파라미터를 `unused` 또는 placeholder 값으로 설정했음

## Telegram 추가 절차

### 1단계: Telegram Bot 생성

Telegram에서 봇을 생성하고 토큰을 받습니다.

```bash
# Telegram 앱 열기
# @BotFather 검색

# 봇 생성 명령어
/newbot

# 봇 이름 입력 (예: My OpenClaw)
# 봇 username 입력 (예: my_openclaw_bot, 반드시 'bot'으로 끝나야 함)

# BotFather가 제공하는 토큰 복사
# 예시: 123456789:ABCdefGHI...
```

### 2단계: SecretsStack 업데이트

새로운 Telegram 토큰으로 SecretsStack을 다시 배포합니다.

```bash
cd packages/cdk

# Telegram 토큰으로 업데이트
npx cdk deploy SecretsStack \
  --parameters "TelegramBotToken=<TOKEN_FROM_BOTFATHER>" \
  --parameters "TelegramWebhookSecret=$(openssl rand -hex 32)" \
  --profile $AWS_PROFILE
```

**중요**: 
- ✅ 다른 파라미터(BridgeAuthToken, OpenclawGatewayToken 등)는 **생략 가능**
- ✅ CloudFormation이 자동으로 이전 값 재사용 (`UsePreviousValue`)
- ✅ Telegram 관련 파라미터만 새 값으로 업데이트됨

### 3단계: 변경사항 확인

SSM Parameter Store에 새 값이 저장되었는지 확인합니다.

```bash
# Telegram Bot Token 확인
aws ssm get-parameter \
  --name /serverless-openclaw/secrets/telegram-bot-token \
  --with-decryption \
  --profile $AWS_PROFILE \
  --query 'Parameter.Value' \
  --output text

# Telegram Webhook Secret 확인
aws ssm get-parameter \
  --name /serverless-openclaw/secrets/telegram-webhook-secret \
  --with-decryption \
  --profile $AWS_PROFILE \
  --query 'Parameter.Value' \
  --output text
```

### 4단계: ApiStack 재배포 (선택사항)

ApiStack은 이미 Telegram webhook Lambda를 포함하고 있으므로, 대부분의 경우 재배포가 필요 없습니다. 하지만 확실하게 하려면:

```bash
cd packages/cdk

# ApiStack 재배포 (Lambda가 새 SSM 값 참조)
npx cdk deploy ApiStack --profile $AWS_PROFILE
```

### 5단계: Telegram Webhook 등록

배포 후 Telegram에 webhook URL을 등록합니다.

```bash
# Makefile 사용 (권장)
make telegram-webhook

# 또는 수동 등록
# 1. API Endpoint 확인
aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiEndpoint'].OutputValue" \
  --output text \
  --profile $AWS_PROFILE

# 2. Webhook Secret 가져오기
TELEGRAM_SECRET=$(aws ssm get-parameter \
  --name /serverless-openclaw/secrets/telegram-webhook-secret \
  --with-decryption \
  --query Parameter.Value \
  --output text \
  --profile $AWS_PROFILE)

# 3. Webhook 등록
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"<HTTP_API_ENDPOINT>/telegram\",
    \"secret_token\": \"$TELEGRAM_SECRET\"
  }"
```

### 6단계: 테스트

Telegram 봇에 메시지를 보내서 작동하는지 확인합니다.

```bash
# Telegram 앱에서 봇 검색
# 봇에게 메시지 전송: "Hello"

# 예상 응답:
# 1. "Waking up the agent..." (cold start)
# 2. AI 응답
```

## 전체 과정 요약

```bash
# 1. Telegram Bot 생성 (@BotFather)
# 토큰 복사: 123456789:ABCdefGHI...

# 2. SecretsStack 업데이트
cd packages/cdk
npx cdk deploy SecretsStack \
  --parameters "TelegramBotToken=123456789:ABCdefGHI..." \
  --parameters "TelegramWebhookSecret=$(openssl rand -hex 32)" \
  --profile $AWS_PROFILE

# 3. Webhook 등록
make telegram-webhook

# 4. 테스트
# Telegram 봇에 메시지 전송
```

## 주의사항

### ⚠️ TelegramWebhookSecret에 콜론(`:`) 사용 금지

Telegram webhook secret에는 **콜론(`:`)이 포함되면 안 됩니다**.

```bash
# ❌ 잘못된 예 (콜론 포함 가능)
openssl rand -base64 32

# ✅ 올바른 예 (hex는 콜론 없음)
openssl rand -hex 32
```

### 💡 다른 파라미터는 건드리지 않아도 됨

SecretsStack 재배포 시:
- ✅ Telegram 파라미터만 제공하면 됨
- ✅ BridgeAuthToken, OpenclawGatewayToken, AnthropicApiKey는 자동 재사용
- ✅ 이전 값을 다시 입력할 필요 없음

### 🔄 실행 중인 컨테이너 재시작 불필요

- Lambda는 다음 호출 시 자동으로 새 SSM 값 읽음
- Fargate 컨테이너는 Telegram 토큰을 사용하지 않음 (Lambda만 사용)
- 따라서 컨테이너 재시작 불필요

## 문제 해결

### Webhook 등록 실패

**증상**:
```json
{
  "ok": false,
  "error_code": 400,
  "description": "Bad Request: bad webhook: HTTPS url must be provided for webhook"
}
```

**원인**: HTTP URL 사용 (HTTPS 필요)

**해결**: API Gateway는 자동으로 HTTPS 제공. URL 확인:
```bash
aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiEndpoint'].OutputValue" \
  --output text \
  --profile $AWS_PROFILE
```

### Webhook 403 Forbidden

**증상**: Telegram 메시지 전송 시 응답 없음

**원인**: Secret token 불일치

**해결**:
```bash
# 1. 현재 webhook 상태 확인
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# 2. Webhook 재등록
make telegram-webhook
```

### Bot이 응답하지 않음

**확인 사항**:

1. **Webhook이 등록되었는지 확인**:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
   ```

2. **Lambda 로그 확인**:
   ```bash
   aws logs tail /aws/lambda/serverless-openclaw-telegram-webhook \
     --follow \
     --profile $AWS_PROFILE
   ```

3. **SSM 파라미터 확인**:
   ```bash
   aws ssm get-parameter \
     --name /serverless-openclaw/secrets/telegram-bot-token \
     --with-decryption \
     --profile $AWS_PROFILE
   ```

## 참고 자료

- [Telegram Bot API 문서](https://core.telegram.org/bots/api)
- [BotFather 가이드](https://core.telegram.org/bots#6-botfather)
- [Webhook 설정 가이드](https://core.telegram.org/bots/api#setwebhook)

---

**날짜**: 2025-02-17
