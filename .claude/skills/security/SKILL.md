---
name: security
description: Serverless OpenClaw 보안 모델을 참조합니다. Bridge 6계층 방어, IDOR 방지, 시크릿 관리, Cognito 인증, IAM 최소 권한 등 보안 요구사항을 확인합니다. 코드 작성/리뷰 시 보안 체크리스트로 사용하세요.
allowed-tools: Read, Glob, Grep
---

# 보안 레퍼런스

## 보안 모델 상세

인증, Bridge 방어, IDOR 방지, 시크릿 관리, IAM 역할:
- [architecture.md §7](../../../docs/architecture.md) — Bridge 방어, 인증, IDOR, 시크릿, IAM

## 보안 체크리스트 (코드 작성/리뷰 시)

### Bridge 서버
- [ ] `/health` 외 모든 엔드포인트에 Bearer 토큰 인증 적용
- [ ] TLS (self-signed) 적용 (`https.createServer`)
- [ ] Gateway는 `--bind localhost`로 외부 접근 차단
- [ ] 비root 사용자 (`USER openclaw`)로 실행
- [ ] `/health`는 `{ "status": "ok" }` 만 반환 (내부 정보 노출 금지)

### 시크릿
- [ ] API 키/토큰이 `openclaw.json`에 기록되지 않음
- [ ] `config.auth = { method: "env" }` 사용
- [ ] `delete config.auth?.apiKey` 적용
- [ ] `delete config.gateway?.auth?.token` 적용
- [ ] Secrets Manager → 환경변수로만 전달

### IDOR
- [ ] userId는 서버 측 결정 (JWT `sub` 또는 connectionId 역조회)
- [ ] 클라이언트가 보낸 userId를 신뢰하지 않음
- [ ] DynamoDB 쿼리 PK에 `jwt.sub` 사용

### 인증
- [ ] WebSocket: `?token={jwt}` → ws-connect에서 검증
- [ ] REST API: Cognito User Pool Authorizer 적용
- [ ] Telegram: `X-Telegram-Bot-Api-Secret-Token` 검증 + 페어링 확인

### IAM
- [ ] Lambda: 필요한 DynamoDB 테이블만 접근 (리소스 ARN 제한)
- [ ] Fargate: S3 데이터 버킷만 접근
- [ ] ECS 권한: 특정 클러스터로 Condition 제한
- [ ] PassRole: task-role, exec-role만 허용
