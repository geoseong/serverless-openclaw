# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Serverless OpenClaw — Runs the OpenClaw AI agent on-demand on AWS serverless infrastructure. Web UI + Telegram interface. Cost target ~$1/month.

## Build & Dev Commands

```bash
npm run build          # tsc --build (all packages via project references)
npm run lint           # eslint "packages/**/*.ts"
npm run format         # prettier
npm run test           # vitest run (unit tests)
npm run test:e2e       # vitest e2e (E2E tests)

# CDK
cd packages/cdk && npx cdk synth       # Generate CloudFormation
cd packages/cdk && npx cdk deploy      # Deploy to AWS
```

**Git Hooks** (husky): pre-commit -> build + lint + UT, pre-push -> E2E tests

TypeScript: ES2022, Node16 module resolution, strict, composite builds. `.js` extension required in import paths.

## Architecture

```
packages/
├── shared/      # Types + constants (TABLE_NAMES, BRIDGE_PORT, key prefixes)
├── cdk/         # CDK stacks (lib/stacks/)
├── gateway/     # 6 Lambda handlers (ws-connect/message/disconnect, telegram-webhook, api-handler, watchdog)
├── container/   # Fargate container (Bridge server + OpenClaw JSON-RPC client)
└── web/         # React SPA (Vite)
```

**Data Flow:** Client -> API Gateway (WS/REST) -> Lambda -> Bridge(:8080 HTTP) -> OpenClaw Gateway(:18789 WS, JSON-RPC 2.0)

**CDK Stacks:** NetworkStack -> StorageStack -> {ApiStack, AuthStack, ComputeStack} -> WebStack

## Critical Constraints

Violating these rules will cause cost spikes or security incidents:

- **No NAT Gateway** — `natGateways: 0` required. Use Fargate Public IP + VPC Gateway Endpoints
- **No ALB, no Interface Endpoints** — Use API Gateway only
- **DynamoDB PAY_PER_REQUEST** — Provisioned mode prohibited
- **No secrets written to disk** — API keys/tokens delivered only via environment variables (Secrets Manager), not included in `openclaw.json`
- **Telegram webhook-only** — Long polling prohibited (API rejects simultaneous use)
- **Bridge Bearer token required** — For all endpoints except `/health`
- **Server-side userId only** — Client-provided userId prohibited (IDOR prevention)
- **No `launchType` in RunTask** — Use `capacityProviderStrategy` only (cannot be specified simultaneously)
- **No hardcoded S3 bucket names** — CDK auto-generates them (global uniqueness)

## DynamoDB Tables (5)

| Table | PK | SK | TTL | GSI |
|-------|----|----|-----|-----|
| Conversations | `USER#{userId}` | `CONV#{id}#MSG#{ts}` | `ttl` | — |
| Settings | `USER#{userId}` | `SETTING#{key}` | — | — |
| TaskState | `USER#{userId}` | — | `ttl` | — |
| Connections | `CONN#{connId}` | — | `ttl` | `userId-index` |
| PendingMessages | `USER#{userId}` | `MSG#{ts}#{uuid}` | `ttl` | — |

Table names use the `TABLE_NAMES` constant from `@serverless-openclaw/shared`.

## Development Rules

- **TDD required** — For all implementations except the UI (web package), write tests first before implementing
- **Git Hooks:**
  - `pre-commit`: Must pass unit tests (vitest) + lint (eslint)
  - `pre-push`: Must pass E2E tests
- **E2E Test Deployment:**
  - Local: AWS profile information managed via `.env` file (included in `.gitignore`)
  - CI: AWS deployment via GitHub Actions + OIDC authentication

## Key Design Patterns

- **Cold Start Message Queuing:** Messages during container startup -> stored in PendingMessages DDB -> consumed after Bridge starts (5-minute TTL)
- **Bridge 6-Layer Defense:** Security Group -> Bearer token -> TLS -> localhost binding -> non-root -> Secrets Manager
- **Fargate Public IP Lookup:** DescribeTasks -> ENI ID -> DescribeNetworkInterfaces -> PublicIp
- **OpenClaw Protocol:** JSON-RPC 2.0 / MCP over WebSocket, `?token=` query authentication

## Phase 1 Progress (10/10 — Complete)

Completed: 1-1 (Project init), 1-2 (NetworkStack + StorageStack), 1-3 (Container), 1-4 (Gateway Lambda), 1-5 (API Gateway), 1-6 (Cognito), 1-7 (Compute), 1-8 (Web UI), 1-9 (Telegram), 1-10 (Integration tests/documentation)

Details: See `docs/progress.md`. Implementation guide: Use `/implement 1-{N}` skill.

## Reference Docs

- `docs/architecture.md` — Network, CDK, DynamoDB schema, security model
- `docs/implementation-plan.md` — Bridge protocol, container flow, Telegram strategy
- `docs/cost-optimization.md` — Fargate Spot, API Gateway vs ALB analysis
- `docs/PRD.md` — Product requirements
- `docs/deployment.md` — AWS deployment guide (secrets, build, deploy, verification)
- `docs/development.md` — Local development guide (environment, TDD, coding rules)
