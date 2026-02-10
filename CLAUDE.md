# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Serverless OpenClaw — AWS 서버리스 인프라에서 OpenClaw AI 에이전트를 on-demand로 구동. 웹 UI + Telegram 인터페이스. 비용 목표 ~$1/월.

## Build & Dev Commands

```bash
npm run build          # tsc --build (all packages via project references)
npm run lint           # eslint "packages/**/*.ts"
npm run format         # prettier
npm run test           # vitest run (단위 테스트)
npm run test:e2e       # vitest e2e (E2E 테스트)

# CDK
cd packages/cdk && npx cdk synth       # CloudFormation 생성
cd packages/cdk && npx cdk deploy      # AWS 배포
```

**Git Hooks** (husky): pre-commit → build + lint + UT, pre-push → E2E 테스트

TypeScript: ES2022, Node16 module resolution, strict, composite builds. import 경로에 `.js` 확장자 필수.

## Architecture

```
packages/
├── shared/      # 타입 + 상수 (TABLE_NAMES, BRIDGE_PORT, 키 프리픽스)
├── cdk/         # CDK 스택 (lib/stacks/)
├── gateway/     # Lambda 핸들러 6개 (ws-connect/message/disconnect, telegram-webhook, api-handler, watchdog)
├── container/   # Fargate 컨테이너 (Bridge 서버 + OpenClaw JSON-RPC 클라이언트)
└── web/         # React SPA (Vite)
```

**데이터 흐름:** 클라이언트 → API Gateway (WS/REST) → Lambda → Bridge(:8080 HTTP) → OpenClaw Gateway(:18789 WS, JSON-RPC 2.0)

**CDK 스택:** NetworkStack → StorageStack → {ApiStack, AuthStack, ComputeStack} → WebStack

## Critical Constraints

이 규칙을 위반하면 비용 폭증 또는 보안 사고 발생:

- **NAT Gateway 금지** — `natGateways: 0` 필수. Fargate Public IP + VPC Gateway Endpoints 사용
- **ALB, Interface Endpoints 금지** — API Gateway만 사용
- **DynamoDB PAY_PER_REQUEST** — 프로비저닝 모드 금지
- **시크릿 디스크 미기록** — API 키/토큰은 환경변수(Secrets Manager)로만 전달, `openclaw.json`에 미포함
- **Telegram webhook-only** — long polling 사용 금지 (API가 동시 사용 거부)
- **Bridge Bearer 토큰 필수** — `/health` 외 모든 엔드포인트
- **userId 서버사이드만** — 클라이언트 제공 userId 금지 (IDOR 방지)
- **RunTask에 `launchType` 금지** — `capacityProviderStrategy`만 사용 (동시 지정 불가)
- **S3 버킷명 하드코딩 금지** — CDK 자동 생성 (글로벌 유일성)

## DynamoDB Tables (5개)

| Table | PK | SK | TTL | GSI |
|-------|----|----|-----|-----|
| Conversations | `USER#{userId}` | `CONV#{id}#MSG#{ts}` | `ttl` | — |
| Settings | `USER#{userId}` | `SETTING#{key}` | — | — |
| TaskState | `USER#{userId}` | — | `ttl` | — |
| Connections | `CONN#{connId}` | — | `ttl` | `userId-index` |
| PendingMessages | `USER#{userId}` | `MSG#{ts}#{uuid}` | `ttl` | — |

테이블명은 `@serverless-openclaw/shared`의 `TABLE_NAMES` 상수 사용.

## Development Rules

- **TDD 필수** — UI(web 패키지)를 제외한 모든 구현은 테스트를 먼저 작성한 후 구현한다
- **Git Hooks:**
  - `pre-commit`: 단위 테스트(vitest) + lint(eslint) 통과 필수
  - `pre-push`: E2E 테스트 통과 필수
- **E2E 테스트 배포:**
  - 로컬: AWS 프로필 정보는 `.env` 파일로 관리 (`.gitignore`에 포함)
  - CI: GitHub Actions + OIDC 인증 연동으로 AWS 배포

## Key Design Patterns

- **Cold Start 메시지 큐잉:** 컨테이너 기동 중 메시지 → PendingMessages DDB 저장 → Bridge 시작 후 소비 (5분 TTL)
- **Bridge 6계층 방어:** Security Group → Bearer 토큰 → TLS → localhost 바인딩 → non-root → Secrets Manager
- **Fargate Public IP 조회:** DescribeTasks → ENI ID → DescribeNetworkInterfaces → PublicIp
- **OpenClaw 프로토콜:** JSON-RPC 2.0 / MCP over WebSocket, `?token=` 쿼리 인증

## Phase 1 Progress (7/10)

완료: 1-1(프로젝트 초기화), 1-2(NetworkStack + StorageStack), 1-3(컨테이너), 1-4(Gateway Lambda), 1-5(API Gateway), 1-6(Cognito), 1-7(Compute)
다음: 1-8(웹 UI), 1-9(Telegram), 1-10(통합 테스트)

상세: `docs/progress.md` 참조. 구현 가이드: `/implement 1-{N}` 스킬 사용.

## Reference Docs

- `docs/architecture.md` — 네트워크, CDK, DynamoDB 스키마, 보안 모델
- `docs/implementation-plan.md` — Bridge 프로토콜, 컨테이너 플로우, Telegram 전략
- `docs/cost-optimization.md` — Fargate Spot, API Gateway vs ALB 분석
- `docs/PRD.md` — 제품 요구사항
