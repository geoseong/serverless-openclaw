# 개발 가이드

Serverless OpenClaw 프로젝트에 기여하기 위한 로컬 개발 환경 설정 및 워크플로우를 안내합니다.

---

## 1. 로컬 개발 환경 설정

### 필수 도구

| 도구 | 최소 버전 | 용도 |
|------|----------|------|
| Node.js | v20+ | 런타임 |
| npm | v9+ | 패키지 매니저 (workspaces) |
| Docker | 최신 | 컨테이너 빌드/테스트 |
| AWS CLI | v2 | CDK 배포, 리소스 확인 |
| AWS CDK CLI | v2.170+ | 인프라 배포 |

### 초기 설정

```bash
git clone https://github.com/<owner>/serverless-openclaw.git
cd serverless-openclaw

# 의존성 설치 (모든 패키지)
npm install

# TypeScript 빌드
npm run build

# Git hooks 설정 (husky — npm install 시 자동 실행)
# pre-commit: build + lint + 단위 테스트
# pre-push: E2E 테스트
```

---

## 2. 프로젝트 구조

```
serverless-openclaw/
├── packages/
│   ├── shared/      # 공유 타입, 상수 (TABLE_NAMES, BRIDGE_PORT 등)
│   ├── gateway/     # Lambda 핸들러 6개 + 서비스 5개
│   ├── container/   # Fargate 컨테이너 (Bridge 서버 + OpenClaw 클라이언트)
│   ├── web/         # React SPA (Vite + TypeScript)
│   └── cdk/         # AWS CDK 인프라 정의 (6개 스택)
├── docs/            # 설계/배포/개발 문서
├── scripts/         # 배포 보조 스크립트
├── references/      # 참조 프로젝트 (빌드/테스트 제외)
├── vitest.config.ts        # 단위 테스트 설정
└── vitest.e2e.config.ts    # E2E 테스트 설정
```

### 패키지 의존 관계

```
shared ← gateway
shared ← container
shared ← cdk
         web (Vite 번들러가 shared를 직접 해석)
```

npm workspaces 모노레포 + TypeScript project references로 관리됩니다. 패키지 간 의존은 `"*"`로 지정합니다 (`"workspace:*"`는 pnpm 전용).

---

## 3. 빌드 커맨드

| 커맨드 | 설명 |
|--------|------|
| `npm run build` | TypeScript 빌드 (`tsc --build`, 모든 패키지) |
| `npm run lint` | ESLint 검사 (`packages/**/*.ts`) |
| `npm run format` | Prettier 포맷팅 |
| `npm run test` | 단위 테스트 (vitest) |
| `npm run test:e2e` | E2E 테스트 (vitest, `*.e2e.test.ts`) |

### CDK 커맨드

```bash
cd packages/cdk
npx cdk synth        # CloudFormation 템플릿 생성
npx cdk diff         # 변경사항 미리보기
npx cdk deploy       # AWS 배포
npx cdk destroy      # 리소스 삭제
```

---

## 4. 패키지별 개발

### shared

공유 타입과 상수를 정의합니다. 다른 모든 패키지에서 참조하므로 변경 시 영향 범위를 확인하세요.

- `src/constants.ts` — TABLE_NAMES, KEY_PREFIX, BRIDGE_PORT, 타임아웃 등
- `src/types.ts` — 공유 타입 정의

### gateway

Lambda 핸들러 6개와 서비스 5개로 구성됩니다.

```
packages/gateway/
├── src/
│   ├── handlers/    # ws-connect, ws-disconnect, ws-message,
│   │                # telegram-webhook, api-handler, watchdog
│   ├── services/    # task-state, connections, conversations,
│   │                # container, message, telegram
│   └── index.ts     # 핸들러 re-export
└── __tests__/       # 단위 테스트 (vitest)
```

**DI 패턴:** 모든 서비스는 `send` 함수를 주입받습니다. 테스트에서 mock으로 대체 가능합니다.

```typescript
// 예: createTaskStateService(send)
const send = vi.fn();
const service = createTaskStateService(send);
```

### container

Fargate에서 실행되는 Bridge 서버와 OpenClaw 클라이언트입니다.

```
packages/container/
├── src/
│   ├── bridge.ts        # HTTP 서버 (Express, Bearer 토큰 인증)
│   ├── openclaw-client.ts  # JSON-RPC 2.0 / MCP over WebSocket
│   └── lifecycle.ts     # 컨테이너 라이프사이클 관리
├── Dockerfile
└── start-openclaw.sh
```

### web

React SPA (Vite + TypeScript). Cognito SRP 인증, WebSocket 실시간 통신.

```
packages/web/
├── src/
│   ├── components/   # Auth/, Chat/, Status/
│   ├── hooks/        # useAuth, useWebSocket
│   └── services/     # auth, websocket, api
├── vite.config.ts
└── index.html
```

**로컬 개발:**

```bash
cd packages/web

# .env.local 설정 (배포된 AWS 리소스 필요)
cat > .env.local << 'EOF'
VITE_WS_URL=wss://<api-id>.execute-api.<region>.amazonaws.com/prod
VITE_API_URL=https://<api-id>.execute-api.<region>.amazonaws.com
VITE_COGNITO_USER_POOL_ID=<user-pool-id>
VITE_COGNITO_CLIENT_ID=<client-id>
EOF

npx vite dev   # http://localhost:5173
```

### cdk

6개의 CDK 스택으로 구성됩니다.

| 스택 | 주요 리소스 |
|------|------------|
| NetworkStack | VPC, 퍼블릭 서브넷, VPC Gateway Endpoints, Security Group |
| StorageStack | DynamoDB 5개, S3, ECR |
| AuthStack | Cognito User Pool, App Client |
| ComputeStack | ECS 클러스터, Fargate Task Definition |
| ApiStack | WebSocket API, HTTP API, Lambda 6개, EventBridge |
| WebStack | S3 (웹 에셋), CloudFront (OAC) |

**의존 관계:** NetworkStack → StorageStack → {AuthStack, ComputeStack} → ApiStack → WebStack

---

## 5. TDD 워크플로우

**UI(web 패키지)를 제외한 모든 구현은 TDD를 따릅니다.**

1. **테스트 먼저 작성** — 실패하는 테스트를 작성
2. **최소 구현** — 테스트를 통과하는 최소한의 코드 작성
3. **리팩토링** — 코드 정리 (테스트 통과 유지)

```bash
# 특정 파일 테스트 실행
npx vitest run packages/gateway/__tests__/services/message.test.ts

# watch 모드
npx vitest packages/gateway/__tests__/services/message.test.ts
```

### 테스트 작성 규칙

- `vi.mock` hoisting: 모듈 레벨 mock에서 변수 참조 시 `vi.hoisted()` 사용
- AWS SDK send 바인딩: `ddb.send.bind(ddb) as (cmd: any) => Promise<any>` 캐스트
- DI 패턴 활용: `send` 함수를 mock으로 주입

---

## 6. Git Hooks

husky로 관리되며, 자동으로 설정됩니다.

| Hook | 실행 내용 | 목적 |
|------|----------|------|
| `pre-commit` | `npm run build && npm run lint && npm run test` | 빌드, 린트, 단위 테스트 통과 확인 |
| `pre-push` | `npm run test:e2e` | E2E 테스트 통과 확인 |

> Hook을 우회하려면 `--no-verify` 플래그를 사용할 수 있으나, CI에서 실패할 수 있으므로 권장하지 않습니다.

---

## 7. CDK 개발

### synth 전 체크리스트

1. `npm run build` — TypeScript 빌드 성공
2. `cd packages/web && npx vite build` — web dist/ 생성
3. Secrets Manager 시크릿 존재 (배포 시에만)

### 새 스택 추가 시

1. `packages/cdk/lib/stacks/`에 스택 파일 생성
2. `packages/cdk/lib/stacks/index.ts`에 export 추가
3. `packages/cdk/bin/app.ts`에 인스턴스 생성 + 의존성 연결
4. E2E 테스트에 스택 검증 추가

---

## 8. 코딩 규칙

### TypeScript

- **타겟:** ES2022
- **모듈:** Node16 resolution
- **strict** 모드 활성화
- import 경로에 **`.js` 확장자 필수** (ESM)

```typescript
// Good
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants.js";

// Bad
import { TABLE_NAMES } from "@serverless-openclaw/shared/constants";
```

### 일반 규칙

- ESLint + Prettier 설정을 따름
- 패키지 간 의존성은 `"*"` 사용 (npm workspaces)
- 환경변수/시크릿은 코드에 하드코딩 금지
- S3 버킷명 하드코딩 금지 (CDK 자동 생성)

### Critical Constraints

비용 폭증 또는 보안 사고를 방지하기 위한 필수 규칙:

- NAT Gateway 생성 금지 (`natGateways: 0`)
- ALB, VPC Interface Endpoints 생성 금지
- DynamoDB는 `PAY_PER_REQUEST`만 사용
- userId는 서버사이드에서만 생성 (IDOR 방지)
- RunTask 호출 시 `launchType` 대신 `capacityProviderStrategy` 사용

상세: [CLAUDE.md](../CLAUDE.md) 참조
