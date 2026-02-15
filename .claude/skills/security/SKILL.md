---
name: security
description: References Serverless OpenClaw security model. Covers Bridge 6-layer defense, IDOR prevention, secret management, Cognito authentication, and IAM least privilege. Use as a security checklist when writing or reviewing code.
allowed-tools: Read, Glob, Grep
---

# Security Reference

## Security Model Details

Authentication, Bridge defense, IDOR prevention, secret management, IAM roles:
- [architecture.md §7](../../../docs/architecture.md) — Bridge defense, authentication, IDOR, secrets, IAM

## Security Checklist (For Code Writing/Review)

### Bridge Server
- [ ] Bearer token authentication applied to all endpoints except `/health`
- [ ] TLS (self-signed) applied (`https.createServer`)
- [ ] Gateway bound to `--bind localhost` to block external access
- [ ] Running as non-root user (`USER openclaw`)
- [ ] `/health` returns only `{ "status": "ok" }` (no internal info exposure)

### Secrets
- [ ] API keys/tokens NOT written to `openclaw.json`
- [ ] Using `config.auth = { method: "env" }`
- [ ] `delete config.auth?.apiKey` applied
- [ ] `delete config.gateway?.auth?.token` applied
- [ ] Delivered only via Secrets Manager → environment variables

### IDOR
- [ ] userId determined server-side (JWT `sub` or connectionId reverse lookup)
- [ ] Client-provided userId not trusted
- [ ] DynamoDB query PK uses `jwt.sub`

### Authentication
- [ ] WebSocket: `?token={jwt}` → verified in ws-connect
- [ ] REST API: Cognito User Pool Authorizer applied
- [ ] Telegram: `X-Telegram-Bot-Api-Secret-Token` verification + pairing check

### IAM
- [ ] Lambda: access only to required DynamoDB tables (resource ARN restricted)
- [ ] Fargate: access only to S3 data bucket
- [ ] ECS permissions: Condition restricted to specific cluster
- [ ] PassRole: only task-role and exec-role allowed
