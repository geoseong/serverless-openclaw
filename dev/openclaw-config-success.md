# OpenClaw Config 성공 사례 (2026-02-19)

## 최종 성공 Config

### OpenRouter 무료 모델 사용
```json
{
  "gateway": {
    "port": 18789,
    "mode": "local"
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openrouter/arcee-ai/trinity-large-preview:free"
      },
      "models": {
        "openrouter/arcee-ai/trinity-large-preview:free": {
          "alias": "Trinity Large Preview Free"
        }
      }
    }
  },
  "models": {
    "providers": {
      "openrouter": {
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "OPENROUTER_API_KEY",
        "api": "openai-completions",
        "models": [
          {
            "id": "arcee-ai/trinity-large-preview:free",
            "name": "Trinity Large Preview Free",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 32000,
            "maxTokens": 4096
          }
        ]
      }
    }
  }
}
```

**결과**: ✅ Web UI 메시지 통신 성공

**로그 확인**:
```
2026-02-19T04:27:22 [gateway] agent model: openrouter/arcee-ai/trinity-large-preview:free
2026-02-19T04:27:26 Processed 1 pending message(s)
```

**응답 예시**:
```json
{"type":"stream_chunk","content":"드"}
{"type":"stream_chunk","content":"릴"}
{"type":"stream_chunk","content":"까"}
{"type":"stream_chunk","content":"요"}
{"type":"stream_chunk","content":"?"}
{"type":"stream_end"}
```

## 핵심 규칙

### 1. Config 구조
- `agents.defaults` (복수) 사용 필수
- `model.primary` 형식으로 primary 모델 지정
- `models.providers.<provider>` 구조 필요

### 2. Provider 설정
각 provider에 다음 필드 필수:
- `baseUrl`: API endpoint
- `apiKey`: 환경변수 이름 또는 실제 키 값
- `api`: API 타입 (예: "openai-completions")
- `models`: 모델 정의 배열

### 3. Model 정의
각 model에 다음 필드 포함:
- `id`: 모델 ID
- `name`: 모델 이름
- `reasoning`: boolean
- `input`: 입력 타입 배열 (예: ["text"])
- `cost`: 비용 정보 객체
- `contextWindow`: 컨텍스트 윈도우 크기
- `maxTokens`: 최대 토큰 수

## 실패했던 Config 형식들

### 1. Legacy 형식 (llm)
```json
{
  "gateway": {"port": 18789, "mode": "local"},
  "llm": {
    "provider": "openrouter",
    "model": "arcee-ai/trinity-large-preview:free",
    "baseURL": "https://openrouter.ai/api/v1"
  }
}
```
**결과**: ❌ Gateway가 Anthropic 모델로 덮어씀

### 2. agents.default (단수)
```json
{
  "agents": {
    "default": {
      "model": "gemini-3-flash-preview"
    }
  }
}
```
**결과**: ❌ `agents: Unrecognized key: "default"` 에러

### 3. 불완전한 provider 설정
```json
{
  "models": {
    "providers": {
      "google": {
        "models": [...]
      }
    }
  }
}
```
**결과**: ❌ `baseUrl`, `apiKey`, `api` 필드 누락으로 실패

## 참고: lmstudio 예시 (사용자 제공)

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "lmstudio/minimax-m2.1-gs32"
      },
      "models": {
        "lmstudio/minimax-m2.1-gs32": {
          "alias": "Minimax"
        }
      }
    }
  },
  "models": {
    "providers": {
      "lmstudio": {
        "baseUrl": "http://localhost:1234/v1",
        "apiKey": "LMSTUDIO_KEY",
        "api": "openai-completions",
        "models": [
          {
            "id": "minimax-m2.1-gs32",
            "name": "MiniMax M2.1",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 0,
              "output": 0,
              "cacheRead": 0,
              "cacheWrite": 0
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

이 예시가 올바른 형식을 이해하는 데 결정적인 도움이 되었습니다.

## 배포 프로세스

### 1. Config 수정
`packages/container/openclaw.json` 파일 수정

### 2. Docker 이미지 빌드
```bash
docker build -f packages/container/Dockerfile -t serverless-openclaw .
```

### 3. ECR 로그인 및 푸시
```bash
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  623542739657.dkr.ecr.ap-northeast-2.amazonaws.com

docker tag serverless-openclaw:latest \
  623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest

docker push 623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest
```

### 4. DEPLOYMENT_VERSION 증가
`packages/cdk/lib/stacks/compute-stack.ts`:
```typescript
DEPLOYMENT_VERSION: "2026.02.09.7",  // 증가
```

### 5. CDK 배포
```bash
cd packages/cdk
npx cdk deploy ComputeStack ApiStack --require-approval never
```

### 6. TaskState 리셋 (필수!)
```bash
# Web UI 사용자
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#24a8ad7c-7021-70f6-7a7c-3e52faa2c335"}}' \
  --region ap-northeast-2

# Telegram 사용자
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#telegram:337607235"}}' \
  --region ap-northeast-2
```

### 7. 테스트
Web UI에서 메시지 전송 후 로그 확인:
```bash
aws logs tail /ecs/serverless-openclaw --since 5m --region ap-northeast-2 --format short
```

## 다음 단계: Google Gemini 추가

Google provider 설정 방법 확인 필요:
1. OpenClaw가 Google provider를 네이티브로 지원하는지 확인
2. `baseUrl`, `apiKey`, `api` 필드 값 확인
3. Fallback 체인 구성 (OpenRouter → Gemini)

참고: [dev/llm-gemini-setup.md](./llm-gemini-setup.md)

## 참고 문서
- OpenClaw Model Providers: https://docs.openclaw.ai/concepts/model-providers
- OpenRouter 통합: https://openrouter.ai/docs/guides/guides/openclaw-integration
- 세션 요약: [dev/temp-260209.md](./temp-260209.md)
