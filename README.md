# Serverless OpenClaw

AWS 서버리스 인프라에서 [OpenClaw](https://github.com/openclaw/openclaw)를 on-demand로 구동하고, 웹 UI와 Telegram을 인터페이스로 제공하는 오픈소스 프로젝트입니다.

[Cloudflare MoltWorker](https://github.com/cloudflare/moltworker)의 아키텍처를 참고하되, AWS 생태계에 최적화된 독자적인 서버리스 솔루션을 제공합니다.

## 주요 특징

- **서버리스 On-demand 실행**: ECS Fargate Spot 기반으로 요청 시에만 컨테이너를 구동하여 비용 최소화 (~$1/월)
- **웹 채팅 UI**: React SPA 기반 실시간 채팅 인터페이스 (S3 + CloudFront 호스팅)
- **Telegram 봇 통합**: Telegram을 통한 어디서든 AI 에이전트와 대화
- **멀티 LLM 지원**: Claude, GPT, DeepSeek 등 사용자가 원하는 LLM 프로바이더 선택 가능
- **태스크 자동화**: OpenClaw skills를 통한 다양한 태스크 자동 수행
- **원커맨드 배포**: `cdk deploy` 한 번으로 전체 인프라 배포

## 아키텍처

```mermaid
graph TB
    User[사용자]

    subgraph "인터페이스"
        WebUI[React SPA\nS3 + CloudFront]
        TGBot[Telegram Bot]
    end

    subgraph "API 계층"
        APIGW[API Gateway\nWebSocket + REST]
        Lambda_GW[Gateway Lambda\n라우팅/인증/컨테이너 관리]
    end

    subgraph "인증"
        Cognito[AWS Cognito\nUser Pool]
    end

    subgraph "컴퓨팅"
        Fargate[ECS Fargate Task\nOpenClaw 컨테이너]
    end

    subgraph "스토리지"
        DynamoDB[(DynamoDB\n대화 이력/설정)]
        S3[(S3\n파일/백업)]
    end

    User --> WebUI
    User --> TGBot
    WebUI --> APIGW
    TGBot --> Lambda_GW
    APIGW --> Lambda_GW
    Lambda_GW --> Cognito
    Lambda_GW --> Fargate
    Fargate --> DynamoDB
    Fargate --> S3
```

## 기술 스택

| 계층 | 기술 |
|------|------|
| **IaC** | AWS CDK (TypeScript) |
| **API** | API Gateway (WebSocket + REST) |
| **게이트웨이** | Lambda (Node.js/TypeScript) |
| **런타임** | ECS Fargate |
| **프론트엔드** | React + Vite + TypeScript |
| **인증** | AWS Cognito |
| **DB** | DynamoDB |
| **파일 저장소** | S3 |
| **모니터링** | CloudWatch |
| **메신저** | Telegram Bot API |

## 로드맵

### Phase 1: MVP (현재)
- AWS에 OpenClaw 컨테이너 on-demand 배포
- 웹 채팅 UI + Telegram 봇 통합
- AI 대화/채팅 + 태스크 자동화
- Cognito 인증 + 데이터 영속성

### Phase 2: 확장
- 브라우저 자동화 (headless Chromium)
- 커스텀 Skills 개발 지원
- 설정 관리 UI

### Phase 3: 고급 기능
- CloudWatch 알림 + 비용 대시보드
- EventBridge 기반 정기 태스크 스케줄링
- 추가 메신저 (Discord, Slack) 지원

## 예상 비용

Fargate Spot + API Gateway 조합으로 극한의 비용 최적화를 적용합니다. (하루 2시간 사용 가정)

| 구분 | 월 비용 |
|------|--------|
| 프리 티어 내 (12개월) | **~$0.23/월** |
| 프리 티어 만료 후 | **~$1.07/월** |

핵심: Fargate Spot (On-Demand 대비 ~70% 할인) + API Gateway (ALB 대비 월 $18-25 절감)

상세 분석: [비용 최적화 문서](docs/cost-optimization.md)

## 문서

- [PRD (Product Requirements Document)](docs/PRD.md)

## 라이선스

MIT License
