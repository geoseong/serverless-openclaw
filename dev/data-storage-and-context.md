# 데이터 저장 및 컨텍스트 관리

이 문서는 Serverless OpenClaw에서 대화 내역, Skill, Workspace 데이터가 어떻게 저장되고 관리되는지 설명합니다.

---

## 개요

Serverless OpenClaw는 다음 세 가지 AWS 서비스를 사용하여 데이터를 관리합니다:

1. **DynamoDB**: 대화 내역, 연결 상태, 설정 등
2. **S3**: Workspace 데이터 백업
3. **Fargate 컨테이너**: 실행 중 데이터 (메모리 및 로컬 파일시스템)

---

## 1. 대화 내역 저장 (DynamoDB)

### 1-1. 저장 방식

**테이블**: `Conversations`

**구조**:
```
PK: USER#<userId>
SK: CONV#default#MSG#<timestamp>
role: "user" | "assistant"
content: 메시지 내용
channel: "web" | "telegram"
ttl: 7일 후 자동 삭제 (Unix timestamp)
```

**예시**:
```json
{
  "PK": "USER#abc123",
  "SK": "CONV#default#MSG#1708185600000",
  "role": "user",
  "content": "안녕하세요",
  "channel": "web",
  "ttl": 1708790400
}
```

### 1-2. 저장 시점

```typescript
// packages/container/src/conversation-store.ts
await saveMessagePair(
  dynamoSend,
  userId,
  userMessage,      // 사용자 메시지
  assistantMessage, // AI 응답
  channel
);
```

**저장 시점**:
1. 사용자가 메시지 전송
2. AI가 응답 완료
3. 두 메시지를 쌍으로 DynamoDB에 저장

### 1-3. TTL (Time To Live)

```typescript
const CONVERSATION_TTL_DAYS = 7;
const ttl = Math.floor(now / 1000) + CONVERSATION_TTL_DAYS * 86400;
```

**특징**:
- 대화 내역은 **7일 후 자동 삭제**
- DynamoDB가 자동으로 처리 (추가 비용 없음)
- 비용 절감 목적

**변경 방법**:
```typescript
// packages/container/src/conversation-store.ts
const CONVERSATION_TTL_DAYS = 30; // 30일로 변경
```

---

## 2. AI 컨텍스트 유지 (대화 내역 로드)

### 2-1. 대화 내역 로드

**시점**: Fargate 컨테이너 시작 시

```typescript
// packages/container/src/startup.ts
const history = await loadRecentHistory(dynamoSend, userId);
```

**로드 개수**: 최근 **20개 메시지** (기본값)

```typescript
// packages/container/src/conversation-store.ts
export async function loadRecentHistory(
  send: Send,
  userId: string,
  conversationId = "default",
  limit = 20,  // ← 여기서 변경 가능
): Promise<ConversationItem[]>
```

### 2-2. 컨텍스트 포맷

```typescript
// packages/container/src/conversation-store.ts
export function formatHistoryContext(history: ConversationItem[]): string {
  const lines = history
    .map((item) => `<message role="${item.role}">${item.content}</message>`)
    .join("\n");

  return `<conversation_history>\n${lines}\n</conversation_history>\n\n`;
}
```

**출력 예시**:
```xml
<conversation_history>
<message role="user">안녕하세요</message>
<message role="assistant">안녕하세요! 무엇을 도와드릴까요?</message>
<message role="user">날씨 알려줘</message>
<message role="assistant">죄송하지만 실시간 날씨 정보는 제공할 수 없습니다.</message>
</conversation_history>
```

### 2-3. AI에게 전송

```typescript
// packages/container/src/startup.ts
const messageToSend = historyPrefix
  ? historyPrefix + msg.message  // 대화 내역 + 새 메시지
  : msg.message;

const generator = openclawClient.sendMessage(userId, messageToSend);
```

**동작 방식**:
1. 컨테이너 시작 시 최근 20개 메시지 로드
2. 첫 번째 메시지에 대화 내역을 앞에 붙임
3. AI는 이전 대화를 "기억"하고 컨텍스트를 유지
4. 이후 메시지는 OpenClaw Gateway가 세션 관리

**제한사항**:
- 컨테이너가 재시작될 때만 로드
- 실행 중에는 OpenClaw Gateway가 메모리에서 관리
- 최근 20개만 로드 (토큰 비용 및 성능)

### 2-4. 컨텍스트 개수 변경

더 많은 대화 내역을 로드하려면:

```typescript
// packages/container/src/startup.ts
const history = await loadRecentHistory(dynamoSend, userId, "default", 50); // 50개로 증가
```

**주의사항**:
- 많을수록 AI가 더 많은 컨텍스트를 가짐
- 토큰 비용 증가 (입력 토큰 증가)
- 응답 속도 약간 느려질 수 있음

---

## 3. Workspace 데이터 (S3)

### 3-1. Workspace란?

OpenClaw가 작업하면서 생성하는 파일들:
- 생성된 코드
- 작성된 문서
- 다운로드한 파일
- 기타 작업 파일

### 3-2. 저장 위치

**컨테이너 내부**: `/data/workspace`
**S3**: `s3://<DATA_BUCKET>/workspaces/<userId>/`

### 3-3. 복원 (Restore)

**시점**: 컨테이너 시작 시

```typescript
// packages/container/src/startup.ts
await restoreFromS3({
  bucket: env.DATA_BUCKET,
  prefix: `workspaces/${userId}`,
  localPath: "/data/workspace",
});
```

**동작**:
1. S3에서 사용자의 workspace 데이터 다운로드
2. `/data/workspace`에 복원
3. OpenClaw가 이전 작업 파일에 접근 가능

### 3-4. 백업 (Backup)

**시점**:
1. **주기적**: 5분마다 자동 백업
2. **종료 시**: 컨테이너 종료 시 최종 백업

```typescript
// packages/container/src/lifecycle.ts
startPeriodicBackup() {
  this.backupInterval = setInterval(async () => {
    await this.backup();
  }, 5 * 60 * 1000); // 5분
}
```

**동작**:
1. `/data/workspace` 디렉토리 전체를 S3에 업로드
2. 사용자별로 분리 저장
3. 다음 컨테이너 시작 시 복원

---

## 4. Skill 관리

### 4-1. 현재 구현

**Skill 위치**: Docker 이미지 내부

**추가 방법**:
1. Dockerfile 수정
2. Docker 이미지 재빌드
3. ECR에 푸시
4. 컨테이너 재시작

**예시**:
```dockerfile
# packages/container/Dockerfile
COPY my-custom-skills/ /home/openclaw/.openclaw/skills/
```

### 4-2. S3 기반 Skill 관리 (향후 개선 가능)

**현재는 구현되지 않았지만**, 다음과 같이 개선 가능:

```typescript
// 컨테이너 시작 시 S3에서 Skill 다운로드
await restoreFromS3({
  bucket: env.DATA_BUCKET,
  prefix: `skills/${userId}`,
  localPath: "/home/openclaw/.openclaw/skills",
});
```

**장점**:
- Docker 이미지 재빌드 불필요
- 사용자별 커스텀 Skill 가능
- 동적으로 Skill 추가/제거

**구현 필요 사항**:
1. `startup.ts`에 Skill 복원 로직 추가
2. Skill 업로드 API 추가 (Lambda)
3. Web UI에 Skill 관리 기능 추가

---

## 5. DynamoDB 테이블 전체 구조

### 5-1. Conversations (대화 내역)

```
PK: USER#<userId>
SK: CONV#<conversationId>#MSG#<timestamp>
role: "user" | "assistant"
content: string
channel: "web" | "telegram"
ttl: number (7일 후)
```

### 5-2. Connections (WebSocket 연결)

```
PK: CONN#<connectionId>
userId: string
connectedAt: string (ISO timestamp)
ttl: number (1시간 후)

GSI: userId-index
- PK: userId
- SK: connectedAt
```

### 5-3. PendingMessages (대기 중 메시지)

```
PK: USER#<userId>
SK: MSG#<timestamp>
connectionId: string
message: string
channel: "web" | "telegram"
createdAt: string (ISO timestamp)
ttl: number (1시간 후)
```

### 5-4. TaskState (Fargate 태스크 상태)

```
PK: USER#<userId>
status: "Starting" | "Running" | "Stopping"
taskArn: string
publicIp?: string
startedAt: string (ISO timestamp)
ttl: number (24시간 후)
```

### 5-5. Settings (사용자 설정)

```
PK: USER#<userId>
SK: SETTING#<key>
value: any
```

---

## 6. 전체 데이터 흐름

```
┌─────────────────────────────────────────────────────────┐
│ 1. 사용자가 메시지 전송                                   │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Lambda → DynamoDB PendingMessages 테이블에 저장        │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Lambda → ECS RunTask (Fargate 컨테이너 시작)          │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Fargate 컨테이너 시작                                  │
│    a. S3에서 workspace 복원                              │
│    b. DynamoDB에서 최근 20개 대화 로드                    │
│    c. OpenClaw Gateway 시작                              │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 5. PendingMessages 처리                                  │
│    a. 대화 내역 + 새 메시지 → AI에게 전송                 │
│    b. AI 응답 받음                                       │
│    c. 사용자에게 스트리밍                                 │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 6. DynamoDB Conversations 테이블에 저장                   │
│    - 사용자 메시지                                       │
│    - AI 응답                                             │
│    - TTL: 7일                                            │
└─────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────┐
│ 7. 주기적으로 workspace를 S3에 백업                       │
│    - 5분마다 자동 백업                                   │
│    - 컨테이너 종료 시 최종 백업                           │
└─────────────────────────────────────────────────────────┘
```

---

## 7. 무료 플랜 사용 시 비용

### 7-1. Gemini 무료 플랜

**제한**:
- 15 requests/minute
- 1,500 requests/day

**충분한가?**:
- 개인 사용: ✅ 충분
- 팀 사용: ⚠️ 제한적
- 프로덕션: ❌ 부족

**초과 시**:
- HTTP 429 (Rate Limit Exceeded)
- 자동 재시도 또는 폴백 모델 사용

### 7-2. Claude 무료 플랜

**없음**: Claude는 무료 플랜이 없습니다.

**최소 비용**:
- $5 크레딧으로 시작 가능
- 약 150만 입력 토큰 + 30만 출력 토큰

**대안**:
- OpenRouter의 무료 모델 (Gemini Flash, Llama 등)
- Groq (14,400 requests/day 무료)

### 7-3. DynamoDB 비용

**무료 티어** (영구):
- 25GB 저장
- 25 WCU (Write Capacity Units)
- 25 RCU (Read Capacity Units)

**PAY_PER_REQUEST 요금**:
- 읽기: $0.25 per million requests
- 쓰기: $1.25 per million requests

**예상 비용** (개인 사용):
- 하루 100개 메시지: 200 writes (사용자 + AI)
- 월 6,000 writes = $0.0075
- 컨테이너 시작 시 20개 읽기: 월 600 reads = $0.00015
- **월 총 비용: ~$0.01 (거의 무료)**

### 7-4. S3 비용

**무료 티어** (12개월):
- 5GB 저장
- 20,000 GET requests
- 2,000 PUT requests

**이후 요금**:
- 저장: $0.023 per GB/month
- PUT: $0.005 per 1,000 requests
- GET: $0.0004 per 1,000 requests

**예상 비용** (개인 사용):
- Workspace 크기: 100MB
- 백업: 5분마다 (월 8,640회)
- **월 총 비용: ~$0.05**

### 7-5. Fargate 비용

**가장 큰 비용 항목!**

**요금**:
- vCPU: $0.04048 per vCPU-hour
- Memory: $0.004445 per GB-hour

**예시** (1 vCPU, 2GB RAM):
- 시간당: $0.04048 + $0.008890 = $0.04937
- 10분 실행: $0.00823
- 하루 10회 × 10분: $0.0823
- **월 비용: ~$2.50**

**비용 절감**:
- Fargate Spot 사용 (70% 할인)
- 월 비용: ~$0.75

---

## 8. 데이터 보존 정책

### 8-1. 대화 내역 (DynamoDB)

- **보존 기간**: 7일
- **삭제 방식**: TTL 자동 삭제
- **변경 방법**: `CONVERSATION_TTL_DAYS` 상수 수정

### 8-2. Workspace (S3)

- **보존 기간**: 영구 (수동 삭제 전까지)
- **삭제 방식**: 수동 또는 Lifecycle Policy
- **권장**: 90일 후 자동 삭제 설정

```typescript
// packages/cdk/lib/stacks/storage-stack.ts
this.dataBucket = new s3.Bucket(this, "DataBucket", {
  lifecycleRules: [
    {
      expiration: cdk.Duration.days(90),
      prefix: "workspaces/",
    },
  ],
});
```

### 8-3. 연결 상태 (DynamoDB)

- **보존 기간**: 1시간
- **삭제 방식**: TTL 자동 삭제

### 8-4. 대기 메시지 (DynamoDB)

- **보존 기간**: 1시간
- **삭제 방식**: TTL 자동 삭제

---

## 9. 데이터 백업 및 복구

### 9-1. DynamoDB 백업

**Point-in-Time Recovery (PITR)**:
```typescript
// packages/cdk/lib/stacks/storage-stack.ts
this.conversationsTable = new dynamodb.Table(this, "Conversations", {
  pointInTimeRecovery: true, // 추가
  // ...
});
```

**장점**:
- 최근 35일 내 임의 시점으로 복구 가능
- 추가 비용: 테이블 크기의 약 20%

### 9-2. S3 버전 관리

```typescript
// packages/cdk/lib/stacks/storage-stack.ts
this.dataBucket = new s3.Bucket(this, "DataBucket", {
  versioned: true, // 추가
  // ...
});
```

**장점**:
- 파일 삭제/덮어쓰기 시 이전 버전 보존
- 실수로 삭제한 파일 복구 가능

---

## 10. 프라이버시 및 보안

### 10-1. 데이터 암호화

**DynamoDB**:
- 기본적으로 암호화됨 (AWS 관리 키)
- 추가 비용 없음

**S3**:
- 기본적으로 암호화됨 (S3 Managed Keys)
- 추가 비용 없음

### 10-2. 접근 제어

**DynamoDB**:
- Fargate Task Role만 읽기/쓰기 가능
- IAM 정책으로 제한

**S3**:
- Fargate Task Role만 읽기/쓰기 가능
- Public 접근 차단 (BlockPublicAccess)

### 10-3. 데이터 삭제

**사용자 데이터 완전 삭제**:
```bash
# DynamoDB 대화 내역 삭제
aws dynamodb query \
  --table-name serverless-openclaw-conversations \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"USER#abc123"}}' \
  | jq -r '.Items[].SK.S' \
  | xargs -I {} aws dynamodb delete-item \
      --table-name serverless-openclaw-conversations \
      --key '{"PK":{"S":"USER#abc123"},"SK":{"S":"{}"}}'

# S3 workspace 삭제
aws s3 rm s3://<BUCKET>/workspaces/abc123/ --recursive
```

---

## 11. 모니터링 및 디버깅

### 11-1. 대화 내역 확인

```bash
# 특정 사용자의 최근 대화 조회
aws dynamodb query \
  --table-name serverless-openclaw-conversations \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values '{":pk":{"S":"USER#abc123"}}' \
  --scan-index-forward false \
  --limit 10
```

### 11-2. Workspace 크기 확인

```bash
# 특정 사용자의 workspace 크기
aws s3 ls s3://<BUCKET>/workspaces/abc123/ --recursive --summarize
```

### 11-3. 컨테이너 로그 확인

```bash
# CloudWatch Logs
aws logs tail /ecs/serverless-openclaw --follow
```

---

## 요약

### ✅ 대화 내역
- **저장**: DynamoDB Conversations 테이블
- **TTL**: 7일 자동 삭제
- **컨텍스트**: 최근 20개 메시지 로드
- **AI 기억**: 컨테이너 시작 시 대화 내역 전달

### ✅ Workspace
- **저장**: S3 (백업) + Fargate 로컬 (실행 중)
- **복원**: 컨테이너 시작 시 S3에서 다운로드
- **백업**: 5분마다 + 종료 시

### ⚠️ Skill
- **현재**: Docker 이미지에 포함
- **추가**: Dockerfile 수정 → 재빌드 → 재배포
- **향후**: S3 기반 동적 로드 가능

### 💰 비용 (개인 사용)
- **DynamoDB**: ~$0.01/월
- **S3**: ~$0.05/월
- **Fargate**: ~$0.75/월 (Spot)
- **AI API**: 무료 플랜 사용 시 $0
- **총 비용**: ~$1/월

---

**작성일**: 2025-02-17  
**기반**: 실제 코드 분석 및 아키텍처 검토

