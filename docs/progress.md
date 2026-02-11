# 프로젝트 진행 계획

Serverless OpenClaw 프로젝트의 전체 진행 상황과 앞으로의 계획을 추적하는 문서.

---

## 진행 현황 요약

| Phase | 설명 | 상태 |
|-------|------|------|
| **Phase 0** | 문서화 및 설계 | **완료** |
| **Phase 1** | MVP 구현 (10단계) | **완료** (10/10) |
| Phase 2 | 브라우저 자동화 + 커스텀 Skills | 미착수 |
| Phase 3 | 고급 기능 (모니터링, 스케줄링, 멀티채널) | 미착수 |

---

## Phase 0: 문서화 및 설계 (완료)

### 0-1. 초기 문서 작성 (완료)

| 문서 | 설명 | 커밋 |
|------|------|------|
| [PRD.md](PRD.md) | 프로젝트 요구사항 정의 | `80d6f20` |
| [README.md](../README.md) | 프로젝트 개요 | `a04562f` |
| [cost-optimization.md](cost-optimization.md) | 비용 최적화 분석 | `d08acd1` |
| [architecture.md](architecture.md) | 상세 아키텍처 설계 | `6d27541` |
| [implementation-plan.md](implementation-plan.md) | MoltWorker 참조 기반 세부 설계 + 구현 계획 | `3deecd2` |

### 0-2. 설계 리뷰 및 보완 (완료, 미커밋)

`/review` 수행 후 발견된 P0/P1 이슈 및 보안 항목을 모두 반영.

#### P0 (Blocker) — 3건 해결

| ID | 이슈 | 해결 내용 | 수정 파일 |
|----|------|----------|----------|
| P0-1 | NAT Gateway 비용 ($32/월) | Fargate Public IP + Lambda VPC 외부 + VPC Gateway Endpoints (DynamoDB, S3) | architecture, implementation-plan, cost-optimization, README |
| P0-2 | OpenClaw WS 프로토콜 미명세 | JSON-RPC 2.0 / MCP over WebSocket, `?token=` 인증 문서화. OpenClawClient 코드 전면 재작성 | implementation-plan |
| P0-3 | RunTask API 파라미터 충돌 | `launchType`과 `capacityProviderStrategy` 동시 지정 불가 — `capacityProviderStrategy`만 사용 | implementation-plan |

#### P1 (Critical) — 3건 해결

| ID | 이슈 | 해결 내용 | 수정 파일 |
|----|------|----------|----------|
| P1-1 | Telegram webhook + long polling 충돌 | Telegram API는 webhook 설정 시 getUpdates 거부 — Webhook-only 방식으로 변경 | implementation-plan |
| P1-2 | Lambda VPC 배치 모순 | Lambda는 VPC 외부 배치 (공개 AWS endpoint 사용)로 통일 | architecture, implementation-plan |
| P1-3 | Cold start 메시지 유실 | PendingMessages DynamoDB 테이블 추가 (5분 TTL). Lambda가 저장 → Bridge가 기동 후 소비 | architecture, implementation-plan, PRD |

#### 보안 — 5건 해결

| 항목 | 해결 내용 | 수정 파일 |
|------|----------|----------|
| Bridge 6계층 방어 | SG → Bearer 토큰 → TLS (self-signed, Phase 1) → localhost 바인딩 → non-root → Secrets Manager | architecture |
| /health 최소 정보 노출 | `{"status":"ok"}` 만 반환, 버전/시스템 정보 제거 | implementation-plan |
| IDOR 방지 | 4계층 userId 검증 (Lambda JWT, Bridge Lambda-only 신뢰, REST jwt.sub, Telegram 페어링 검증) | architecture (7.8) |
| 시크릿 디스크 미기록 | `openclaw.json`에 API 키/토큰 미기록. `--auth-choice env`로 환경변수만 사용 | architecture (7.9), implementation-plan |
| CLI 토큰 노출 방지 | config 파치에서 gateway 토큰 삭제, Telegram 채널 설정 삭제 | implementation-plan |

#### 기타 정합성 수정

- README: "프라이빗 서브넷" → "퍼블릭 서브넷 + 다층 방어"
- 모든 `http://{publicIp}` → `https://{publicIp}`
- PRD DynamoDB 테이블: 3개 → 5개 (Connections, PendingMessages 추가)
- TaskState PK: `taskId` → `userId`

---

## Phase 1: MVP 구현 (완료)

10단계로 구성. 각 단계는 이전 단계의 결과물에 의존한다.

### 의존 관계

```mermaid
graph TD
    S1["1-1 프로젝트 초기화"]
    S2["1-2 인프라 기반"]
    S3["1-3 OpenClaw 컨테이너"]
    S4["1-4 Gateway Lambda"]
    S5["1-5 API Gateway"]
    S6["1-6 Cognito 인증"]
    S7["1-7 Compute"]
    S8["1-8 웹 채팅 UI"]
    S9["1-9 Telegram 봇"]
    S10["1-10 통합 테스트"]

    S1 --> S2
    S1 --> S3
    S1 --> S4
    S2 --> S5
    S2 --> S6
    S2 --> S7
    S3 --> S7
    S4 --> S5
    S5 --> S8
    S6 --> S5
    S6 --> S8
    S7 --> S5
    S5 --> S9
    S8 --> S10
    S9 --> S10
```

### 단계별 상세

| 단계 | 목표 | 주요 산출물 | 검증 기준 | 상태 |
|------|------|------------|----------|------|
| **1-1** | 프로젝트 초기화 | npm workspaces 모노레포, TypeScript 프로젝트 참조, CDK 스켈레톤, 공유 타입 | `npm install` + `npx tsc --build` 성공 | **완료** |
| **1-2** | 인프라 기반 | NetworkStack (VPC, 퍼블릭 서브넷, VPC GW Endpoints), StorageStack (DDB 5개, S3 2개, ECR) | `cdk deploy NetworkStack StorageStack` 성공 | **완료** |
| **1-3** | OpenClaw 컨테이너 | Dockerfile, start-openclaw.sh, Bridge 서버, OpenClawClient (JSON-RPC 2.0), Lifecycle Manager | 로컬 `docker build` + `docker run` + `/health` 응답 | **완료** |
| **1-4** | Gateway Lambda | Lambda 6개 (ws-connect, ws-message, ws-disconnect, telegram-webhook, api-handler, watchdog), 서비스 모듈 5개 | 단위 테스트 (vitest) 통과 | **완료** |
| **1-5** | API Gateway | WebSocket API + REST API CDK, Cognito Authorizer, Lambda 배포, EventBridge Rule | `cdk deploy ApiStack` + WebSocket 연결 테스트 | **완료** |
| **1-6** | Cognito 인증 | AuthStack (User Pool, App Client, PKCE flow, 호스팅 도메인) | Cognito 테스트 사용자 + JWT 발급 확인 | **완료** |
| **1-7** | Compute | ComputeStack (ECS 클러스터, Fargate 태스크 정의, ARM64, FARGATE_SPOT, Secrets Manager) | `cdk deploy ComputeStack` + 수동 RunTask + `/health` 응답 | **완료** |
| **1-8** | 웹 채팅 UI | React SPA (Vite), Cognito 인증, WebSocket 클라이언트, 채팅 UI, Cold start 상태, WebStack CDK | 로컬 `npm run dev` + WebSocket + 메시지 송수신 | **완료** |
| **1-9** | Telegram 봇 | Webhook 등록, secret token 검증, 메시지 라우팅, cold start 응답, Bot API sendMessage | Telegram 메시지 → 응답 수신 | **완료** |
| **1-10** | 통합 테스트/문서화 | E2E 테스트, deployment.md, development.md | 클린 AWS 계정에서 `cdk deploy --all` 성공 | **완료** |

### 병렬 구현 가능 그룹

의존 관계 기반으로 최대 병렬화할 수 있는 작업 그룹:

| 순서 | 병렬 실행 가능 단계 | 선행 조건 |
|------|-------------------|----------|
| 1 | **1-1** 프로젝트 초기화 | 없음 |
| 2 | **1-2** 인프라, **1-3** 컨테이너, **1-4** Gateway Lambda | 1-1 완료 |
| 3 | **1-5** API Gateway, **1-6** Cognito, **1-7** Compute | 1-2, 1-3, 1-4 완료 |
| 4 | **1-8** 웹 UI, **1-9** Telegram | 1-5, 1-6 완료 |
| 5 | **1-10** 통합 테스트 | 1-8, 1-9 완료 |

### 1-4 Gateway Lambda 상세 (완료)

| 구분 | 파일 | 설명 |
|------|------|------|
| **서비스** | `task-state.ts` | DDB TaskState 조회/저장, Idle 상태는 null 반환 |
| | `connections.ts` | DDB Connections CRUD, 24시간 TTL |
| | `conversations.ts` | DDB Conversations 조회 (역순, 기본 50건), 저장 |
| | `container.ts` | ECS RunTask (`capacityProviderStrategy` only), getPublicIp (ENI 체인), StopTask |
| | `message.ts` | 라우팅 로직: Running → Bridge HTTP, Starting → PendingMsg only, null → PendingMsg + RunTask |
| **핸들러** | `ws-connect.ts` | JWT sub에서 userId 추출, connectionId 저장 |
| | `ws-disconnect.ts` | connectionId 삭제 |
| | `ws-message.ts` | sendMessage → routeMessage, getStatus → TaskState 반환 |
| | `telegram-webhook.ts` | `X-Telegram-Bot-Api-Secret-Token` 검증, userId=`telegram:{fromId}` |
| | `api-handler.ts` | GET /conversations, GET /status |
| | `watchdog.ts` | 비활성 15분 초과 태스크 종료, 5분 미만 보호 |
| **index.ts** | `src/index.ts` | 핸들러 6개 re-export |

검증 결과:
- 단위 테스트: 49개 (서비스 28 + 핸들러 21) 전체 통과
- TypeScript 빌드: 통과
- ESLint: 통과

설계 패턴:
- DI 패턴: `send` 함수 주입 (container 패키지와 동일)
- AWS SDK send 바인딩: `ddb.send.bind(ddb) as (cmd: any) => Promise<any>`
- userId 서버사이드만: JWT sub (웹) / `telegram:{fromId}` (Telegram)
- IDOR 방지: 클라이언트 userId 절대 신뢰하지 않음

### 1-8 웹 채팅 UI 상세 (완료)

| 구분 | 파일 | 설명 |
|------|------|------|
| **프로젝트 설정** | `index.html` | Vite 엔트리 포인트 |
| | `vite.config.ts` | `@vitejs/plugin-react`, `VITE_` prefix |
| | `vite-env.d.ts` | 환경변수 타입 선언 (WS_URL, API_URL, COGNITO_*) |
| **인증** | `services/auth.ts` | Cognito SRP 인증 래퍼 (signIn/signUp/confirmSignUp/signOut/getSession) |
| | `hooks/useAuth.ts` | 인증 상태 훅 (세션 복구, 에러 처리) |
| | `components/Auth/AuthProvider.tsx` | React Context 인증 전역 제공 |
| | `components/Auth/LoginForm.tsx` | 로그인/회원가입/인증코드 확인 폼 |
| **WebSocket** | `services/websocket.ts` | WebSocketClient 클래스 (자동 재연결, 지수 백오프, 하트비트) |
| | `hooks/useWebSocket.ts` | WS 연결 훅 (메시지/스트리밍/상태 관리) |
| **REST API** | `services/api.ts` | fetchConversations, fetchStatus |
| **채팅 UI** | `components/Chat/ChatContainer.tsx` | 메인 레이아웃 (AgentStatus + MessageList + MessageInput) |
| | `components/Chat/MessageList.tsx` | 메시지 목록 (자동 스크롤, 스트리밍 커서) |
| | `components/Chat/MessageInput.tsx` | 입력 (Enter 전송, Shift+Enter 줄바꿈, 자동 높이) |
| | `components/Status/AgentStatus.tsx` | 에이전트 상태 표시 (Idle/Starting/Running/Stopping) |
| **CDK** | `web-stack.ts` | S3 버킷 + CloudFront (OAC, SPA 라우팅, BucketDeployment) |

검증 결과:
- TypeScript 빌드: 통과
- Vite 빌드: 통과 (dist/ 생성)
- CDK synth: 통과 (WebStack 포함 6개 스택)
- ESLint: 통과
- 단위 테스트: 92개 전체 통과 (기존 테스트 미파손)

설계 결정:
- S3 webBucket을 WebStack 내부에 생성 (StorageStack → WebStack 순환 의존성 방지)
- `amazon-cognito-identity-js` SRP 인증 (Hosted UI 불필요)
- `@serverless-openclaw/shared` 직접 import (Vite Bundler 모듈 해석)
- WebSocket `?token={idToken}` 쿼리 인증 (API GW $connect Authorization 헤더 미지원)
- Plain CSS + CSS 변수 (다크/라이트 모드 자동 감지)

### 1-9 Telegram 봇 상세 (완료)

| 구분 | 파일 | 설명 |
|------|------|------|
| **서비스** | `services/telegram.ts` | Telegram Bot API sendMessage 래퍼 (fire-and-forget) |
| **핸들러** | `handlers/telegram-webhook.ts` | cold start 감지 → "깨우는 중..." 즉시 응답 추가 |
| **CDK** | `api-stack.ts` | `TELEGRAM_BOT_TOKEN` 환경변수 주입 |
| **스크립트** | `scripts/setup-telegram-webhook.sh` | Webhook URL + secret token 등록 |

검증 결과:
- 단위 테스트: 99개 전체 통과 (telegram 서비스 4개 + webhook 핸들러 7개 신규/수정)
- TypeScript 빌드: 통과
- CDK synth: 통과
- ESLint: 통과

설계 결정:
- Cold start 감지: `getTaskState` 결과가 null 또는 Starting이면 즉시 Telegram 응답
- sendTelegramMessage는 fire-and-forget (실패해도 throw하지 않음 — 메시지 라우팅에 영향 없도록)
- `TELEGRAM_BOT_TOKEN`과 `TELEGRAM_SECRET_TOKEN` 분리 (같은 Secrets Manager 시크릿이지만 용도가 다름)

### 1-10 통합 테스트/문서화 상세 (완료)

| 구분 | 파일 | 설명 |
|------|------|------|
| **배포 가이드** | `docs/deployment.md` | 사전 요구사항, 시크릿 설정, 빌드, 배포, 검증, 트러블슈팅 |
| **개발 가이드** | `docs/development.md` | 로컬 환경, 빌드, 패키지별 개발, TDD, Git Hooks, 코딩 규칙 |
| **E2E 테스트** | `packages/cdk/__tests__/stacks.e2e.test.ts` | 6개 CDK 스택 synth + 주요 리소스 검증 (24개 테스트) |
| **설정** | `vitest.config.ts` | 단위 테스트에서 `*.e2e.test.ts` 제외 |

검증 결과:
- 단위 테스트: 99개 전체 통과 (기존 테스트 미파손)
- E2E 테스트: 24개 전체 통과 (CDK synth 6개 스택)
- TypeScript 빌드: 통과
- ESLint: 통과

E2E 테스트 범위:
- NetworkStack: VPC, NAT Gateway 없음, 퍼블릭 서브넷 2개, VPC Gateway Endpoints, Security Group
- StorageStack: DynamoDB 5개 (PAY_PER_REQUEST), GSI, S3, ECR
- AuthStack: Cognito User Pool, SRP 인증, User Pool Domain
- ComputeStack: ECS 클러스터, Fargate Task Definition (ARM64), CloudWatch Log Group
- ApiStack: Lambda 6개 (ARM64), WebSocket API, HTTP API, EventBridge watchdog
- WebStack: S3, CloudFront, OAC, SPA 에러 응답

---

## Phase 2: 브라우저 자동화 + 커스텀 Skills (미착수)

| 단계 | 작업 |
|------|------|
| 2-1 | Chromium 포함 Docker 이미지 빌드 |
| 2-2 | 브라우저 자동화 skill 연동 |
| 2-3 | 커스텀 skill 업로드/관리 API |
| 2-4 | 설정 관리 UI (LLM 프로바이더 선택, skill 관리) |

## Phase 3: 고급 기능 (미착수)

| 단계 | 작업 |
|------|------|
| 3-1 | CloudWatch 알림 + 비용 대시보드 |
| 3-2 | EventBridge 기반 정기 태스크 스케줄링 |
| 3-3 | 추가 메신저 (Discord, Slack) 지원 |

---

## 핵심 아키텍처 결정 기록

향후 참고를 위해 Phase 0에서 내린 주요 결정과 그 근거를 기록한다.

| 결정 | 선택 | 근거 |
|------|------|------|
| 컴퓨팅 | Fargate Spot (Lambda 컨테이너 불가) | OpenClaw는 15분 초과 장기 실행 + WebSocket 필요 |
| 네트워크 | 퍼블릭 서브넷 + Public IP | NAT Gateway $32/월 제거, 다층 방어로 보안 보완 |
| Telegram | Webhook-only | API가 webhook 설정 시 getUpdates 거부 |
| Cold start 메시지 | PendingMessages DDB (5분 TTL) | Lambda → DDB 저장, Bridge 기동 후 소비 |
| Gateway 프로토콜 | JSON-RPC 2.0 / MCP over WebSocket | MoltWorker 분석 + Perplexity 조사 결과 확인 |
| 시크릿 관리 | Secrets Manager → 환경변수 only | 디스크/config 파일에 절대 미기록 |
| Bridge 보안 | 6계층 방어 | SG, Bearer 토큰, TLS, localhost, non-root, Secrets Manager |
| 개발 방법론 | TDD (UI 제외) | 테스트 먼저 작성 후 구현, vitest 사용 |
| Git Hooks | pre-commit: UT + lint, pre-push: E2E | husky로 관리 |
| E2E 배포 | 로컬(.env) + GitHub Actions(OIDC) | AWS 프로필은 .env, CI는 OIDC 인증 연동 |
