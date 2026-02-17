# OpenClaw에서 다른 AI 모델 사용하기

이 문서는 Anthropic Claude 대신 다른 AI 모델(Ollama, Hugging Face, 로컬 LLM 등)을 사용하는 방법을 설명합니다.

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

---

## 방법 1: Ollama (로컬 LLM) 사용

### 1-1. Ollama란?

[Ollama](https://ollama.com/)는 로컬에서 LLM을 실행할 수 있는 오픈소스 플랫폼입니다.

**장점**:
- 완전 무료 (API 비용 없음)
- 데이터 프라이버시 (모든 처리가 로컬)
- 오프라인 사용 가능

**단점**:
- GPU 필요 (성능을 위해)
- 클라우드 모델보다 품질이 낮을 수 있음
- Fargate에서 직접 실행 불가 (별도 서버 필요)

### 1-2. 권장 모델

OpenClaw는 **최소 64k 토큰 컨텍스트**를 권장합니다:

| 모델 | 설명 | 컨텍스트 |
|------|------|----------|
| `qwen3-coder` | 코딩 작업에 최적화 | 128k |
| `glm-4.7` | 범용 모델 | 128k |
| `glm-4.7-flash` | 빠른 응답 | 128k |
| `gpt-oss:20b` | 균형잡힌 성능 | 128k |
| `gpt-oss:120b` | 향상된 성능 | 128k |

### 1-3. 아키텍처 옵션

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

### 1-4. 설정 방법

#### Step 1: Ollama 서버 설치 (EC2 또는 로컬)

```bash
# Ollama 설치
curl -fsSL https://ollama.com/install.sh | sh

# 모델 다운로드
ollama pull qwen3-coder

# Ollama 서버 시작 (외부 접근 허용)
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

#### Step 2: OpenClaw 설정 파일 수정

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
        "baseUrl": "http://<OLLAMA_SERVER_IP>:11434",
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

## 방법 4: 하이브리드 (클라우드 + 로컬)

### 4-1. 비용 최적화 전략

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3-coder",
        "fallbacks": ["anthropic/claude-3-5-sonnet-20241022"]
      }
    }
  }
}
```

**전략**:
- 일반 작업: Ollama (무료)
- 복잡한 작업: Claude (유료, 품질 높음)
- Ollama 실패 시 자동으로 Claude로 폴백

### 4-2. 작업별 모델 라우팅

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "ollama/qwen3-coder"
      }
    },
    "coding": {
      "model": {
        "primary": "ollama/qwen3-coder"
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

---

## 비용 비교

| 제공자 | 모델 | 입력 (1M 토큰) | 출력 (1M 토큰) | 비고 |
|--------|------|----------------|----------------|------|
| Anthropic | Claude 3.5 Sonnet | $3 | $15 | 현재 사용 |
| OpenAI | GPT-4o | $2.50 | $10 | 저렴함 |
| OpenAI | GPT-4o-mini | $0.15 | $0.60 | 매우 저렴 |
| Ollama | qwen3-coder | $0 | $0 | 무료 (서버 비용만) |
| Ollama | glm-4.7 | $0 | $0 | 무료 (서버 비용만) |

**EC2 비용 (Ollama 서버)**:
- `g4dn.xlarge` (GPU): ~$0.526/시간 (~$380/월)
- `t3.xlarge` (CPU only): ~$0.1664/시간 (~$120/월) - 느림

---

## 권장 사항

### 개인 사용 (저비용)

```
Ollama (로컬 서버) + Claude (폴백)
```

- 대부분의 작업: 무료 Ollama
- 중요한 작업만: Claude

### 프로덕션 (안정성)

```
Claude (주) + GPT-4o-mini (폴백)
```

- 안정적인 클라우드 모델
- 다운타임 없음

### 엔터프라이즈 (프라이버시)

```
Ollama (전용 서버) + 온프레미스 LLM
```

- 모든 데이터가 내부에 유지
- 규정 준수

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

1. **Ollama 사용**: 별도 서버 필요, 무료, 프라이버시
2. **OpenAI 사용**: SecretsStack 파라미터만 변경
3. **Hugging Face**: LiteLLM 프록시 필요
4. **하이브리드**: 비용 최적화 (로컬 + 클라우드 폴백)

**다음 단계**:
1. 사용할 모델 결정
2. 필요한 인프라 준비 (Ollama 서버 등)
3. CDK 코드 수정 (SecretsStack, ComputeStack, patch-config.ts)
4. 재배포 및 테스트

---

**작성일**: 2025-02-17  
**기반**: OpenClaw 공식 문서 및 커뮤니티 가이드

