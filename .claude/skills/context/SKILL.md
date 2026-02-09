---
name: context
description: Serverless OpenClaw 프로젝트 컨텍스트를 로드합니다. 프로젝트 개요, 기술 스택, 아키텍처 결정, 데이터 모델 등 개발에 필요한 배경 지식을 제공합니다.
user-invocable: false
---

# Serverless OpenClaw 프로젝트 컨텍스트

이 스킬은 프로젝트의 핵심 컨텍스트를 제공합니다. 구현 작업 시 자동으로 참조됩니다.

## 프로젝트 개요 및 핵심 결정

상세 내용은 [PRD.md](../../../docs/PRD.md)를 참조하세요:
- 프로젝트 정의, 목표, 기술 스택
- 핵심 아키텍처 결정 7가지와 근거
- 모노레포 구조 (packages/cdk, gateway, container, web, shared)
- DynamoDB 5개 테이블 스키마
- 핵심 데이터 흐름

## 핵심 제약 사항 (구현 시 반드시 준수)

1. **NAT Gateway 금지** — Fargate Public IP + VPC Gateway Endpoints 사용
2. **시크릿 디스크 미기록** — Secrets Manager → 환경변수만. `openclaw.json`에 API 키/토큰 절대 기록 금지
3. **Telegram Webhook-only** — long polling 사용 불가 (API 상호 배타)
4. **Bridge Bearer 토큰 필수** — `/health` 외 모든 엔드포인트 인증
5. **IDOR 방지** — userId는 서버 측 결정 (JWT/connectionId 역조회). 클라이언트 입력 무시
6. **RunTask API** — `capacityProviderStrategy`만 사용. `launchType` 동시 지정 불가
7. **비용 목표** — 월 ~$1. ALB, Interface Endpoint, NAT Gateway 생성 금지

## 관련 문서

- 전체 PRD: [docs/PRD.md](../../../docs/PRD.md)
- 아키텍처: [docs/architecture.md](../../../docs/architecture.md)
- 구현 계획: [docs/implementation-plan.md](../../../docs/implementation-plan.md)
- 비용 분석: [docs/cost-optimization.md](../../../docs/cost-optimization.md)
- 진행 현황: [docs/progress.md](../../../docs/progress.md)
