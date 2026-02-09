---
name: cost
description: Serverless OpenClaw 비용 최적화 가이드라인을 참조합니다. 구현 시 비용 목표($1/월)를 초과하는 리소스가 생성되지 않도록 검증합니다. CDK 스택 작성이나 인프라 변경 시 사용하세요.
allowed-tools: Read, Glob, Grep
---

# 비용 최적화 레퍼런스

## 비용 분석 상세

서비스별 비용 산출, 최적화 전후 비교, 체크리스트:
- [cost-optimization.md](../../../docs/cost-optimization.md)

## 비용 검증 (인프라 변경 시 필수 확인)

다음 리소스가 **생성되지 않았는지** 확인:

| 금지 리소스 | 월 비용 | 대안 |
|------------|--------|------|
| NAT Gateway | ~$33 | Fargate Public IP |
| ALB/ELB | ~$18-25 | API Gateway |
| Interface Endpoint | ~$7/개 | Public IP로 공개 endpoint 접근 |
| DynamoDB Provisioned | 가변 | PAY_PER_REQUEST |
| Lambda VPC 배치 | NAT 필요 | VPC 외부 배치 |

## 비용 목표

| 구분 | 목표 |
|------|------|
| 프리 티어 내 | ~$0.23/월 |
| 프리 티어 후 | ~$1.07/월 |
| 최대 허용 | $10/월 미만 |
