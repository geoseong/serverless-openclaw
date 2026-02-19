# 컨테이너 반복 재시작 문제

## 발견 일시
2026-02-19

## 문제 요약
특정 메시지 처리 중 컨테이너가 비정상 종료되고 계속 재시작되는 문제 발견.

## 증상

### 관찰된 패턴
1. 사용자가 메시지 전송
2. Lambda가 메시지를 PendingMessages에 저장
3. 컨테이너 시작 (또는 이미 실행 중)
4. "Processed 1 pending message(s)" 로그 출력
5. 메시지 처리 시작
6. **응답 없이 컨테이너 종료**
7. 새 메시지 전송 시 다시 1번부터 반복

### 로그 패턴
```
13:26:07 [start] Starting Bridge server (background)...
13:26:33 Processed 1 pending message(s)
13:26:33 Startup complete in 24948ms
[메시지 처리 로그 없음]
[컨테이너 종료]
13:40:01 [start] Starting Bridge server (background)...
13:40:27 Processed 1 pending message(s)
[반복]
```

### 문제 발생 시나리오
- 사용자 요청: "파일 3개 생성해줘" (gudi_soul.md, gametech_soul.md, ai_engineering_soul.md)
- OpenClaw가 파일 생성 시도
- 이후 "ls 명령어 실행해줘" 요청
- 컨테이너가 응답 없이 종료

## 가능한 원인

### 1. OpenClaw Gateway 크래시
- 파일 생성 작업 중 예외 발생
- 처리되지 않은 에러로 인한 프로세스 종료
- Node.js uncaughtException 또는 unhandledRejection

### 2. 메모리 부족 (OOM)
- Fargate 메모리: 512MB (최소 스펙)
- 파일 생성 + LLM 응답 생성 시 메모리 초과 가능
- OOM Killer가 컨테이너 종료

### 3. Health Check 실패
- Bridge server가 응답하지 않음
- ECS가 unhealthy로 판단하여 태스크 종료
- Health check 설정:
  ```
  interval: 30s
  timeout: 5s
  retries: 3
  startPeriod: 120s
  ```

### 4. 타임아웃
- Lambda → Bridge HTTP 요청 타임아웃 (30초)
- OpenClaw Gateway 응답 지연
- Bridge가 응답을 기다리다가 타임아웃

### 5. SIGTERM 수신
- Spot 인터럽션 (가능성 낮음 - 2분 경고 있음)
- Watchdog Lambda의 잘못된 종료 (lastActivity 체크 오류)

## 디버깅 방법

### 1. 상세 로그 확인
```bash
# 컨테이너 종료 직전 로그
aws logs tail /ecs/serverless-openclaw --since 30m --region ap-northeast-2 --format short | grep -B 20 "Starting Bridge"

# 에러 로그
aws logs tail /ecs/serverless-openclaw --since 30m --region ap-northeast-2 --format short | grep -i "error\|exception\|fatal"

# 메모리 관련
aws logs tail /ecs/serverless-openclaw --since 30m --region ap-northeast-2 --format short | grep -i "memory\|oom"
```

### 2. ECS 태스크 종료 이유 확인
```bash
aws ecs describe-tasks \
  --cluster serverless-openclaw \
  --tasks <task-arn> \
  --region ap-northeast-2 \
  --query 'tasks[0].{stoppedReason:stoppedReason,stopCode:stopCode,containers:containers[0].{exitCode:exitCode,reason:reason}}'
```

### 3. CloudWatch Container Insights (활성화 필요)
- 메모리 사용량 모니터링
- CPU 사용량 확인
- 네트워크 I/O 확인

### 4. Bridge Health Check 로그
```bash
aws logs tail /ecs/serverless-openclaw --since 30m --region ap-northeast-2 --format short | grep "health"
```

## 해결 방안

### 단기 해결책

#### 1. 메모리 증가
`packages/cdk/lib/stacks/compute-stack.ts`:
```typescript
this.taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
  memoryLimitMiB: 1024,  // 512 → 1024
  cpu: 512,              // 256 → 512
  // ...
});
```

**비용 영향:**
- 현재: 0.25 vCPU + 0.5GB = ~$0.01/hour
- 변경: 0.5 vCPU + 1GB = ~$0.02/hour
- 월 30시간 사용 시: $0.30 → $0.60 (+$0.30)

#### 2. Health Check 완화
```typescript
healthCheck: {
  command: ["CMD-SHELL", `curl -f http://localhost:${BRIDGE_PORT}/health || exit 1`],
  interval: cdk.Duration.seconds(60),    // 30 → 60
  timeout: cdk.Duration.seconds(10),     // 5 → 10
  retries: 5,                            // 3 → 5
  startPeriod: cdk.Duration.seconds(180), // 120 → 180
}
```

#### 3. 에러 핸들링 강화
`packages/container/src/bridge.ts`:
```typescript
// Uncaught exception handler
process.on('uncaughtException', (err) => {
  console.error('[bridge] Uncaught exception:', err);
  // Graceful shutdown instead of crash
  lifecycle.gracefulShutdown().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[bridge] Unhandled rejection at:', promise, 'reason:', reason);
});
```

#### 4. OpenClaw Gateway 타임아웃 설정
`packages/container/src/openclaw-client.ts`:
```typescript
async sendMessage(message: string, timeout: number = 120000): Promise<AsyncGenerator> {
  // 타임아웃 추가
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('OpenClaw timeout')), timeout)
  );
  
  return Promise.race([
    this.actualSendMessage(message),
    timeoutPromise
  ]);
}
```

### 중기 해결책

#### 1. 로깅 강화
- 모든 주요 작업에 try-catch 추가
- 에러 발생 시 상세 스택 트레이스 로깅
- CloudWatch Logs Insights 쿼리 작성

#### 2. 메트릭 수집
- 메시지 처리 시간 측정
- 메모리 사용량 추적
- 실패율 모니터링

#### 3. Circuit Breaker 패턴
- 연속 실패 시 일시적으로 요청 거부
- 시스템 복구 시간 확보

### 장기 해결책

#### 1. 컨테이너 분리
- OpenClaw Gateway 컨테이너
- Bridge 컨테이너
- 독립적인 장애 격리

#### 2. 큐 기반 아키텍처
- SQS를 통한 비동기 메시지 처리
- 재시도 로직 내장
- Dead Letter Queue

#### 3. 모니터링 및 알람
- CloudWatch Alarm 설정
- 컨테이너 재시작 횟수 추적
- SNS 알림

## 임시 회피 방법

### 사용자 측
1. 복잡한 작업은 단계별로 나누어 요청
2. 파일 생성 후 잠시 대기 후 다음 명령 실행
3. 간단한 메시지로 컨테이너 상태 확인 ("ping", "안녕")

### 운영자 측
1. TaskState 수동 리셋:
   ```bash
   aws dynamodb delete-item \
     --table-name serverless-openclaw-TaskState \
     --key '{"PK":{"S":"USER#telegram:337607235"}}' \
     --region ap-northeast-2
   ```

2. 실행 중인 태스크 강제 종료:
   ```bash
   aws ecs stop-task \
     --cluster serverless-openclaw \
     --task <task-arn> \
     --region ap-northeast-2
   ```

## 우선순위
- **P0 (긴급)**: 에러 핸들링 강화 - 컨테이너 크래시 방지
- **P1 (높음)**: 메모리 증가 - OOM 방지
- **P2 (중간)**: 로깅 강화 - 원인 파악
- **P3 (낮음)**: 모니터링 구축 - 사전 감지

## 관련 파일
- `packages/container/src/bridge.ts`
- `packages/container/src/openclaw-client.ts`
- `packages/container/src/lifecycle.ts`
- `packages/cdk/lib/stacks/compute-stack.ts`

## 참고
- ECS Task Stopped Reasons: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/stopped-task-errors.html
- Fargate Troubleshooting: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/troubleshooting-fargate.html
- Node.js Error Handling: https://nodejs.org/api/process.html#process_event_uncaughtexception
