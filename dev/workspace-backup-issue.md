# OpenClaw Workspace 백업 경로 불일치 문제

## 발견 일시
2026-02-19

## 문제 요약
OpenClaw가 생성한 workspace 파일들이 S3에 백업되지 않는 문제 발견.

## 원인 분석

### 경로 불일치
- **OpenClaw workspace 실제 경로**: `/home/openclaw/.openclaw/workspace/`
- **백업 대상 경로**: `/data/workspace`

### 코드 확인

**startup.ts (L47-51):**
```typescript
const [, history] = await Promise.all([
  restoreFromS3({
    bucket: env.DATA_BUCKET,
    prefix: `workspaces/${userId}`,
    localPath: "/data/workspace",  // ❌ 잘못된 경로
  }),
  loadRecentHistory(dynamoSend, userId),
]);
```

**lifecycle.ts (L59-64):**
```typescript
async backupToS3(): Promise<void> {
  await backupToS3({
    bucket: this.deps.s3Bucket,
    prefix: this.deps.s3Prefix,
    workspacePath: this.deps.workspacePath,  // "/data/workspace" ❌
  });
}
```

**startup.ts (L88-96):**
```typescript
const lifecycle = new LifecycleManager({
  dynamoSend,
  userId,
  s3Bucket: env.DATA_BUCKET,
  s3Prefix: `workspaces/${userId}`,
  workspacePath: "/data/workspace",  // ❌ 잘못된 경로
});
```

### 백업 동작
1. **주기적 백업**: 5분마다 실행 (`PERIODIC_BACKUP_INTERVAL_MS = 5 * 60 * 1000`)
2. **종료 시 백업**: SIGTERM 받았을 때 `gracefulShutdown()` → `backupToS3()`

### 문제점
- `/data/workspace` 디렉토리가 비어있거나 존재하지 않음
- OpenClaw가 생성한 파일들은 `/home/openclaw/.openclaw/workspace/`에 있음
- 백업이 실행되어도 빈 디렉토리를 백업하므로 S3에 아무것도 업로드되지 않음

## 재현 테스트 계획

### 테스트 파일
OpenClaw가 다음 파일들을 생성했다고 보고:
- `gudi_soul.md` (구디 소모임 NPC)
- `gametech_soul.md` (게임테크 소모임 NPC)
- `ai_engineering_soul.md` (AI 엔지니어링 소모임 NPC)

위치: `/home/openclaw/.openclaw/workspace/`

### 테스트 절차
1. 현재 컨테이너가 종료될 때까지 대기 (15분 inactivity timeout)
2. 종료 시 `gracefulShutdown()` 실행 → `backupToS3()` 호출
3. S3 확인:
   ```bash
   aws s3 ls s3://storagestack-databuckete3889a50-7zd88iuwesiu/workspaces/telegram:337607235/ --recursive --region ap-northeast-2
   ```
4. 새 메시지 전송하여 컨테이너 재시작
5. 로그 확인: `restoreFromS3()` 실행 여부
6. OpenClaw에게 파일 목록 요청하여 복원 확인

### 예상 결과
- **현재 상태 (버그)**: S3에 파일 없음, 재시작 후 파일 사라짐
- **수정 후**: S3에 파일 백업됨, 재시작 후 파일 복원됨

## 해결 방안

### 방안 1: 심볼릭 링크 (권장)
Dockerfile에서 심볼릭 링크 생성:
```dockerfile
RUN mkdir -p /data && \
    ln -s /home/openclaw/.openclaw/workspace /data/workspace
```

**장점:**
- 코드 수정 최소화
- OpenClaw 기본 경로 유지
- 백업 코드 변경 불필요

### 방안 2: 백업 경로 변경
startup.ts와 lifecycle.ts에서 경로 수정:
```typescript
localPath: "/home/openclaw/.openclaw/workspace",
workspacePath: "/home/openclaw/.openclaw/workspace",
```

**장점:**
- 명시적
- 심볼릭 링크 불필요

**단점:**
- 여러 파일 수정 필요
- 권한 문제 가능성 (openclaw 사용자)

### 방안 3: OpenClaw 설정 변경
openclaw.json에서 workspace 경로 변경:
```json
{
  "workspace": {
    "path": "/data/workspace"
  }
}
```

**단점:**
- OpenClaw 설정 구조 확인 필요
- 표준 경로에서 벗어남

## 권장 해결책
**방안 1 (심볼릭 링크)** 채택:
1. Dockerfile 수정
2. Docker 이미지 재빌드 및 ECR 푸시
3. DEPLOYMENT_VERSION 증가
4. ComputeStack/ApiStack 재배포
5. 테스트

## 관련 파일
- `packages/container/src/startup.ts`
- `packages/container/src/lifecycle.ts`
- `packages/container/src/s3-sync.ts`
- `packages/container/Dockerfile`
- `packages/shared/src/constants.ts` (PERIODIC_BACKUP_INTERVAL_MS)

## 참고
- S3 버킷: `storagestack-databuckete3889a50-7zd88iuwesiu`
- 백업 prefix: `workspaces/{userId}/`
- Telegram userId: `telegram:337607235`
- Web userId: `24a8ad7c-7021-70f6-7a7c-3e52faa2c335`
