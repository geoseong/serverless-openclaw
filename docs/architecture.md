# 아키텍처 설계서

PRD를 기반으로 한 상세 기술 아키텍처. 각 컴포넌트의 설계, 데이터 흐름, API 계약, 보안 모델을 정의한다.

---

## 1. 시스템 전체 구성

```mermaid
graph TB
    User[사용자]

    subgraph "프론트엔드"
        CF[CloudFront CDN]
        S3Web[(S3 - 정적 호스팅)]
        WebUI[React SPA]
    end

    subgraph "API 계층"
        WSAPI[API Gateway\nWebSocket API]
        RESTAPI[API Gateway\nREST API]
    end

    subgraph "게이트웨이 Lambda"
        WS_Connect[ws-connect]
        WS_Message[ws-message]
        WS_Disconnect[ws-disconnect]
        TG_Webhook[telegram-webhook]
        API_Handler[api-handler]
        Watchdog[watchdog\nEventBridge 트리거]
    end

    subgraph "인증"
        Cognito[Cognito User Pool]
    end

    subgraph "컴퓨팅"
        ECS[ECS Cluster]
        Fargate[Fargate Spot Task\nOpenClaw 컨테이너]
        ECR[ECR Repository]
    end

    subgraph "스토리지"
        DDB_Conv[(DynamoDB\nConversations)]
        DDB_Settings[(DynamoDB\nSettings)]
        DDB_Task[(DynamoDB\nTaskState)]
        DDB_Conn[(DynamoDB\nConnections)]
        S3Data[(S3 - 데이터)]
    end

    subgraph "네트워크"
        VPC[VPC]
        PrivSub[프라이빗 서브넷]
        PubSub[퍼블릭 서브넷]
        NAT[NAT Gateway]
    end

    subgraph "시크릿"
        SSM[SSM Parameter Store]
        SM[Secrets Manager]
    end

    User --> CF --> S3Web --> WebUI
    WebUI --> WSAPI
    User --> TG_Webhook

    WSAPI --> WS_Connect
    WSAPI --> WS_Message
    WSAPI --> WS_Disconnect
    RESTAPI --> TG_Webhook
    RESTAPI --> API_Handler

    WS_Connect --> Cognito
    WS_Message --> DDB_Task
    WS_Message --> Fargate
    TG_Webhook --> DDB_Task
    TG_Webhook --> Fargate
    API_Handler --> Cognito

    Fargate --> DDB_Conv
    Fargate --> DDB_Settings
    Fargate --> S3Data
    Fargate --> SSM
    Fargate --> SM

    ECS --> Fargate
    ECR --> ECS
    Fargate --> PrivSub
    PrivSub --> NAT
    Watchdog --> DDB_Task
    Watchdog --> ECS
```

---

## 2. 네트워크 설계

### VPC 구성

```
VPC: 10.0.0.0/16

퍼블릭 서브넷 (NAT Gateway용):
  - 10.0.1.0/24 (AZ-a)
  - 10.0.2.0/24 (AZ-b)

프라이빗 서브넷 (Fargate 태스크):
  - 10.0.10.0/24 (AZ-a)
  - 10.0.20.0/24 (AZ-b)
```

### 네트워크 흐름

```mermaid
graph LR
    Internet[인터넷]
    APIGW[API Gateway]
    Lambda[Lambda]
    NAT[NAT Gateway]
    Fargate[Fargate Task]

    Internet --> APIGW
    APIGW --> Lambda
    Lambda -->|ECS API| Fargate
    Fargate -->|아웃바운드| NAT --> Internet
```

- **Fargate 태스크**: 프라이빗 서브넷에 배치. NAT Gateway를 통해 외부 API(LLM 프로바이더) 호출
- **Lambda**: VPC 외부에서 실행. ECS API로 Fargate 태스크 관리
- **NAT Gateway**: 비용 최적화를 위해 단일 AZ에 1개만 배치 (개인 사용 기준)

### 보안 그룹

| 보안 그룹 | 인바운드 | 아웃바운드 |
|----------|---------|----------|
| **sg-fargate** | 없음 (Lambda는 ECS API로 통신) | 443 (HTTPS) - LLM API, DynamoDB, S3 |
| **sg-vpc-endpoint** | 443 from sg-fargate | 없음 |

### VPC Endpoints (NAT 비용 절감)

NAT Gateway 트래픽 비용을 줄이기 위해 AWS 서비스는 VPC Endpoint로 접근:

| 서비스 | Endpoint 유형 | 이유 |
|--------|-------------|------|
| DynamoDB | Gateway (무료) | 대화 이력 읽기/쓰기 빈번 |
| S3 | Gateway (무료) | 파일 백업/설정 접근 |
| ECR | Interface | Docker 이미지 풀 |
| CloudWatch Logs | Interface | 로그 전송 |
| Secrets Manager | Interface | 시크릿 조회 |
| SSM | Interface | 파라미터 조회 |

> **비용 참고**: Interface Endpoint는 월 ~$7/개. 개인 사용에서는 NAT Gateway($4.5/월 + 데이터)와 비교하여 선택적 적용. MVP에서는 NAT Gateway만 사용하고, Phase 2에서 비용 분석 후 Endpoint 도입 검토.

---

## 3. Gateway Lambda 상세 설계

Gateway Lambda는 6개의 독립 함수로 분리하여 단일 책임 원칙을 따른다.

### 3.1 함수 목록

| 함수 | 트리거 | 역할 | 타임아웃 |
|------|--------|------|---------|
| `ws-connect` | WebSocket $connect | 연결 수립, 인증, connectionId 저장 | 10초 |
| `ws-message` | WebSocket $default | 메시지 수신, 컨테이너 라우팅 | 30초 |
| `ws-disconnect` | WebSocket $disconnect | 연결 정리 | 10초 |
| `telegram-webhook` | REST POST /telegram | Telegram 메시지 수신, 라우팅 | 30초 |
| `api-handler` | REST GET/POST /api/* | 설정 조회/변경, 대화 이력 | 10초 |
| `watchdog` | EventBridge (5분 간격) | 좀비 태스크 감지 및 종료 | 60초 |

### 3.2 WebSocket 메시지 처리 흐름

```mermaid
sequenceDiagram
    participant Client as 웹 UI
    participant APIGW as API Gateway WS
    participant Lambda as ws-message
    participant DDB as DynamoDB
    participant ECS as ECS/Fargate
    participant OC as OpenClaw

    Client->>APIGW: 메시지 전송
    APIGW->>Lambda: $default route

    Lambda->>DDB: TaskState 조회 (userId)
    alt 태스크 실행 중
        Lambda->>OC: HTTP POST /message (태스크 IP)
        OC-->>Lambda: 응답 (스트리밍)
        Lambda-->>APIGW: 응답 전송
        APIGW-->>Client: 메시지 수신
    else 태스크 없음
        Lambda-->>APIGW: "에이전트를 깨우는 중..."
        APIGW-->>Client: 로딩 상태
        Lambda->>ECS: runTask()
        Lambda->>DDB: TaskState 저장 (Starting)
        Note over ECS,OC: Cold start ~30초-1분
        ECS->>OC: 컨테이너 시작
        OC->>DDB: TaskState 업데이트 (Running)
        OC->>APIGW: 준비 완료 알림
        APIGW->>Client: 연결 완료
    end

    Lambda->>DDB: lastActivity 타임스탬프 갱신
```

### 3.3 Telegram 메시지 처리 흐름

```mermaid
sequenceDiagram
    participant TG as Telegram
    participant APIGW as API Gateway REST
    participant Lambda as telegram-webhook
    participant DDB as DynamoDB
    participant ECS as ECS/Fargate
    participant OC as OpenClaw

    TG->>APIGW: POST /telegram (webhook)
    APIGW->>Lambda: 이벤트 전달

    Lambda->>Lambda: secret token 검증
    Lambda->>DDB: Settings에서 telegramUserId 확인
    alt 등록된 사용자
        Lambda->>DDB: TaskState 조회
        alt 태스크 실행 중
            Lambda->>OC: HTTP POST /message
            OC-->>Lambda: 응답
            Lambda->>TG: sendMessage API
        else 태스크 없음
            Lambda->>TG: "에이전트를 깨우는 중..."
            Lambda->>ECS: runTask()
            Lambda->>DDB: TaskState 저장
            Note over Lambda: 비동기 처리 - 컨테이너 시작 후 OC가 직접 TG에 응답
        end
    else 미등록 사용자
        Lambda->>TG: "등록되지 않은 사용자입니다"
    end
```

### 3.4 Watchdog (좀비 태스크 감지)

```mermaid
graph TD
    EB[EventBridge\n5분 간격] --> WD[watchdog Lambda]
    WD --> DDB[TaskState 스캔\n상태=Running]
    DDB --> Check{lastActivity가\n타임아웃 초과?}
    Check -->|예| Stop[ECS stopTask]
    Check -->|아니오| Skip[무시]
    Stop --> Update[TaskState → Idle]
```

- **기본 타임아웃**: 15분 (사용자 설정 가능)
- **스캔 주기**: 5분 (EventBridge rule)
- **안전장치**: 시작 후 5분 이내 태스크는 종료하지 않음 (cold start 보호)

---

## 4. OpenClaw 컨테이너 설계

### 4.1 Docker 이미지 구성

```dockerfile
# Phase 1: 경량 이미지
FROM node:20-slim

# OpenClaw 설치
RUN npm install -g openclaw@latest

# Bridge 서버 복사
COPY src/ /app/
WORKDIR /app

# Bridge 서버 포트
EXPOSE 8080

# 헬스체크
HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "bridge.js"]
```

```dockerfile
# Phase 2: Chromium 포함
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 이하 동일
```

### 4.2 Bridge 서버 아키텍처

Bridge 서버는 Gateway Lambda와 OpenClaw 사이의 중간 레이어.

```mermaid
graph TB
    subgraph "Fargate 컨테이너"
        Bridge[Bridge 서버\nExpress/Fastify\n:8080]
        OC[OpenClaw\nNode.js 프로세스]
        LC[Lifecycle Manager]

        Bridge -->|메시지 전달| OC
        OC -->|응답 반환| Bridge
        LC -->|상태 관리| Bridge
        LC -->|타임아웃 감시| OC
    end

    Lambda[Gateway Lambda] -->|HTTP| Bridge
    Bridge -->|WebSocket 콜백| APIGW[API Gateway]
    Bridge -->|Telegram 콜백| TG[Telegram API]
    LC -->|상태 업데이트| DDB[DynamoDB]
    OC -->|데이터 저장| S3[S3]
```

### 4.3 Bridge API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/message` | 메시지 전달. body: `{ userId, message, channel, callbackUrl }` |
| GET | `/health` | 헬스체크. `{ status: "ok", uptime, activeConversations }` |
| POST | `/shutdown` | Graceful shutdown 요청 (Spot 중단 대비) |
| GET | `/status` | 컨테이너 상태 정보 |

### 4.4 컨테이너 → 클라이언트 응답 메커니즘

OpenClaw의 응답은 비동기적이므로, Bridge가 콜백 방식으로 클라이언트에 전달:

```mermaid
sequenceDiagram
    participant Lambda as Gateway Lambda
    participant Bridge as Bridge 서버
    participant OC as OpenClaw
    participant APIGW as API Gateway
    participant Client as 클라이언트

    Lambda->>Bridge: POST /message { callbackUrl, connectionId }
    Bridge->>OC: 메시지 전달
    Bridge-->>Lambda: 202 Accepted

    OC->>OC: LLM 호출 + 처리
    OC->>Bridge: 응답 (스트리밍 청크)

    loop 스트리밍 청크마다
        Bridge->>APIGW: POST @connections/{connectionId}
        APIGW->>Client: 실시간 메시지
    end

    Bridge->>APIGW: 완료 표시
```

### 4.5 Fargate 태스크 정의

| 항목 | 값 | 비고 |
|------|-----|------|
| CPU | 0.25 vCPU (256 units) | Fargate 최소 사양 |
| Memory | 0.5 GB (512 MB) | 최소 사양, Phase 2에서 1GB 이상 필요 |
| Platform | LINUX/ARM64 | Graviton (Spot 가용성 높음 + 20% 저렴) |
| Capacity Provider | FARGATE_SPOT | 70% 할인 |
| Task Role | openclaw-task-role | DynamoDB, S3, SSM 접근 |
| Execution Role | openclaw-exec-role | ECR pull, CloudWatch logs |
| Log Driver | awslogs | CloudWatch Logs 그룹으로 전송 |
| Assign Public IP | false | 프라이빗 서브넷 + NAT |

### 4.6 Spot 중단 대응

```mermaid
sequenceDiagram
    participant AWS as AWS
    participant Bridge as Bridge 서버
    participant OC as OpenClaw
    participant DDB as DynamoDB
    participant S3 as S3

    AWS->>Bridge: SIGTERM (2분 전 경고)
    Bridge->>OC: 현재 작업 완료 요청
    OC->>DDB: 대화 상태 저장
    OC->>S3: 설정/데이터 백업
    Bridge->>DDB: TaskState → Idle
    Bridge->>Bridge: Graceful shutdown
```

---

## 5. DynamoDB 테이블 상세 설계

### 5.1 Conversations 테이블

대화 이력을 저장. 단일 테이블 설계로 사용자별 대화를 효율적으로 조회.

| 속성 | 타입 | 설명 |
|------|------|------|
| **PK** | S | `USER#{userId}` |
| **SK** | S | `CONV#{conversationId}#MSG#{timestamp}` |
| role | S | `user` / `assistant` / `system` |
| content | S | 메시지 내용 |
| channel | S | `web` / `telegram` |
| metadata | M | 토큰 수, LLM 모델명 등 |
| ttl | N | TTL 타임스탬프 (대화 보존 기간) |

**접근 패턴:**

| 패턴 | 쿼리 |
|------|------|
| 사용자의 대화 목록 | PK = `USER#{userId}`, SK begins_with `CONV#` |
| 특정 대화의 메시지 | PK = `USER#{userId}`, SK begins_with `CONV#{convId}#MSG#` |
| 최근 N개 메시지 | 위 쿼리 + ScanIndexForward=false, Limit=N |

### 5.2 Settings 테이블

사용자 설정 및 시스템 구성.

| 속성 | 타입 | 설명 |
|------|------|------|
| **PK** | S | `USER#{userId}` |
| **SK** | S | `SETTING#{key}` |
| value | S / M | 설정 값 |
| updatedAt | S | ISO 8601 타임스탬프 |

**주요 설정 키:**

| SK | 값 예시 | 설명 |
|----|--------|------|
| `SETTING#llm_provider` | `{ provider: "anthropic", model: "claude-sonnet-4-5-20250929" }` | LLM 프로바이더 |
| `SETTING#telegram` | `{ telegramUserId: "123456", paired: true }` | Telegram 페어링 |
| `SETTING#timeout` | `{ minutes: 15 }` | 비활성 타임아웃 |
| `SETTING#skills` | `{ enabled: ["browser", "calendar"] }` | 활성 Skills |

### 5.3 TaskState 테이블

Fargate 태스크 상태 추적.

| 속성 | 타입 | 설명 |
|------|------|------|
| **PK** | S | `USER#{userId}` |
| taskArn | S | ECS 태스크 ARN |
| status | S | `Idle` / `Starting` / `Running` / `Stopping` |
| taskIp | S | 태스크 프라이빗 IP (Running 시) |
| startedAt | S | 시작 시각 |
| lastActivity | S | 마지막 활동 시각 |
| ttl | N | 자동 삭제용 TTL |

### 5.4 Connections 테이블

WebSocket 연결 관리.

| 속성 | 타입 | 설명 |
|------|------|------|
| **PK** | S | `CONN#{connectionId}` |
| userId | S | 연결된 사용자 ID |
| connectedAt | S | 연결 시각 |
| ttl | N | 24시간 후 자동 삭제 |

**GSI (userId-index):**

| GSI PK | GSI SK |
|--------|--------|
| userId | connectedAt |

> 사용자의 활성 WebSocket 연결을 조회하여 메시지를 브로드캐스트할 때 사용.

---

## 6. API Gateway 설계

### 6.1 WebSocket API

| Route | Lambda | 인증 | 설명 |
|-------|--------|------|------|
| `$connect` | ws-connect | Cognito JWT (query string) | 연결 수립 |
| `$default` | ws-message | connectionId로 식별 | 메시지 처리 |
| `$disconnect` | ws-disconnect | connectionId로 식별 | 연결 종료 |

**연결 시 인증:**

```
wss://xxx.execute-api.region.amazonaws.com/prod?token={jwt_token}
```

ws-connect Lambda에서 JWT를 검증하고, connectionId와 userId를 Connections 테이블에 저장.

**메시지 프로토콜:**

```typescript
// 클라이언트 → 서버
interface ClientMessage {
  action: "sendMessage" | "getHistory" | "getStatus";
  conversationId?: string;
  message?: string;
}

// 서버 → 클라이언트
interface ServerMessage {
  type: "message" | "status" | "error" | "stream_chunk" | "stream_end";
  conversationId?: string;
  content?: string;
  status?: "starting" | "running" | "stopping" | "idle";
  error?: string;
}
```

### 6.2 REST API

| Method | Path | Lambda | 인증 | 설명 |
|--------|------|--------|------|------|
| POST | `/telegram` | telegram-webhook | Telegram secret | Telegram webhook |
| GET | `/api/conversations` | api-handler | Cognito JWT | 대화 목록 |
| GET | `/api/conversations/{id}` | api-handler | Cognito JWT | 대화 상세 |
| GET | `/api/settings` | api-handler | Cognito JWT | 설정 조회 |
| PUT | `/api/settings` | api-handler | Cognito JWT | 설정 변경 |
| GET | `/api/status` | api-handler | Cognito JWT | 컨테이너 상태 |
| POST | `/api/container/start` | api-handler | Cognito JWT | 수동 시작 |
| POST | `/api/container/stop` | api-handler | Cognito JWT | 수동 종료 |

### 6.3 Cognito Authorizer

REST API에 Cognito User Pool Authorizer를 연결하여 JWT를 자동 검증:

```typescript
// CDK 정의 예시
const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "Authorizer", {
  cognitoUserPools: [userPool],
});

api.addMethod("GET", integration, {
  authorizer,
  authorizationType: apigateway.AuthorizationType.COGNITO,
});
```

---

## 7. 인증 및 보안 설계

### 7.1 Cognito User Pool 구성

| 항목 | 설정 |
|------|------|
| 로그인 속성 | 이메일 |
| MFA | 선택적 (TOTP) |
| 비밀번호 정책 | 최소 8자, 대/소/숫자/특수문자 |
| 셀프 서비스 가입 | 활성화 (이메일 인증 필수) |
| 토큰 만료 | Access: 1시간, Refresh: 30일 |

### 7.2 Telegram 인증 흐름

```mermaid
sequenceDiagram
    participant User
    participant WebUI
    participant TGBot as Telegram Bot
    participant Lambda
    participant DDB as DynamoDB

    Note over User,WebUI: 1단계: 웹 UI에서 페어링 코드 생성
    User->>WebUI: "Telegram 연동" 클릭
    WebUI->>Lambda: POST /api/telegram/pair
    Lambda->>DDB: 페어링 코드 저장 (6자리, 5분 만료)
    Lambda-->>WebUI: 페어링 코드 표시

    Note over User,TGBot: 2단계: Telegram에서 페어링
    User->>TGBot: /pair {코드}
    TGBot->>Lambda: webhook
    Lambda->>DDB: 코드 검증 + telegramUserId 저장
    Lambda->>TGBot: "페어링 완료"
    Lambda->>WebUI: WebSocket으로 상태 갱신
```

### 7.3 시크릿 관리

| 시크릿 | 저장소 | 접근 주체 |
|--------|-------|----------|
| Telegram Bot Token | Secrets Manager | Lambda (telegram-webhook) |
| LLM API Keys (Claude, GPT 등) | Secrets Manager | Fargate (OpenClaw) |
| Cognito Client Secret | SSM Parameter Store | Lambda (api-handler) |
| WebSocket Callback URL | SSM Parameter Store | Fargate (Bridge) |
| Database 설정 | 환경 변수 (CDK 주입) | Lambda, Fargate |

### 7.4 IAM 역할

**Lambda 실행 역할 (`gateway-lambda-role`):**

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/serverless-openclaw-*"
    },
    {
      "Effect": "Allow",
      "Action": ["ecs:RunTask", "ecs:StopTask", "ecs:DescribeTasks"],
      "Resource": "*",
      "Condition": { "StringEquals": { "ecs:cluster": "{cluster-arn}" } }
    },
    {
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": ["arn:aws:iam::*:role/openclaw-task-role", "arn:aws:iam::*:role/openclaw-exec-role"]
    },
    {
      "Effect": "Allow",
      "Action": ["execute-api:ManageConnections"],
      "Resource": "arn:aws:execute-api:*:*:*/prod/POST/@connections/*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:serverless-openclaw/*"
    }
  ]
}
```

**Fargate 태스크 역할 (`openclaw-task-role`):**

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/serverless-openclaw-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::serverless-openclaw-data", "arn:aws:s3:::serverless-openclaw-data/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:serverless-openclaw/llm-*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/serverless-openclaw/*"
    },
    {
      "Effect": "Allow",
      "Action": ["execute-api:ManageConnections"],
      "Resource": "arn:aws:execute-api:*:*:*/prod/POST/@connections/*"
    }
  ]
}
```

---

## 8. CDK 스택 설계

각 스택은 독립적으로 배포 가능하되, 의존 관계를 CDK에서 관리.

```mermaid
graph TD
    App[CDK App]
    NS[NetworkStack\nVPC, 서브넷, NAT]
    SS[StorageStack\nDynamoDB, S3, ECR]
    AS[AuthStack\nCognito]
    CS[ComputeStack\nECS, Fargate Task Def]
    APIS[ApiStack\nAPI Gateway, Lambda]
    WS[WebStack\nS3 호스팅, CloudFront]

    App --> NS
    App --> SS
    App --> AS
    NS --> CS
    SS --> CS
    NS --> APIS
    SS --> APIS
    AS --> APIS
    CS --> APIS
    APIS --> WS
```

### 스택별 리소스

| 스택 | 리소스 | 의존성 |
|------|--------|--------|
| **NetworkStack** | VPC, 서브넷, NAT Gateway, VPC Endpoints | 없음 |
| **StorageStack** | DynamoDB 테이블 4개, S3 버킷 2개, ECR 리포지토리 | 없음 |
| **AuthStack** | Cognito User Pool, App Client | 없음 |
| **ComputeStack** | ECS 클러스터, Fargate 태스크 정의, IAM 역할 | Network, Storage |
| **ApiStack** | API Gateway (WS+REST), Lambda 함수 6개, IAM 역할 | Network, Storage, Auth, Compute |
| **WebStack** | S3 버킷(웹), CloudFront 배포 | Api (WebSocket URL 주입) |

### 환경 변수 및 설정 주입

CDK에서 Lambda/Fargate에 주입하는 설정:

```typescript
// Lambda 환경 변수
{
  DYNAMODB_TABLE_PREFIX: "serverless-openclaw",
  ECS_CLUSTER_ARN: cluster.clusterArn,
  TASK_DEFINITION_ARN: taskDef.taskDefinitionArn,
  SUBNET_IDS: privateSubnets.join(","),
  SECURITY_GROUP_ID: fargateSecurityGroup.securityGroupId,
  WEBSOCKET_API_ENDPOINT: wsApi.apiEndpoint,
  TELEGRAM_SECRET_ARN: telegramSecret.secretArn,
}

// Fargate 환경 변수
{
  DYNAMODB_TABLE_PREFIX: "serverless-openclaw",
  S3_DATA_BUCKET: dataBucket.bucketName,
  WEBSOCKET_CALLBACK_URL: wsApi.apiEndpoint,
  LLM_SECRET_ARN: llmSecret.secretArn,
  INACTIVITY_TIMEOUT_MINUTES: "15",
}
```

---

## 9. 프론트엔드 설계

### 9.1 React SPA 구성

```
packages/web/src/
├── components/
│   ├── Chat/
│   │   ├── ChatContainer.tsx    # 메인 채팅 컨테이너
│   │   ├── MessageList.tsx      # 메시지 목록 (가상 스크롤)
│   │   ├── MessageBubble.tsx    # 개별 메시지 버블
│   │   ├── MessageInput.tsx     # 입력 폼
│   │   └── StreamingMessage.tsx # LLM 스트리밍 응답 표시
│   ├── Auth/
│   │   ├── LoginForm.tsx        # 로그인 폼
│   │   └── AuthProvider.tsx     # Cognito 인증 컨텍스트
│   ├── Status/
│   │   ├── AgentStatus.tsx      # 에이전트 상태 표시
│   │   └── ColdStartBanner.tsx  # "깨우는 중..." 배너
│   └── Settings/
│       ├── SettingsPanel.tsx     # 설정 패널
│       ├── LLMSelector.tsx      # LLM 프로바이더 선택
│       └── TelegramPair.tsx     # Telegram 페어링 UI
├── hooks/
│   ├── useWebSocket.ts          # WebSocket 연결 관리
│   ├── useAuth.ts               # Cognito 인증 훅
│   └── useAgentStatus.ts        # 에이전트 상태 훅
├── services/
│   ├── websocket.ts             # WebSocket 클라이언트
│   ├── api.ts                   # REST API 클라이언트
│   └── auth.ts                  # Cognito Auth 래퍼
├── types/
│   └── index.ts                 # 공유 타입
├── App.tsx
└── main.tsx
```

### 9.2 WebSocket 연결 관리

```mermaid
stateDiagram-v2
    [*] --> Disconnected
    Disconnected --> Connecting: connect()
    Connecting --> Connected: onopen
    Connecting --> Disconnected: onerror/timeout
    Connected --> Disconnected: onclose
    Connected --> Reconnecting: 연결 끊김 감지
    Reconnecting --> Connected: 재연결 성공
    Reconnecting --> Disconnected: 최대 재시도 초과
```

- **자동 재연결**: 지수 백오프 (1초, 2초, 4초... 최대 30초)
- **하트비트**: 30초 간격 ping으로 연결 유지
- **토큰 갱신**: Access Token 만료 시 Refresh Token으로 자동 갱신 후 재연결

### 9.3 배포 설정

| 항목 | 값 |
|------|-----|
| S3 버킷 | `serverless-openclaw-web-{accountId}` |
| CloudFront | OAI로 S3 접근, HTTPS 전용 |
| 캐시 정책 | index.html: no-cache, assets: 1년 캐시 (hash 기반) |
| SPA 라우팅 | CloudFront 404 → index.html 리다이렉트 |
| 환경 변수 | 빌드 시 `VITE_WS_URL`, `VITE_API_URL`, `VITE_COGNITO_*` 주입 |

---

## 10. 배포 파이프라인

### 10.1 초기 배포 (사용자)

```bash
# 1. 사전 요구사항
npm install -g aws-cdk
aws configure  # AWS 자격 증명 설정

# 2. 레포지토리 클론 및 의존성 설치
git clone https://github.com/serithemage/serverless-openclaw.git
cd serverless-openclaw
npm install

# 3. 환경 설정
cp .env.example .env
# .env 편집: Telegram Bot Token, LLM API Key 등 입력

# 4. CDK 부트스트랩 (최초 1회)
cdk bootstrap

# 5. Docker 이미지 빌드 + 전체 배포
cdk deploy --all

# 6. 배포 후 출력값 확인
# - 웹 UI URL (CloudFront)
# - WebSocket URL
# - REST API URL
```

### 10.2 업데이트

```bash
git pull
npm install
cdk deploy --all
```

---

## 11. 모니터링

### CloudWatch 메트릭

| 메트릭 | 소스 | 목적 |
|--------|------|------|
| Lambda 실행 시간/오류 | Lambda 자동 | Gateway 성능 |
| Fargate CPU/메모리 | ECS 자동 | 컨테이너 리소스 |
| DynamoDB 읽기/쓰기 | DynamoDB 자동 | 데이터 접근 패턴 |
| WebSocket 연결 수 | 커스텀 메트릭 | 동시 접속 |
| 컨테이너 시작/종료 횟수 | 커스텀 메트릭 | 사용 패턴 분석 |
| Cold start 소요 시간 | 커스텀 메트릭 | UX 지표 |

### 로그 그룹

| 로그 그룹 | 보존 기간 | 소스 |
|----------|----------|------|
| `/serverless-openclaw/lambda/ws-connect` | 7일 | Lambda |
| `/serverless-openclaw/lambda/ws-message` | 7일 | Lambda |
| `/serverless-openclaw/lambda/telegram` | 7일 | Lambda |
| `/serverless-openclaw/lambda/api` | 7일 | Lambda |
| `/serverless-openclaw/lambda/watchdog` | 7일 | Lambda |
| `/serverless-openclaw/fargate/openclaw` | 14일 | Fargate |
