# Workspace 백업 경로 불일치 수정

## 수정 일시
2026-02-19

## 수정 내용

### Dockerfile 변경
**파일**: `packages/container/Dockerfile`

**변경 전:**
```dockerfile
RUN chmod +x /app/start-openclaw.sh && \
    mkdir -p /data/workspace && \
    chown openclaw:openclaw /data/workspace
```

**변경 후:**
```dockerfile
RUN chmod +x /app/start-openclaw.sh && \
    mkdir -p /data && \
    ln -s /home/openclaw/.openclaw/workspace /data/workspace && \
    chown -h openclaw:openclaw /data/workspace
```

### 변경 이유
- OpenClaw workspace 실제 경로: `/home/openclaw/.openclaw/workspace/`
- 백업 대상 경로: `/data/workspace`
- 심볼릭 링크로 두 경로를 연결하여 백업이 정상 작동하도록 수정

## 배포 절차

### 1. Docker 이미지 빌드
```bash
cd ~/Documents/Study/AWS/openclaw/serverless-openclaw-main

docker build \
  --platform linux/arm64 \
  -f packages/container/Dockerfile \
  -t serverless-openclaw \
  .
```

### 2. ECR 로그인
```bash
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin \
  623542739657.dkr.ecr.ap-northeast-2.amazonaws.com
```

### 3. 이미지 태그 및 푸시
```bash
docker tag serverless-openclaw:latest \
  623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest

docker push \
  623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest
```

### 4. DEPLOYMENT_VERSION 증가
**파일**: `packages/cdk/lib/stacks/compute-stack.ts`

현재: `DEPLOYMENT_VERSION: "2026.02.09.9"`
변경: `DEPLOYMENT_VERSION: "2026.02.09.10"`

```typescript
environment: {
  // ...
  DEPLOYMENT_VERSION: "2026.02.09.10",
}
```

### 5. CDK 배포
```bash
npx cdk deploy ComputeStack ApiStack --require-approval never
```

### 6. TaskState 리셋
```bash
# Telegram
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#telegram:337607235"}}' \
  --region ap-northeast-2

# Web UI
aws dynamodb delete-item \
  --table-name serverless-openclaw-TaskState \
  --key '{"PK":{"S":"USER#24a8ad7c-7021-70f6-7a7c-3e52faa2c335"}}' \
  --region ap-northeast-2
```

### 7. 실행 중인 태스크 종료 (선택)
```bash
# 태스크 목록 확인
aws ecs list-tasks --cluster serverless-openclaw --region ap-northeast-2

# 모든 태스크 종료
for task in $(aws ecs list-tasks --cluster serverless-openclaw --region ap-northeast-2 --query 'taskArns[]' --output text); do
  aws ecs stop-task --cluster serverless-openclaw --task $task --region ap-northeast-2
done
```

## 테스트 절차

### 1. 파일 생성
Telegram 또는 Web UI에서:
```
workspace에 test.md 파일을 만들어줘. 내용은 "테스트 파일입니다."
```

### 2. 파일 확인
```
ls /home/openclaw/.openclaw/workspace/ 명령어 실행해줘
```

예상 결과: `test.md` 파일이 목록에 표시됨

### 3. 컨테이너 종료 대기
- 15분 동안 메시지 보내지 않기
- 또는 수동 종료:
  ```bash
  aws ecs stop-task --cluster serverless-openclaw --task <task-arn> --region ap-northeast-2
  ```

### 4. S3 백업 확인
```bash
# Telegram 사용자
aws s3 ls s3://storagestack-databuckete3889a50-7zd88iuwesiu/workspaces/telegram:337607235/ \
  --recursive --region ap-northeast-2

# Web UI 사용자
aws s3 ls s3://storagestack-databuckete3889a50-7zd88iuwesiu/workspaces/24a8ad7c-7021-70f6-7a7c-3e52faa2c335/ \
  --recursive --region ap-northeast-2
```

예상 결과: `test.md` 파일이 S3에 업로드되어 있음

### 5. 컨테이너 재시작
새 메시지 전송하여 컨테이너 시작

### 6. 파일 복원 확인
```
ls /home/openclaw/.openclaw/workspace/ 명령어 실행해줘
```

예상 결과: `test.md` 파일이 복원되어 있음

### 7. 파일 내용 확인
```
test.md 파일 내용 보여줘
```

예상 결과: "테스트 파일입니다." 내용이 표시됨

## 예상 효과

### Before (수정 전)
- ❌ OpenClaw가 생성한 파일이 S3에 백업되지 않음
- ❌ 컨테이너 재시작 시 모든 파일 손실
- ❌ 사용자가 생성한 workspace 파일 영구 보존 불가

### After (수정 후)
- ✅ OpenClaw workspace 파일이 S3에 자동 백업 (5분마다 + 종료 시)
- ✅ 컨테이너 재시작 시 파일 자동 복원
- ✅ 사용자 데이터 영구 보존
- ✅ 컨테이너 ephemeral storage 제약 극복

## 백업 동작 확인

### 로그 확인
```bash
# 백업 실행 로그 (없을 수도 있음 - 조용히 실행)
aws logs tail /ecs/serverless-openclaw --since 10m --region ap-northeast-2 --format short | grep -i "backup\|s3"

# 복원 로그
aws logs tail /ecs/serverless-openclaw --since 5m --region ap-northeast-2 --format short | grep -i "restore\|s3"

# Startup 시간 확인 (S3 복원 시간 포함)
aws logs tail /ecs/serverless-openclaw --since 5m --region ap-northeast-2 --format short | grep "Startup complete"
```

예상 로그:
```
Startup complete in 25000ms (S3+History: 300ms, Gateway: 23000ms, Client: 50ms)
```

## 주의사항

### 1. 심볼릭 링크 권한
- `chown -h` 옵션 사용: 심볼릭 링크 자체의 소유자 변경
- 일반 `chown`은 링크가 가리키는 대상의 소유자를 변경

### 2. 백업 주기
- 주기적 백업: 5분마다 (`PERIODIC_BACKUP_INTERVAL_MS`)
- 종료 시 백업: SIGTERM 수신 시 (`gracefulShutdown`)
- 최대 5분간의 데이터 손실 가능성 있음

### 3. S3 비용
- 파일 크기에 따라 S3 스토리지 비용 발생
- 예상: 1MB 미만 → 월 $0.01 미만
- 대용량 파일 생성 시 주의 필요

### 4. 복원 시간
- 파일 개수와 크기에 비례
- 일반적으로 100ms ~ 500ms
- 대용량 workspace는 cold start 시간 증가 가능

## 롤백 방법

문제 발생 시 이전 버전으로 롤백:

```bash
# 1. 이전 이미지 태그 확인
aws ecr describe-images \
  --repository-name serverless-openclaw \
  --region ap-northeast-2 \
  --query 'sort_by(imageDetails,& imagePushedAt)[-5:]'

# 2. 이전 이미지로 태그 변경
docker pull 623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw@sha256:<previous-digest>
docker tag <image-id> 623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest
docker push 623542739657.dkr.ecr.ap-northeast-2.amazonaws.com/serverless-openclaw:latest

# 3. DEPLOYMENT_VERSION 증가 및 재배포
# compute-stack.ts에서 DEPLOYMENT_VERSION 증가
npx cdk deploy ComputeStack ApiStack --require-approval never
```

## 관련 이슈
- `dev/workspace-backup-issue.md`: 문제 발견 및 분석
- `dev/container-restart-issue.md`: 컨테이너 재시작 문제

## 참고
- S3 Sync 코드: `packages/container/src/s3-sync.ts`
- Lifecycle 관리: `packages/container/src/lifecycle.ts`
- Startup 프로세스: `packages/container/src/startup.ts`
