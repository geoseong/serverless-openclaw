---
name: architecture
description: Serverless OpenClaw 아키텍처를 참조합니다. 네트워크 설계, CDK 스택 구조, DynamoDB 데이터 모델, API 프로토콜, 컨테이너 설계를 확인할 수 있습니다.
allowed-tools: Read, Glob, Grep
---

# 아키텍처 레퍼런스

## 설계 문서

- [architecture.md](../../../docs/architecture.md) — VPC/네트워크, 보안 그룹, CDK 스택, DynamoDB 스키마, API 프로토콜, 보안 모델
- [implementation-plan.md](../../../docs/implementation-plan.md) — MoltWorker 참조 기반 세부 설계

## 핵심 아키텍처 원칙

1. **비용 최소화**: NAT Gateway 없음, ALB 없음, Interface Endpoint 없음
2. **서버리스 우선**: Lambda (이벤트), Fargate Spot (장기 실행), DynamoDB (PAY_PER_REQUEST)
3. **단일 책임**: Lambda 6개 분리, CDK 스택 6개 분리
4. **계층 분리**: API Gateway → Lambda → Bridge → OpenClaw Gateway
5. **프로토콜 변환**: Lambda(HTTP) ↔ Bridge ↔ OpenClaw Gateway(JSON-RPC 2.0 WebSocket)
