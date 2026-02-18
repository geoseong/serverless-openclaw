# OpenClaw에서 다른 AI 모델 사용하기

이 문서는 Anthropic Claude 대신 다른 AI 모델(Ollama, Hugging Face, 로컬 LLM 등)을 사용하는 방법을 설명합니다.

---

## ⚠️ 중요: OpenClaw는 LLM을 제공하지 않습니다!

**OpenClaw의 역할**:
- OpenClaw는 **중개자(Gateway)** 역할만 합니다
- 실제 AI 추론은 **외부 API 또는 서버**에서 수행됩니다

**통신 구조**:
```
사용자 → OpenClaw (Fargate) → LLM API/서버 → AI 모델
```

### 두 가지 유형의 LLM 제공자

#### 1. 클라우드 API (✅ Fargate에서 바로 사용 가능)

```
Fargate (OpenClaw) --HTTPS--> api.anthropic.com (Claude)
Fargate (OpenClaw) --HTTPS--> api.openai.com (GPT)
Fargate (OpenClaw) --HTTPS--> openrouter.ai (여러 모델)
```

- **장점**: 별도 서버 불필요, API Key만 있으면 됨
- **예시**: Anthropic, OpenAI, Google Gemini, OpenRouter, Groq

#### 2. 로컬 서버 (❌ 별도 서버 필요)

```
Fargate (OpenClaw) --HTTP--> EC2 (Ollama 서버) --추론--> LLM 모델
```

- **단점**: EC2 또는 온프레미스 서버 필요, 직접 운영
- **예시**: Ollama, LM Studio, vLLM, Hugging Face 로컬 모델

---

## 개요

OpenClaw는 **모델 독립적(model-agnostic)** 플랫폼으로, 다양한 LLM 제공자를 지원합니다:

- **클라우드 모델**: OpenAI, Anthropic, Google Gemini, OpenRouter 등
- **로컬 모델**: Ollama, LM Studio, vLLM, Hugging Face 등
- **커스텀 API**: OpenAI 호환 API 엔드포인트

---

## 이 프로젝트에서의 모델 설정 방식

### 현재 구조

```
SecretsStack (SSM) → Fargate 환경변수 → OpenClaw 설정 파일
```

1. **SecretsStack**: `AnthropicApiKey`를 SSM Parameter Store에 저장
2. **ComputeStack**: Fargate Task Definition에 환경변수로 주입
3. **Container**: OpenClaw가 환경변수에서 API Key 읽음
4. **patch-config.ts**: `openclaw.json` 파일에서 민감 정보 제거 (API Key는 환경변수만 사용)

### 설정 파일 위치

Fargate 컨테이너 내부:
- **OpenClaw 설정**: `/home/openclaw/.openclaw/openclaw.json`
- **환경변수**: `ANTHROPIC_API_KEY` (또는 다른 제공자의 환경변수)

## 방법 5: Fargate에서 바로 사용 가능한 저렴한 대안

### 5-1. OpenRouter (✅ 권장)

[OpenRouter](https://openrouter.ai/)는 여러 AI 모델을 하나의 API로 제공하는 서비스입니다.

**장점**:
- ✅ Fargate에서 바로 사용 (별도 서버 불필요)
- ✅ 100+ 모델 선택 가능
- ✅ 일부 모델은 무료
- ✅ 자동 폴백 지원

**무료 모델 예시**:
- `google/gemini-flash-1.5` (무료)
- `meta-llama/llama-3.1-8b-instruct` (무료)
- `mistralai/mistral-7b-instruct` (무료)

**설정 방법**:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/google/gemini-flash-1.5",
        "fallbacks": ["anthropic/claude-3-5-sonnet-20241022"]
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "${OPENROUTER_API_KEY}",
        "api": "openai-completions"
      }
    }
  }
}
```

**비용**:
- 무료 모델: $0
- 유료 모델: Claude보다 저렴 (5.5% 플랫폼 수수료 추가)

### 5-2. Groq (✅ 빠르고 저렴)

[Groq](https://groq.com/)는 초고속 추론 서비스입니다.

**장점**:
- ✅ Fargate에서 바로 사용
- ✅ 매우 빠른 응답 속도
- ✅ 무료 티어 제공
- ✅ Llama 3.1, Mixtral 등 지원

**무료 티어**:
- 14,400 requests/day
- 매우 빠른 응답 (초당 수백 토큰)

**설정 방법**:

```json
{
  "models": {
    "providers": {
      "groq": {
        "baseUrl": "https://api.groq.com/openai/v1",
        "apiKey": "${GROQ_API_KEY}",
        "api": "openai-completions",
        "models": [
          {
            "id": "llama-3.1-70b-versatile",
            "name": "Llama 3.1 70B",
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

### 5-3. Google Gemini (✅ 무료 티어)

**장점**:
- ✅ Fargate에서 바로 사용
- ✅ 무료 티어: 15 requests/minute
- ✅ 긴 컨텍스트 (1M 토큰)

**설정 방법**:

```json
{
  "models": {
    "providers": {
      "gemini": {
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "apiKey": "${GEMINI_API_KEY}",
        "api": "google-generative-ai"
      }
    }
  }
}
```

---

## 방법 6: Ollama + 로컬 LLM (❌ 별도 서버 필요)

**주의**: 이 방법은 EC2 또는 온프레미스 서버가 필요합니다!

### 6-1. Ollama란?

[Ollama](https://ollama.com/)는 로컬에서 LLM을 실행할 수 있는 오픈소스 플랫폼입니다.

**장점**:
- 완전 무료 (API 비용 없음)
- 데이터 프라이버시 (모든 처리가 로컬)
- 오프라인 사용 가능

**단점**:
- GPU 필요 (성능을 위해)
- 클라우드 모델보다 품질이 낮을 수 있음
- Fargate에서 직접 실행 불가 (별도 서버 필요)

### 6-2. 권장 모델

OpenClaw는 **최소 64k 토큰 컨텍스트**를 권장합니다:

| 모델 | 설명 | 컨텍스트 |
|------|------|----------|
| `qwen3-coder` | 코딩 작업에 최적화 | 128k |
| `glm-4.7` | 범용 모델 | 128k |
| `glm-4.7-flash` | 빠른 응답 | 128k |
| `gpt-oss:20b` | 균형잡힌 성능 | 128k |
| `gpt-oss:120b` | 향상된 성능 | 128k |

### 6-3. 아키텍처 옵션

#### 옵션 A: Ollama를 별도 EC2에서 실행 (권장)

```
Fargate (OpenClaw) → EC2 (Ollama) → 로컬 LLM
```

**장점**: Fargate는 상태 비저장, Ollama는 항상 실행
**단점**: EC2 비용 추가

#### 옵션 B: Ollama를 로컬 서버에서 실행

```
Fargate (OpenClaw) → 인터넷 → 홈 서버 (Ollama) → 로컬 LLM
```

**장점**: 추가 클라우드 비용 없음
**단점**: 고정 IP 또는 Dynamic DNS 필요, 방화벽 설정 필요

### 6-4. 설정 방법

**중요**: 이 방법은 3단계로 구성됩니다:
1. **별도 서버에 Ollama 설치** (EC2 또는 온프레미스)
2. **OpenClaw 설정에 Ollama 서버 주소 등록** (Fargate)
3. **통신**: Fargate → Ollama 서버 → LLM 추론

#### Step 1: Ollama 서버 설치 (EC2 또는 로컬 서버)

**주의**: 이 단계는 Fargate가 아닌 **별도 서버**에서 실행합니다!

```bash
# EC2 또는 온프레미스 서버에서 실행
# Ollama 설치
curl -fsSL https://ollama.com/install.sh | sh

# 모델 다운로드 (수 GB 크기)
ollama pull qwen3-coder

# Ollama 서버 시작 (외부 접근 허용)
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

**EC2 Security Group 설정**:
- Inbound: TCP 11434 from Fargate Security Group

#### Step 2: OpenClaw 설정 파일 수정 (Fargate 컨테이너)

**이 설정은 Ollama 서버의 주소를 OpenClaw에 알려주는 것입니다.**

Fargate 컨테이너 내부의 `/home/openclaw/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3-coder",
        "fallbacks": ["ollama/glm-4.7"]
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "ollama": {
        "baseUrl": "http://<OLLAMA_SERVER_IP>:11434",  // ← EC2 또는 로컬 서버 IP
        "api": "openai-completions",
        "models": [
          {
            "id": "qwen3-coder",
            "name": "Qwen3 Coder",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0 },
            "contextWindow": 128000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

**통신 흐름**:
```
사용자 메시지
  ↓
Fargate (OpenClaw)
  ↓ HTTP 요청
EC2 (Ollama 서버 - http://<IP>:11434)
  ↓ 추론
LLM 모델 (qwen3-coder)
  ↓ 응답
Fargate (OpenClaw)
  ↓
사용자에게 전달
```

#### Step 3: patch-config.ts 수정

`packages/container/src/patch-config.ts`에서 Ollama 설정 추가:

```typescript
export function patchConfig(configPath: string, options?: PatchOptions): void {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  // Gateway port
  config.gateway = { ...config.gateway, port: GATEWAY_PORT };

  // Ollama 설정 추가
  if (process.env.OLLAMA_BASE_URL) {
    config.models = {
      mode: "merge",
      providers: {
        ollama: {
          baseUrl: process.env.OLLAMA_BASE_URL,
          api: "openai-completions",
          models: [
            {
              id: "qwen3-coder",
              name: "Qwen3 Coder",
              contextWindow: 128000,
              maxTokens: 8192
            }
          ]
        }
      }
    };
    
    config.agents = {
      defaults: {
        model: {
          primary: "ollama/qwen3-coder"
        }
      }
    };
  }

  // 기존 코드...
}
```

#### Step 4: SecretsStack에 Ollama URL 추가

`packages/cdk/lib/stacks/secrets-stack.ts`:

```typescript
const SECRET_PARAMS = [
  // 기존 파라미터들...
  { id: "OllamaBaseUrl", path: SSM_SECRETS.OLLAMA_BASE_URL, desc: "Ollama server URL (optional)" },
] as const;
```

`packages/cdk/lib/stacks/ssm-params.ts`:

```typescript
export const SSM_SECRETS = {
  // 기존...
  OLLAMA_BASE_URL: "/serverless-openclaw/secrets/ollama-base-url",
} as const;
```

#### Step 5: ComputeStack에서 환경변수 추가

`packages/cdk/lib/stacks/compute-stack.ts`:

```typescript
const ollamaBaseUrl = ssm.StringParameter.fromStringParameterName(
  this,
  "OllamaBaseUrl",
  SSM_SECRETS.OLLAMA_BASE_URL
);

taskDefinition.addContainer("openclaw", {
  // 기존 설정...
  secrets: {
    // 기존 secrets...
    OLLAMA_BASE_URL: ecs.Secret.fromSsmParameter(ollamaBaseUrl),
  },
});
```

#### Step 6: 배포

```bash
# SecretsStack 재배포
npx cdk deploy SecretsStack \
  --parameters "OllamaBaseUrl=http://<EC2_IP>:11434" \
  --profile $AWS_PROFILE

# ComputeStack 재배포
npx cdk deploy ComputeStack --profile $AWS_PROFILE

# Docker 이미지 재빌드 및 푸시
docker build -f packages/container/Dockerfile -t serverless-openclaw .
docker tag serverless-openclaw:latest $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
docker push $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/serverless-openclaw:latest
```

---

## 방법 2: OpenAI 사용

### 2-1. 설정 변경

#### Step 1: SecretsStack 파라미터 수정

```bash
npx cdk deploy SecretsStack \
  --parameters "OpenAIApiKey=sk-..." \
  --profile $AWS_PROFILE
```

#### Step 2: SSM 파라미터 이름 변경

`packages/cdk/lib/stacks/ssm-params.ts`:

```typescript
export const SSM_SECRETS = {
  // ANTHROPIC_API_KEY 대신
  OPENAI_API_KEY: "/serverless-openclaw/secrets/openai-api-key",
} as const;
```

#### Step 3: 환경변수 이름 변경

ComputeStack에서 `ANTHROPIC_API_KEY` → `OPENAI_API_KEY`

#### Step 4: OpenClaw 설정

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o",
        "fallbacks": ["openai/gpt-4", "openai/gpt-3.5-turbo"]
      }
    }
  }
}
```

---

## 방법 3: Hugging Face Inference API

### 3-1. Hugging Face API 토큰 생성

1. [Hugging Face](https://huggingface.co/) 가입
2. Settings → Access Tokens → New Token 생성
3. 무료 Inference API 사용 가능 (제한적)

### 3-2. OpenAI 호환 프록시 사용

Hugging Face는 직접 지원되지 않으므로 **LiteLLM** 같은 프록시 사용:

```bash
# LiteLLM 설치 (별도 서버)
pip install litellm

# LiteLLM 프록시 시작
litellm --model huggingface/meta-llama/Llama-3.1-8B-Instruct \
  --api_key $HF_TOKEN \
  --port 8000
```

그 다음 Ollama 방법과 동일하게 설정 (baseUrl을 LiteLLM 서버로)

---

## 방법 4: 하이브리드 (여러 클라우드 API 조합)

### 4-1. 비용 최적화 전략 (✅ Fargate에서 바로 사용 가능)

**중요**: 이 방법은 별도 서버 없이 Fargate에서 바로 사용 가능합니다!

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o-mini",
        "fallbacks": ["anthropic/claude-3-5-sonnet-20241022"]
      }
    }
  }
}
```

**전략**:
- 일반 작업: GPT-4o-mini (매우 저렴 - $0.15/$0.60)
- 복잡한 작업: Claude (고품질 - $3/$15)
- GPT-4o-mini 실패 시 자동으로 Claude로 폴백

**비용 절감 예시**:
- 100만 토큰 입력 + 100만 토큰 출력 기준
- Claude만 사용: $3 + $15 = $18
- GPT-4o-mini 주로 사용 (80%): $0.15×0.8 + $0.60×0.8 + $3×0.2 + $15×0.2 = $4.20
- **약 77% 비용 절감!**

### 4-2. 작업별 모델 라우팅 (✅ Fargate에서 바로 사용 가능)

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o-mini"
      }
    },
    "coding": {
      "model": {
        "primary": "openai/gpt-4o"
      }
    },
    "writing": {
      "model": {
        "primary": "anthropic/claude-3-5-sonnet-20241022"
      }
    }
  }
}
```

**전략**:
- 일반 대화: GPT-4o-mini (저렴)
- 코딩 작업: GPT-4o (중간 가격, 코딩 특화)
- 글쓰기/분석: Claude (고품질)

---

## 비용 비교 (업데이트)

| 제공자 | 모델 | 입력 (1M 토큰) | 출력 (1M 토큰) | Fargate 사용 | 비고 |
|--------|------|----------------|----------------|--------------|------|
| **무료 옵션** |
| OpenRouter | Gemini Flash 1.5 | $0 | $0 | ✅ | 무료, 제한적 |
| Groq | Llama 3.1 70B | $0 | $0 | ✅ | 14,400 req/day |
| Google | Gemini 1.5 Flash | $0 | $0 | ✅ | 15 req/min |
| **저렴한 옵션** |
| OpenAI | GPT-4o-mini | $0.15 | $0.60 | ✅ | 매우 저렴 |
| OpenRouter | Claude 3.5 Haiku | $0.80 | $4.00 | ✅ | Claude 저렴 버전 |
| **중간 가격** |
| OpenAI | GPT-4o | $2.50 | $10 | ✅ | 균형잡힌 선택 |
| **고품질** |
| Anthropic | Claude 3.5 Sonnet | $3 | $15 | ✅ | 현재 사용 중 |
| **로컬 (별도 서버)** |
| Ollama | qwen3-coder | $0 | $0 | ❌ | EC2 비용 별도 |
| Ollama | glm-4.7 | $0 | $0 | ❌ | EC2 비용 별도 |

**EC2 비용 (Ollama 서버 - 참고용)**:
- `g4dn.xlarge` (GPU): ~$0.526/시간 (~$380/월)
- `t3.xlarge` (CPU only): ~$0.1664/시간 (~$120/월) - 느림

---

## 권장 사항 (업데이트)

### 개인 사용 (무료/저비용) - ✅ Fargate에서 바로 사용

**옵션 1: 완전 무료**
```json
{
  "model": {
    "primary": "openrouter/google/gemini-flash-1.5",
    "fallbacks": ["groq/llama-3.1-70b-versatile"]
  }
}
```
- 무료 모델만 사용
- 제한적이지만 개인 사용에는 충분

**옵션 2: 저렴한 하이브리드**
```json
{
  "model": {
    "primary": "openai/gpt-4o-mini",
    "fallbacks": ["anthropic/claude-3-5-sonnet-20241022"]
  }
}
```
- 대부분: GPT-4o-mini (매우 저렴)
- 중요한 작업: Claude (고품질)
- **약 70-80% 비용 절감**

### 프로덕션 (안정성) - ✅ Fargate에서 바로 사용

```json
{
  "model": {
    "primary": "anthropic/claude-3-5-sonnet-20241022",
    "fallbacks": ["openai/gpt-4o"]
  }
}
```
- 안정적인 클라우드 모델
- 다운타임 없음
- 자동 폴백

### 엔터프라이즈 (프라이버시) - ❌ 별도 서버 필요

```
Ollama (전용 EC2) + 온프레미스 LLM
```
- 모든 데이터가 내부에 유지
- 규정 준수
- EC2 비용 추가

---

## 문제 해결

### Ollama 연결 실패

```bash
# Ollama 서버 상태 확인
curl http://<OLLAMA_IP>:11434/api/tags

# 방화벽 확인 (EC2 Security Group)
# Inbound: TCP 11434 from Fargate Security Group
```

### 모델 로딩 느림

```bash
# 모델 미리 로드
ollama run qwen3-coder "hello"

# 모델 유지 (메모리에 상주)
ollama run qwen3-coder --keep-alive -1
```

### 컨텍스트 길이 초과

```json
{
  "models": {
    "providers": {
      "ollama": {
        "models": [
          {
            "id": "qwen3-coder",
            "contextWindow": 128000,  // 늘리기
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

---

## 참고 자료

- [OpenClaw 공식 문서 - Models](https://openclaw.bz/models/)
- [Ollama 공식 사이트](https://ollama.com/)
- [Ollama + OpenClaw 가이드](https://ollama.com/blog/openclaw)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [LiteLLM (프록시)](https://github.com/BerriAI/litellm)

---

## 요약

### ✅ Fargate에서 바로 사용 가능 (별도 서버 불필요)

1. **무료 옵션**:
   - OpenRouter (Gemini Flash, Llama 등)
   - Groq (14,400 req/day)
   - Google Gemini (15 req/min)

2. **저렴한 옵션**:
   - OpenAI GPT-4o-mini ($0.15/$0.60)
   - OpenRouter Claude 3.5 Haiku

3. **하이브리드** (권장):
   - 주: GPT-4o-mini (저렴)
   - 폴백: Claude (고품질)
   - 70-80% 비용 절감

### ❌ 별도 서버 필요 (Fargate에서 직접 사용 불가)

1. **Ollama**: EC2 또는 온프레미스 서버 필요
2. **LM Studio**: 로컬 서버 필요
3. **vLLM**: GPU 서버 필요
4. **Hugging Face 로컬 모델**: 추론 서버 필요

### 가장 쉬운 시작 방법

**지금 바로 시도 (코드 수정 최소)**:

1. OpenRouter 가입 → API Key 받기
2. SecretsStack에 `OpenRouterApiKey` 추가
3. 무료 모델 사용 (Gemini Flash)
4. 비용 $0!

**다음 단계**:
1. 사용할 모델 결정 (무료 vs 저렴 vs 고품질)
2. 필요한 API Key 준비
3. CDK 코드 수정 (SecretsStack, ComputeStack, patch-config.ts)
4. 재배포 및 테스트

---

**작성일**: 2025-02-17  
**기반**: OpenClaw 공식 문서 및 커뮤니티 가이드

