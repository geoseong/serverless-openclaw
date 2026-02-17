---
inclusion: auto
---

# Serverless OpenClaw - Project Rules & Guidelines

이 프로젝트에서 AI 어시스턴트가 따라야 할 규칙과 가이드라인입니다.

## 파일 처리 규칙

### .env 파일
- **.env 파일은 절대 직접 수정하지 말 것**
- 민감한 정보(AWS credentials, API keys 등)가 포함되어 있음
- 수정이 필요한 경우 방법만 안내하고 사용자가 직접 편집하도록 함

### 기타 민감한 파일
- API keys, tokens, secrets가 포함된 파일은 직접 수정 금지
- 설정 방법만 안내

## 문서 작성 위치

### dev/ 디렉토리
개발 및 테스트 관련 기록을 저장하는 위치:
- `dev/localtest.md` - 로컬 테스트 순서 및 배포 전 검증 절차
- `dev/npmaudit.md` - npm audit 결과 및 보안 취약점 처리 기록
- `dev/troubleshooting.md` - 문제 해결 기록
- 기타 개발 중 발생한 이슈 및 해결 방법

### docs/ 디렉토리
공식 문서 (이미 존재):
- `docs/deployment.md` - 배포 가이드
- `docs/development.md` - 개발 가이드
- `docs/architecture.md` - 아키텍처 문서
- 등등

## 코딩 규칙

### 비용 최적화 필수 사항
- NAT Gateway 절대 생성 금지 (`natGateways: 0`)
- ALB 또는 VPC Interface Endpoints 생성 금지
- DynamoDB는 반드시 `PAY_PER_REQUEST` 모드만 사용
- ECS RunTask 시 `capacityProviderStrategy` 사용 (Fargate Spot)

### 보안 규칙
- userId는 반드시 서버 사이드에서만 생성 (IDOR 방지)
- 모든 secrets는 SSM Parameter Store 또는 Secrets Manager 사용
- 컨테이너에 secrets를 파일로 저장하지 말 것 (환경변수만 사용)

### TypeScript 규칙
- ESM 사용: import 경로에 `.js` 확장자 필수
- strict mode 활성화
- 모든 패키지는 npm workspaces로 관리

## 테스트 규칙

### TDD 원칙
- UI(web package) 제외한 모든 구현은 TDD 따름
- 테스트 먼저 작성 → 최소 구현 → 리팩토링

### Git Hooks
- pre-commit: build + lint + unit tests
- pre-push: E2E tests
- `--no-verify`로 우회 가능하지만 권장하지 않음

## 배포 전 체크리스트

1. `npm run build` - TypeScript 빌드 성공
2. `npm run lint` - 린트 에러 없음
3. `npm run test` - 유닛 테스트 통과
4. `cd packages/web && npx vite build` - Web UI 빌드 성공
5. `cd packages/cdk && npx cdk synth` - CDK synth 성공
6. `npx cdk diff` - 변경사항 확인

## 참고 문서

- 상세 개발 가이드: `docs/development.md`
- 배포 가이드: `docs/deployment.md`
- 아키텍처: `docs/architecture.md`
- 로컬 테스트: `dev/localtest.md`
