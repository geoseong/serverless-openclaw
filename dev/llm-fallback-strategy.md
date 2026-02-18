# LLM 폴백 전략 및 프롬프트 캐싱

이 문서는 무료 LLM 사용량 초과 시 자동으로 다른 모델로 전환하는 방법과, Fargate 재시작 시 데이터를 유지하는 방법을 설명합니다.

---

## 1. LLM 무료 제한 및 폴백 전략

### 1-1. 각 LLM의 무료 제한

| 순위 | LLM | 무료 제한 | 초과 시 에러 |
|------|-----|----------|-------------|
| 1 | **GitHub Copilot Free** | 2,000 completions/월, 50 chat/월 | 429 Rate Limit |
| 2 | **OpenRouter (무료)** | 50 requests/일 (20 req/분) | 429 Rate Limit |
| 3 | **Ollama Cloud** | 제한 미공개 (추정: 수백~수천/일) | 429 Rate Limit |
| 4 | **Claude** | 무료 플랜 없음 (유료만) | - |

**참고**:
- OpenRouter: $10 충전 시 1,000 requests/일로 증가
- GitHub Copilot: Pro ($10/월) 시 무제한 (premium 모델 300회/월)
- Ollama Cloud: 정확한 제한 미공개

### 1-2. 폴백 전략

```
사용자 메시지
    ↓
1. GitHub Copilot (2,000/월)
    ↓ 429 에러
2. OpenRouter 무료 (50/일)
    ↓ 429 에러
3. Ollama Cloud (제한 높음)
    ↓ 429 에러
4. Claude (유료, 무제한)
    ↓
응답
```

---

## 2. OpenClaw 설정 (폴백 구현)

### 2-1. 설정 파일 구조

OpenClaw는 자동 폴백을 지원합니다:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "copilot/gpt-4o",
        "fallbacks": [
          "openrouter/google/gemini-flash-1.5:free",
          "ollama-cloud/gpt-oss:20b-cloud",
          "anthropic/claude-3-5-sonnet-20241022"
        ]
      }
    }
  }
}
```

**동작 방식**:
1. Primary 모델 시도
2. 429 에러 발생 시 첫 번째 fallback 시도
3. 또 429 에러 시 두 번째 fallback 시도
4. 최종적으로 Claude (유료) 사용

### 2-2. patch-config.ts 수정

`packages/container/src/patch-config.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { GATEWAY_PORT } from "@serverless-openclaw/shared";

interface PatchOptions {
  llmModel?: string;
}

export function patchConfig(configPath: string, options?: PatchOptions): void {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  // Set gateway port
  config.gateway = { ...config.gateway, port: GATEWAY_PORT };

  // Remove auth secrets from config (API keys delivered via env vars only)
  if (config.auth) {
    delete config.auth.token;
  }

  // Remove Telegram section entirely (webhook-only, configured via env)
  delete config.telegram;

  // 폴백 전략 설정
  config.models = {
    mode: "merge",
    providers: {
      // 1. GitHub Copilot
      "copilot": {
        baseUrl: process.env.COPILOT_BASE_URL || "https://api.githubcopilot.com",
        apiKey: process.env.COPILOT_API_KEY,
        api: "openai-completions",
        models: [
          {
            id: "gpt-4o",
            name: "GitHub Copilot GPT-4o",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 128000,
            maxTokens: 8192
          }
        ]
      },
      // 2. OpenRouter (무료)
      "openrouter": {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        api: "openai-completions",
        models: [
          {
            id: "google/gemini-flash-1.5:free",
            name: "Gemini Flash 1.5 (Free)",
            reasoning: false,
            input: ["text", "image"],
            cost: { input: 0, output: 0 },
            contextWindow: 1000000,
            maxTokens: 8192
          }
        ]
      },
      // 3. Ollama Cloud
      "ollama-cloud": {
        baseUrl: "https://ollama.com/api",
        api: "openai-completions",
        models: [
          {
            id: "gpt-oss:20b-cloud",
            name: "GPT-OSS 20B Cloud",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 128000,
            maxTokens: 8192
          }
        ]
      },
      // 4. Anthropic (유료)
      "anthropic": {
        baseUrl: "https://api.anthropic.com",
        apiKey: process.env.ANTHROPIC_API_KEY,
        api: "anthropic-messages",
        models: [
          {
            id: "claude-3-5-sonnet-20241022",
            name: "Claude 3.5 Sonnet",
            reasoning: false,
            input: ["text", "image"],
            cost: { input: 3, output: 15 },
            contextWindow: 200000,
            maxTokens: 8192
          }
        ]
      }
    }
  };

  // 폴백 순서 설정
  config.agents = {
    defaults: {
      model: {
        primary: "copilot/gpt-4o",
        fallbacks: [
          "openrouter/google/gemini-flash-1.5:free",
          "ollama-cloud/gpt-oss:20b-cloud",
          "anthropic/claude-3-5-sonnet-20241022"
        ]
      }
    }
  };

  // Remove LLM secrets (delivered via env vars)
  config.llm = { ...config.llm };
  delete config.llm.apiKey;
  if (options?.llmModel) {
    config.llm.model = options.llmModel;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
```

### 2-3. SecretsStack에 API Key 추가

`packages/cdk/lib/stacks/secrets-stack.ts`:

```typescript
const SECRET_PARAMS = [
  { id: "BridgeAuthToken", path: SSM_SECRETS.BRIDGE_AUTH_TOKEN, desc: "Bridge auth token" },
  { id: "OpenclawGatewayToken", path: SSM_SECRETS.OPENCLAW_GATEWAY_TOKEN, desc: "OpenClaw Gateway token" },
  { id: "AnthropicApiKey", path: SSM_SECRETS.ANTHROPIC_API_KEY, desc: "Anthropic API key" },
  { id: "CopilotApiKey", path: SSM_SECRETS.COPILOT_API_KEY, desc: "GitHub Copilot API key" },
  { id: "OpenRouterApiKey", path: SSM_SECRETS.OPENROUTER_API_KEY, desc: "OpenRouter API key" },
  { id: "TelegramBotToken", path: SSM_SECRETS.TELEGRAM_BOT_TOKEN, desc: "Telegram bot token" },
  { id: "TelegramWebhookSecret", path: SSM_SECRETS.TELEGRAM_WEBHOOK_SECRET, desc: "Telegram webhook secret" },
] as const;
```

`packages/cdk/lib/stacks/ssm-params.ts`:

```typescript
export const SSM_SECRETS = {
  BRIDGE_AUTH_TOKEN: "/serverless-openclaw/secrets/bridge-auth-token",
  OPENCLAW_GATEWAY_TOKEN: "/serverless-openclaw/secrets/openclaw-gateway-token",
  ANTHROPIC_API_KEY: "/serverless-openclaw/secrets/anthropic-api-key",
  COPILOT_API_KEY: "/serverless-openclaw/secrets/copilot-api-key",
  OPENROUTER_API_KEY: "/serverless-openclaw/secrets/openrouter-api-key",
  TELEGRAM_BOT_TOKEN: "/serverless-openclaw/secrets/telegram-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "/serverless-openclaw/secrets/telegram-webhook-secret",
} as const;
```

### 2-4. ComputeStack에서 환경변수 추가

`packages/cdk/lib/stacks/compute-stack.ts`:

```typescript
const copilotApiKey = ssm.StringParameter.fromStringParameterName(
  this,
  "CopilotApiKey",
  SSM_SECRETS.COPILOT_API_KEY
);

const openrouterApiKey = ssm.StringParameter.fromStringParameterName(
  this,
  "OpenRouterApiKey",
  SSM_SECRETS.OPENROUTER_API_KEY
);

taskDefinition.addContainer("openclaw", {
  // 기존 설정...
  secrets: {
    BRIDGE_AUTH_TOKEN: ecs.Secret.fromSsmParameter(bridgeAuthToken),
    OPENCLAW_GATEWAY_TOKEN: ecs.Secret.fromSsmParameter(openclawGatewayToken),
    ANTHROPIC_API_KEY: ecs.Secret.fromSsmParameter(anthropicApiKey),
    COPILOT_API_KEY: ecs.Secret.fromSsmParameter(copilotApiKey),
    OPENROUTER_API_KEY: ecs.Secret.fromSsmParameter(openrouterApiKey),
  },
});
```

### 2-5. 배포

```bash
# 1. SecretsStack 재배포
cd packages/cdk
npx cdk deploy SecretsStack \
  --parameters "CopilotApiKey=<YOUR_COPILOT_KEY>" \
  --parameters "OpenRouterApiKey=<YOUR_OPENROUTER_KEY>" \
  --parameters "AnthropicApiKey=<YOUR_ANTHROPIC_KEY>" \
  --profile $AWS_PROFILE

# 2. ComputeStack 재배포
npx cdk deploy ComputeStack --profile $AWS_PROFILE

# 3. Docker 이미지 재빌드
cd ../..
docker build -f packages/container/Dockerfile -t serverless-openclaw .
docker tag serverless-openclaw:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
```

---

## 3. 프롬프트 캐싱 및 데이터 유지

### 3-1. 현재 구현 (이미 작동 중!)

**좋은 소식**: 이미 구현되어 있습니다! ✅

```typescript
// packages/container/src/startup.ts
const [, history] = await Promise.all([
  restoreFromS3({
    bucket: env.DATA_BUCKET,
    prefix: `workspaces/${userId}`,
    localPath: "/data/workspace",
  }),
  loadRecentHistory(dynamoSend, userId),
]);
```

**데이터 유지 메커니즘**:

```
Fargate 시작
    ↓
1. S3에서 workspace 복원
    - 이전 작업 파일
    - OpenClaw 생성 파일
    ↓
2. DynamoDB에서 대화 내역 로드
    - 최근 20개 메시지
    - 7일 이내 대화
    ↓
3. 첫 메시지에 대화 내역 추가
    - AI가 이전 대화 "기억"
    ↓
4. 주기적으로 S3에 백업 (5분마다)
    ↓
5. 종료 시 최종 백업
    ↓
다음 Fargate 시작 시 1번부터 반복
```

### 3-2. 데이터 저장 위치

| 데이터 유형 | 저장 위치 | 보존 기간 | 복원 시점 |
|------------|----------|----------|----------|
| **대화 내역** | DynamoDB Conversations | 7일 (TTL) | 컨테이너 시작 시 |
| **Workspace 파일** | S3 + Fargate 로컬 | 영구 | 컨테이너 시작 시 |
| **OpenClaw 설정** | Fargate 로컬 | 컨테이너 수명 | 매번 재생성 |
| **실행 중 데이터** | Fargate 메모리 | 컨테이너 수명 | 손실됨 |

### 3-3. 대화 내역 캐싱 (DynamoDB)

```typescript
// packages/container/src/conversation-store.ts

// 저장
await saveMessagePair(
  dynamoSend,
  userId,
  userMessage,
  assistantMessage,
  channel
);

// 로드 (최근 20개)
const history = await loadRecentHistory(dynamoSend, userId, "default", 20);

// 포맷 (XML)
const historyPrefix = formatHistoryContext(history);
// <conversation_history>
//   <message role="user">...</message>
//   <message role="assistant">...</message>
// </conversation_history>
```

**AI에게 전달**:
```typescript
const messageToSend = historyPrefix
  ? historyPrefix + msg.message  // 대화 내역 + 새 메시지
  : msg.message;

const generator = openclawClient.sendMessage(userId, messageToSend);
```

### 3-4. Workspace 캐싱 (S3)

```typescript
// packages/container/src/s3-sync.ts

// 복원 (컨테이너 시작 시)
await restoreFromS3({
  bucket: env.DATA_BUCKET,
  prefix: `workspaces/${userId}`,
  localPath: "/data/workspace",
});

// 백업 (5분마다 + 종료 시)
await backupToS3({
  bucket: env.DATA_BUCKET,
  prefix: `workspaces/${userId}`,
  localPath: "/data/workspace",
});
```

**백업 주기**:
```typescript
// packages/container/src/lifecycle.ts
startPeriodicBackup() {
  this.backupInterval = setInterval(async () => {
    await this.backup();
  }, 5 * 60 * 1000); // 5분
}
```

### 3-5. 데이터 유지 흐름

```
┌─────────────────────────────────────────────────────────┐
│ Fargate 컨테이너 #1 시작                                  │
│ - S3에서 workspace 복원 (이전 파일들)                     │
│ - DynamoDB에서 대화 내역 로드 (최근 20개)                 │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 사용자와 대화                                             │
│ - 새 메시지 + 대화 내역 → AI                             │
│ - AI 응답                                                │
│ - DynamoDB에 저장 (즉시)                                 │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 5분마다 자동 백업                                         │
│ - /data/workspace → S3                                  │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 컨테이너 종료 (15분 idle)                                │
│ - 최종 백업: /data/workspace → S3                        │
│ - 컨테이너 삭제                                          │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ Fargate 컨테이너 #2 시작 (다음 메시지 시)                 │
│ - S3에서 workspace 복원 (이전 백업)                      │
│ - DynamoDB에서 대화 내역 로드 (이전 대화 포함)            │
│ → 데이터 유지됨! ✅                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 프롬프트 캐싱 최적화

### 4-1. 대화 내역 개수 조정

더 많은 컨텍스트를 유지하려면:

```typescript
// packages/container/src/startup.ts
const history = await loadRecentHistory(dynamoSend, userId, "default", 50); // 20 → 50
```

**트레이드오프**:
- 많을수록: AI가 더 많은 컨텍스트 보유
- 적을수록: 토큰 비용 절감, 응답 속도 빠름

### 4-2. TTL 연장

대화 내역을 더 오래 보존하려면:

```typescript
// packages/container/src/conversation-store.ts
const CONVERSATION_TTL_DAYS = 30; // 7 → 30일
```

### 4-3. Anthropic 프롬프트 캐싱 (유료 기능)

Claude는 프롬프트 캐싱을 지원합니다:

```typescript
// OpenClaw 설정
{
  "models": {
    "providers": {
      "anthropic": {
        "cacheControl": {
          "enabled": true,
          "ttl": 300  // 5분
        }
      }
    }
  }
}
```

**비용 절감**:
- 캐시된 입력: $0.30 per 1M tokens (90% 할인)
- 일반 입력: $3 per 1M tokens

**적용 대상**:
- 대화 내역 (반복적으로 전송)
- System prompt
- 긴 컨텍스트

---

## 5. 모니터링 및 디버깅

### 5-1. 폴백 로그 확인

```bash
# CloudWatch Logs
aws logs tail /ecs/serverless-openclaw --follow --filter "fallback"
```

**예상 로그**:
```
[openclaw] Primary model copilot/gpt-4o failed with 429
[openclaw] Falling back to openrouter/google/gemini-flash-1.5:free
[openclaw] Fallback successful
```

### 5-2. 사용량 추적

각 LLM의 사용량을 추적하려면:

```typescript
// packages/container/src/metrics.ts
export async function publishModelUsageMetrics(data: {
  model: string;
  success: boolean;
  fallback: boolean;
  userId: string;
}) {
  // CloudWatch Metrics 전송
}
```

### 5-3. Rate Limit 에러 처리

```typescript
// OpenClaw가 자동으로 처리하지만, 커스텀 로직 추가 가능
if (error.status === 429) {
  console.log(`Rate limit hit for ${model}, trying fallback...`);
  // 자동으로 다음 fallback 시도
}
```

---

## 6. 비용 최적화

### 6-1. 예상 비용 (월 기준)

**시나리오**: 하루 100개 메시지

| 항목 | 비용 |
|------|------|
| **LLM API** | |
| - Copilot (2,000/월) | $0 (무료 범위 내) |
| - OpenRouter (50/일) | $0 (무료) |
| - Ollama Cloud | $0 (무료) |
| - Claude (초과분만) | ~$5 (초과 시) |
| **AWS 인프라** | |
| - DynamoDB | ~$0.01 |
| - S3 | ~$0.05 |
| - Fargate Spot | ~$0.75 |
| **총 비용** | **~$1-6/월** |

### 6-2. 무료로 유지하는 방법

```
하루 메시지 제한:
- Copilot: 66개/일 (2,000/30일)
- OpenRouter: 50개/일
- Ollama Cloud: 수백개/일 (추정)

전략:
1. 66개까지: Copilot (무료)
2. 67-117개: OpenRouter (무료)
3. 118개 이상: Ollama Cloud (무료)
4. 극단적 초과: Claude (유료)

→ 하루 200개까지 무료 가능!
```

---

## 7. 배포 체크리스트

### 7-1. API Key 준비

- [ ] GitHub Copilot API Key 생성
- [ ] OpenRouter 계정 생성 및 API Key
- [ ] Anthropic API Key (폴백용)

### 7-2. 코드 수정

- [ ] `patch-config.ts` 수정 (폴백 설정)
- [ ] `secrets-stack.ts` 수정 (API Key 추가)
- [ ] `ssm-params.ts` 수정 (파라미터 경로)
- [ ] `compute-stack.ts` 수정 (환경변수)

### 7-3. 배포

- [ ] SecretsStack 배포 (API Keys)
- [ ] ComputeStack 배포 (환경변수)
- [ ] Docker 이미지 재빌드
- [ ] ECR에 푸시
- [ ] 테스트 (각 LLM 동작 확인)

---

## 8. 테스트 방법

### 8-1. 로컬 테스트

```bash
# 환경변수 설정
export COPILOT_API_KEY="..."
export OPENROUTER_API_KEY="..."
export ANTHROPIC_API_KEY="..."

# 컨테이너 실행
docker run -e COPILOT_API_KEY -e OPENROUTER_API_KEY -e ANTHROPIC_API_KEY serverless-openclaw
```

### 8-2. Rate Limit 테스트

```bash
# 의도적으로 Rate Limit 발생
for i in {1..100}; do
  curl -X POST http://localhost:8080/message \
    -H "Content-Type: application/json" \
    -d '{"message":"Hello"}' &
done
```

**예상 결과**:
- 처음 66개: Copilot 사용
- 67-117개: OpenRouter로 자동 전환
- 118개 이상: Ollama Cloud로 전환

---

## 요약

### ✅ LLM 폴백 전략

1. **GitHub Copilot** (2,000/월) → 무료
2. **OpenRouter** (50/일) → 무료
3. **Ollama Cloud** (높은 제한) → 무료
4. **Claude** (무제한) → 유료 (폴백)

**설정**: `patch-config.ts`에서 폴백 순서 지정
**동작**: 429 에러 시 자동으로 다음 모델 시도

### ✅ 프롬프트 캐싱 (이미 구현됨!)

1. **대화 내역**: DynamoDB에 저장, 7일 TTL
2. **Workspace**: S3에 백업, 5분마다 + 종료 시
3. **복원**: 컨테이너 시작 시 자동 복원
4. **AI 컨텍스트**: 최근 20개 메시지 자동 로드

**결과**: Fargate 재시작해도 데이터 유지됨! ✅

### 💰 비용

- 하루 200개 메시지까지 무료 가능
- AWS 인프라: ~$1/월
- 초과 시에만 Claude 비용 발생

---

**작성일**: 2025-02-17  
**기반**: OpenClaw 공식 문서 및 실제 코드 분석

