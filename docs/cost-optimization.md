# 비용 최적화 분석

## 요약

Fargate Spot + API Gateway 조합으로 극한의 비용 최적화를 적용한 결과:

| 구분 | 프리 티어 내 (12개월) | 프리 티어 만료 후 |
|------|---------------------|-----------------|
| **최적화 전** (Fargate On-Demand) | ~$3-5/월 | ~$5-10/월 |
| **최적화 후** (Fargate Spot) | **~$0.10/월** | **~$1-2/월** |
| **절감률** | ~97% | ~80% |

---

## 1. Fargate Spot vs On-Demand 비교

### 가격 비교 (us-east-1)

| 리소스 | On-Demand | Fargate Spot | 할인율 |
|--------|-----------|-------------|--------|
| vCPU | $0.04048/시간 | $0.01244/시간 | **~70%** |
| Memory (GB) | $0.00445/시간 | $0.00137/시간 | **~70%** |

### 월간 비용 계산 (0.25 vCPU, 0.5GB, 하루 2시간)

**사용 시간**: 2시간/일 x 30일 = 60시간/월

| 항목 | On-Demand | Fargate Spot |
|------|-----------|-------------|
| vCPU (0.25) | $0.61 | **$0.19** |
| Memory (0.5GB) | $0.13 | **$0.04** |
| **소계** | **$0.74** | **$0.23** |

### Fargate Spot 주의사항

- **2분 사전 경고**: AWS가 용량 회수 시 2분 전 통지
- **SLA 없음**: 가용성 보장 없음
- **중단 대응 필요**: Graceful shutdown 구현 필수

### Spot 중단 대응 전략

OpenClaw의 on-demand 특성상 Spot과 잘 맞음:
1. **대화 상태 자동 저장**: DynamoDB에 실시간 상태 저장하여 중단 시에도 복구 가능
2. **Graceful shutdown**: SIGTERM 수신 시 2분 내 현재 작업 완료 및 상태 저장
3. **자동 재시작**: 중단 후 다음 요청 시 새 Spot 태스크 자동 기동
4. **Fallback 불필요**: 개인용이므로 잠시 대기 후 재접속으로 충분

---

## 2. API Gateway vs ALB 비교

### 가격 비교 (월 10,000 요청 + WebSocket 기준)

| 항목 | API Gateway | ALB |
|------|-------------|-----|
| 고정 비용 | $0 | ~$16-18 (시간당 $0.0225 x 730시간) |
| 요청 비용 (REST 10K) | ~$0.035 | ~$0.08 (LCU) |
| WebSocket | ~$0.01 (메시지 + 연결분) | LCU에 포함 |
| 데이터 전송 | ~$0.01 | ~$0.01 |
| **월 합계** | **~$0.05** | **~$18-25** |
| **프리 티어** | 1M REST 요청 + 1M WebSocket 메시지 무료 | 프리 티어 없음 (WebSocket) |

### 결론

개인 사용(저트래픽) 환경에서 API Gateway가 ALB 대비 **월 $18-25 절감**. 저트래픽에서는 API Gateway가 압도적으로 유리.

---

## 3. 서비스별 상세 비용 (최적화 후)

### 조건
- 리전: us-east-1
- Fargate Spot: 0.25 vCPU, 0.5GB, 하루 2시간
- 월 10,000 요청, WebSocket 동시 접속 10개, 일 평균 30분 사용
- DynamoDB: 월 100K 읽기/쓰기
- S3: 1GB 이하

### 프리 티어 내 (가입 후 12개월)

| 서비스 | 월 비용 | 비고 |
|--------|--------|------|
| ECS Fargate Spot | **$0.23** | Fargate는 별도 프리 티어 없음 |
| API Gateway (WebSocket + REST) | $0.00 | 1M 요청 + 1M 메시지 프리 티어 |
| DynamoDB | $0.00 | 25GB 스토리지 + 25 RCU/WCU 프리 티어 |
| S3 | $0.00 | 5GB 프리 티어 |
| CloudFront | $0.00 | 1TB 전송 + 10M 요청 프리 티어 |
| Cognito | $0.00 | 50,000 MAU 무기한 무료 |
| CloudWatch | $0.00 | 5GB 로그 수집 프리 티어 |
| ECR | $0.00 | 500MB 스토리지 프리 티어 |
| **합계** | **~$0.23/월** | |

### 프리 티어 만료 후

| 서비스 | 월 비용 | 산출 근거 |
|--------|--------|----------|
| ECS Fargate Spot | **$0.23** | vCPU: 0.25 x $0.01244 x 60h = $0.19, Mem: 0.5 x $0.00137 x 60h = $0.04 |
| API Gateway REST | $0.04 | 10K 요청 x $3.50/1M = $0.035 |
| API Gateway WebSocket | $0.01 | 10K 메시지 + ~13,500 연결분 = ~$0.01 |
| DynamoDB | $0.16 | 100K 읽기($0.025) + 100K 쓰기($0.125) + 1GB 스토리지($0.01) |
| S3 | $0.03 | 1GB x $0.023 + 요청 비용 |
| CloudFront | $0.09 | 1GB 전송($0.085) + 10K 요청($0.01) |
| Cognito | $0.00 | 50,000 MAU 무기한 무료 |
| CloudWatch | $0.50 | 1GB 로그 수집($0.50) |
| ECR | $0.01 | ~100MB Docker 이미지 |
| **합계** | **~$1.07/월** | |

---

## 4. On-Demand 대비 최적화 효과 요약

```
최적화 전 (Fargate On-Demand + ALB 가정):
  Fargate On-Demand:  $0.74/월
  ALB:               $18.00/월
  기타:               $1.00/월
  합계:              ~$19.74/월

최적화 후 (Fargate Spot + API Gateway):
  Fargate Spot:       $0.23/월
  API Gateway:        $0.05/월
  기타:               $0.79/월
  합계:              ~$1.07/월

절감액: ~$18.67/월 (~95% 절감)
```

---

## 5. 추가 비용 최적화 옵션

| 전략 | 절감 효과 | 트레이드오프 |
|------|----------|------------|
| **Fargate 스펙 축소** (0.25 vCPU, 0.5GB → 최소치 유지) | 이미 최소 스펙 적용 | OpenClaw 성능 제한 가능 |
| **비활성 타임아웃 단축** (15분 → 5분) | 컨테이너 실행 시간 ~30% 감소 | Cold start 빈도 증가 |
| **CloudWatch 로그 보존 기간 단축** | 로그 스토리지 비용 절감 | 디버깅 이력 제한 |
| **S3 Intelligent-Tiering** | 비활성 데이터 자동 비용 절감 | 1GB 이하에서는 효과 미미 |
| **Compute Savings Plans** (1년 약정) | Fargate 추가 50% 할인 | 장기 약정 필요 |

---

## 참고 자료

- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Fargate Spot vs On-Demand - CloudZero](https://www.cloudzero.com/blog/fargate-cost/)
- [Fargate Pricing Deep Dive - Vantage](https://www.vantage.sh/blog/fargate-pricing)
- [Fargate Pricing Explained - CloudChipr](https://cloudchipr.com/blog/aws-fargate-pricing)
- [Fargate Pricing Guide - CloudExMachina](https://www.cloudexmachina.io/blog/fargate-pricing)
- [AWS API Gateway Pricing](https://aws.amazon.com/api-gateway/pricing/)
- [API Gateway Pricing Explained - CloudZero](https://www.cloudzero.com/blog/aws-api-gateway-pricing/)
- [API Gateway Pricing - CostGoat](https://costgoat.com/pricing/amazon-api-gateway)
- [API Gateway Pricing - AWSForEngineers](https://awsforengineers.com/blog/aws-api-gateway-pricing-explained/)
