
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

## 9. 배포
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
```