# Google Gemini 모델 추가 가이드

## 현재 상태 (2026-02-19)
- ✅ SSM Parameter에 `GEMINI_API_KEY` 추가 완료
- ✅ ComputeStack에 환경변수 설정 완료
- ✅ OpenClaw config에 Gemini를 primary 모델로 설정 완료
- ✅ Telegram 테스트 성공 (응답 수신 확인)
- ✅ 로그 확인: `agent model: google/gemini-3-flash-preview`

## 중요 발견
- **OpenClaw Built-in Provider**: OpenClaw가 Google provider를 네이티브로 지원
- **환경변수만 필요**: `GEMINI_API_KEY` 환경변수만 설정하면 자동으로 사용 가능
- **Config 간소화**: `models.providers.google` 설정 불필요
- **모델 버전**: `gemini-1.5-flash`는 404 에러, `gemini-3-flash-preview` 작동 확인

## API Key 발급

1. [Google AI Studio](https://aistudio.google.com/api-keys)에 접속하여 구글 계정으로 로그인
2. 왼쪽 사이드바의 **"Get API key"** 클릭
3. **"Create API key in new project"** 눌러 키 생성 및 복사
4. SSM Parameter에 저장:
```bash
aws ssm put-parameter \
  --name "/serverless-openclaw/GEMINI_API_KEY" \
  --value "YOUR_GEMINI_API_KEY" \
  --type "SecureString" \
  --region ap-northeast-2 \
  --overwrite
```

## OpenClaw Config 설정 (완료 ✅)

### 최종 성공 Config
OpenClaw Built-in Provider를 사용하므로 매우 간단합니다:

```json
{
  "gateway": {"port": 18789, "mode": "local"},
  "agents": {
    "defaults": {
      "model": {"primary": "google/gemini-3-flash-preview"},
      "models": {
        "google/gemini-3-flash-preview": {"alias": "Gemini 3 Flash Preview"},
        "openrouter/arcee-ai/trinity-large-preview:free": {"alias": "Trinity Large Preview Free"}
      }
    }
  }
}
```

**핵심 포인트:**
1. `agents.defaults.model.primary: "google/gemini-3-flash-preview"` 형식으로 지정
2. `models.providers.google` 설정 불필요 (Built-in Provider)
3. 환경변수 `GEMINI_API_KEY`만 있으면 자동으로 작동
4. `gateway.mode: "local"` 필수

### 작동하지 않는 모델
- `gemini-1.5-flash`: 404 에러 (NOT_FOUND)
  ```
  {"error": {"code": 404, "message": "models/gemini-1.5-flash is not found for API version v1beta"}}
  ```

### 작동하는 모델
- `gemini-3-flash-preview`: ✅ 테스트 성공

## 테스트 방법

### 1. API Key 직접 테스트
```bash
# gemini-1.5-flash (404 에러)
GEMINI_API_KEY=$(aws ssm get-parameter --name "/serverless-openclaw/GEMINI_API_KEY" --with-decryption --region ap-northeast-2 --query "Parameter.Value" --output text)
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'

# gemini-3-flash-preview (성공 ✅)
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H 'Content-Type: application/json' \
  -X POST \
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'
```

### 2. 배포 및 테스트 (완료 ✅)
1. ✅ `packages/container/openclaw.json` 수정
2. ✅ Docker 이미지 빌드: `docker build -f packages/container/Dockerfile -t serverless-openclaw .`
3. ✅ ECR 푸시: `docker push 623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest`
4. ✅ DEPLOYMENT_VERSION 증가 (compute-stack.ts): 2026.02.09.9
5. ✅ CDK 배포: `npx cdk deploy ComputeStack ApiStack --require-approval never`
6. ✅ TaskState 리셋
7. ✅ Telegram 메시지 전송 테스트 (@geoseong_bot)
8. ✅ 로그 확인: `agent model: google/gemini-3-flash-preview`
9. ✅ 응답 수신 확인

## 추천 모델

모델|특징|상태
---|---|---
gemini-3-flash-preview|최신 preview 모델, 빠른 응답|✅ 작동 확인
gemini-1.5-flash|안정 버전|❌ 404 에러 (NOT_FOUND)
gemini-2.0-flash|최신 모델|테스트 필요

## 무료 한도
- 분당 15회 요청
- 일일 1,500회 요청
- 자세한 내용: https://ai.google.dev/pricing

## 참고 문서
- Google AI Studio: https://aistudio.google.com/
- Gemini API 문서: https://ai.google.dev/docs
- OpenClaw Model Providers: https://docs.openclaw.ai/concepts/model-providers