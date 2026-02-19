
```
# 로컬 테스트 및 배포 전 검증 순서

## 1. 저장소 클론 (이미 하셨으면 스킵)
```bash
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw
```

## 2. 의존성 설치 (필수!)
```bash
npm install

# 보안 취약점 확인 및 수정
npm audit
npm audit fix  # non-breaking 수정만 적용
```

## 3. 환경변수 설정
```bash
cp .env.example .env
# .env 파일 편집 (AWS_PROFILE, AWS_REGION 설정)

# 환경변수 로드 (주석 제거 버전)
export $(grep -v '^#' .env | xargs)

# 또는 source 사용 (더 안전)
set -a
source .env
set +a
```

> **다음 단계 전 필수**: 실제 배포를 위해서는 먼저 다음을 완료해야 합니다:
> 1. CDK Bootstrap: `npx cdk bootstrap aws://<ACCOUNT_ID>/$AWS_REGION`
> 2. SecretsStack 배포: [OpenClaw Gateway Token 생성 가이드](./openclaw-gateway-token-setup.md) 참고

## 4. 빌드
```bash
npm run build
```

> ⚠️ **빌드 에러 발생 시**: `@serverless-openclaw/shared` 모듈을 찾을 수 없다는 에러가 발생하면 [Troubleshooting Guide](./troubleshooting.md#typescript-빌드-실패-serverless-openclawshared-모듈을-찾을-수-없음)를 참고하세요.

## 5. 테스트
```bash
npm run lint
npm run test
```

## 6. Docker 이미지 빌드
```bash
docker build -f packages/container/Dockerfile -t serverless-openclaw .

# 이미지 크기 확인 (cold start에 영향)
docker images serverless-openclaw:latest
```

## 7. Web UI 빌드
```bash
cd packages/web
npx vite build
cd ../..
```

## 8. CDK 검증
```bash
cd packages/cdk
npx cdk synth        # CloudFormation 템플릿 생성
npx cdk diff         # 변경사항 확인
cd ../..
```

## 9. 로컬 Docker 테스트 (선택사항)

### 9-1. OpenClaw 컨테이너 로컬 실행

**기본 실행:**
```bash
# Gemini API 사용
docker run -it --rm \
  -p 8080:8080 \
  -e GEMINI_API_KEY="<your-gemini-api-key>" \
  -e BRIDGE_AUTH_TOKEN="test-token" \
  -e OPENCLAW_GATEWAY_TOKEN="test-gateway-token" \
  serverless-openclaw-container:latest

# OpenRouter API 사용
docker run -it --rm \
  -p 8080:8080 \
  -e OPENROUTER_API_KEY="sk-or-v1-xxx" \
  -e BRIDGE_AUTH_TOKEN="test-token" \
  -e OPENCLAW_GATEWAY_TOKEN="test-gateway-token" \
  serverless-openclaw-container:latest
```

**Health Check:**
```bash
# 다른 터미널에서
curl http://localhost:8080/health
```

**로그 확인:**
```bash
# 컨테이너 실행 중인 터미널에서 로그 확인
# OpenClaw Gateway 시작 메시지 확인
# [gateway] Gateway started on port 18789
# [bridge] Bridge server listening on port 8080
```

### 9-2. 로컬 테스트 제약사항

**Web UI 테스트:**
- Web UI는 Cognito 인증 필요 → AWS 배포 필수
- 로컬 컨테이너만으로는 Web UI 테스트 불가

**Telegram 테스트:**
- Telegram webhook은 HTTPS 필요
- 로컬 테스트 시 ngrok 같은 터널링 서비스 필요
- 복잡하므로 AWS 배포 후 테스트 권장

**권장 테스트 순서:**
1. 로컬 Docker 실행 → Health Check 확인
2. AWS 배포 (Fargate)
3. Web UI로 메시지 테스트
4. Telegram 설정 및 테스트

### 9-3. 로컬 개발 워크플로우

**Config 변경 테스트:**
```bash
# 1. openclaw.json 수정
vim packages/container/openclaw.json

# 2. Docker 이미지 재빌드
docker build -f packages/container/Dockerfile -t serverless-openclaw-container:latest .

# 3. 로컬 실행 및 확인
docker run -it --rm -p 8080:8080 \
  -e GEMINI_API_KEY="xxx" \
  -e BRIDGE_AUTH_TOKEN="test" \
  -e OPENCLAW_GATEWAY_TOKEN="test" \
  serverless-openclaw-container:latest
```

**Bridge 코드 변경 테스트:**
```bash
# 1. TypeScript 빌드
npm run build --workspace=packages/container

# 2. Docker 이미지 재빌드
docker build -f packages/container/Dockerfile -t serverless-openclaw-container:latest .

# 3. 로컬 실행
docker run -it --rm -p 8080:8080 \
  -e GEMINI_API_KEY="xxx" \
  -e BRIDGE_AUTH_TOKEN="test" \
  -e OPENCLAW_GATEWAY_TOKEN="test" \
  serverless-openclaw-container:latest
```

## 10. 배포
```bash
make deploy-all
```

## 테스트 기록

### 2025-02-17
- npm install 완료
- npm audit: esbuild(moderate), qs(low) 취약점 발견
- npm audit fix 실행 (qs 수정, esbuild는 보류)
- 상세 내역: [dev/npmaudit.md](./npmaudit.md)
- **빌드 에러 해결**: TypeScript composite 캐싱 문제로 shared 패키지 빌드 실패 → 강제 재빌드로 해결
- 상세 내역: [dev/troubleshooting.md](./troubleshooting.md#typescript-빌드-실패-serverless-openclawshared-모듈을-찾을-수-없음)

### 2025-02-09 (계속)
- **OpenClaw Config 형식 수정**:
  - 문제: `baseUrl` 필드 누락으로 config validation 실패
  - 해결: `models.providers.<provider>.baseUrl` 추가
  - Google: `https://generativelanguage.googleapis.com/v1beta`
  - OpenRouter: `https://openrouter.ai/api/v1`
- **ECR 리포지토리 문제 발견**:
  - 잘못된 리포지토리에 푸시 (`serverless-openclaw-container`)
  - 올바른 리포지토리: `serverless-openclaw` (StorageStack에서 생성)
  - 수정: 올바른 리포지토리에 재푸시
  - 정리: `serverless-openclaw-container` 리포지토리 삭제
- **Telegram Webhook 등록 완료**:
  - SSM Parameter에 `TELEGRAM_BOT_TOKEN` 추가
  - `make telegram-webhook` 실행으로 webhook 등록 성공
  - Webhook URL: `https://7gjo0uypi5.execute-api.ap-northeast-2.amazonaws.com/telegram`
- **현재 상태**:
  - Docker 이미지 빌드 및 올바른 ECR 리포지토리에 푸시 완료
  - OpenClaw config 수정 완료 (`baseUrl` 추가)
  - Telegram webhook 등록 완료
  - 테스트 진행 중 (Web UI 응답 대기)

### 다음 작업 (우선순위)
1. **Web UI 응답 확인 및 디버깅**
   - Lambda 로그 확인 (에러 메시지 없음)
   - 컨테이너 시작 실패 원인 파악
   - OpenClaw Gateway 로그 확인
2. **한글 입력 중복 문제 해결**
   - Web UI에서 한글 입력 시 메시지 중복 전송
   - 예: "이름이 뭐야" → ["이름이 뭐야", "야"] 2번 전송
   - ChatContainer 컴포넌트 입력 처리 로직 확인 필요
3. **Telegram 테스트**
   - Webhook 등록 완료
   - 메시지 전송 테스트 필요
4. **Ollama 관련 코드 정리**
   - SSM Parameters 제거
   - CDK 스택 코드 정리
   - 문서 업데이트

```