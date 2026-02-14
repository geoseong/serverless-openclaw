# Cold Start Performance Analysis

> 분석일: 2026-02-14 | 환경: ap-northeast-2 | Fargate ARM64 0.5 vCPU / 1024 MB

## 1. End-to-End 콜드 스타트 타임라인

사용자가 메시지를 전송한 시점부터 응답을 수신하기까지의 전체 흐름:

```
사용자 메시지 전송
    │
    ▼ [~3s] Lambda (telegram-webhook / ws-message)
    │       Init: 540ms, RunTask + PendingMsg DDB write: 2-3s
    │
    ▼ [~35s] ECS Fargate 프로비저닝
    │        Task 스케줄링 → ENI 할당 → Image Pull → 컨테이너 시작
    │
    ▼ [~1.3s] S3 워크스페이스 복원
    │
    ▼ [~80s] ★ OpenClaw Gateway 초기화 ★ ← 전체의 65%
    │        플러그인 로드, Browser service, Canvas, Heartbeat...
    │
    ▼ [~0.3s] WebSocket 핸드셰이크 (Client Ready)
    │
    ▼ [~5s] Bridge 시작 + Public IP 탐색 + TaskState 업데이트
    │
    ▼ [~15-30s] Pending 메시지 소비 + AI 응답 생성
    │
    응답 수신

총 소요: ~126-150초
```

## 2. CloudWatch 메트릭 데이터

### 컨테이너 Startup 메트릭 (Namespace: ServerlessOpenClaw)

| 메트릭 | Telegram avg | Web avg | 비율 |
|--------|-------------|---------|------|
| **StartupTotal** | 95.6s | 97.7s | 100% |
| StartupS3Restore | 1.0s | 1.5s | ~1.3% |
| **StartupGatewayWait** | **77.9s** | **80.6s** | **~82%** |
| StartupClientReady | 0.2s | 0.3s | ~0.3% |
| 기타 (IP/State/Bridge) | ~16.5s | ~15.3s | ~16% |

> 참고: 모든 메트릭은 `Channel` dimension (telegram/web) 포함. Dimension 없이 쿼리하면 빈 결과 반환.

### 런타임 메트릭

| 메트릭 | Telegram | Web |
|--------|----------|-----|
| MessageLatency avg | 58.4s | 50.3s |
| MessageLatency min (warm) | 18.5s | 4.2s |
| MessageLatency max (cold) | 137.4s | 155.5s |
| FirstResponseTime | 127.5s | 233.9s |

- **MessageLatency min** (warm 상태)은 순수 AI 응답 생성 시간
- **MessageLatency max** (cold 상태)는 PendingMessage 큐잉 대기 시간 포함
- **FirstResponseTime** = 컨테이너 시작 + 첫 AI 응답 생성 시간

### 컨테이너 로그 원본 (3개 샘플, 2026-02-14)

| 컨테이너 | Total | S3 | **Gateway** | Client |
|----------|-------|-----|-------------|--------|
| 95a3... (07:17) | 112.9s | 1.7s | **81.0s** | 107ms |
| bb0b... (06:51) | 101.4s | 1.2s | **76.6s** | 387ms |
| 4159... (06:39) | 90.1s | 1.4s | **80.1s** | 291ms |

### Lambda 실행 시간 (telegram-webhook)

| 유형 | Init | Duration | Total |
|------|------|----------|-------|
| Cold start (RunTask) | ~540ms | ~2.2-3.5s | ~3-4s |
| Warm (bridge forward) | — | ~450-530ms | ~500ms |
| Stale IP timeout | — | ~10.5s | ~10.5s |

## 3. 병목 분석

### 3.1 OpenClaw Gateway 초기화: 78-81초 (65%)

`openclaw gateway run` 명령이 수행하는 작업:
1. Config 로드 및 doctor 실행
2. 30+ 플러그인 초기화
3. Browser control service 시작 (Chromium profiles)
4. Canvas host 마운트
5. Heartbeat 시작
6. WebSocket 서버 바인딩

**제어 불가 영역**: OpenClaw 외부 바이너리의 내부 초기화 로직.

CPU 증설 이력:
- 0.25 vCPU → 120초 (타임아웃 초과)
- 0.5 vCPU → 80초 (현재)
- 1.0 vCPU → ~40-50초 (예상, CPU-bound 가정)

### 3.2 ECS Fargate 프로비저닝: ~35초 (28%)

Lambda REPORT 타임스탬프와 컨테이너 첫 로그 타임스탬프 차이:
- Lambda 06:39:08 → Container 06:39:43 = **~35초**

Docker 이미지: 258 MB compressed (ECR), ~1.27 GB uncompressed.

### 3.3 직렬 실행 구간: ~5-8초 (5%)

현재 `index.ts` 실행 순서 (직렬):
```
S3 restore → Gateway wait → Client ready → Lifecycle init →
History load → Bridge start → IP discovery → TaskState update →
Pending message consume
```

### 3.4 Lambda Stale IP 타임아웃 문제

06:48-06:50 사이 6건의 Lambda 호출이 ~10.5초에 "fetch failed" 오류. 이전 컨테이너가 중지되었으나 TaskState에 stale IP가 남아있어 Bridge HTTP 요청이 타임아웃됨. Telegram이 200을 받지 못해 webhook을 반복 재전송하여 Lambda 비용 낭비 발생.

## 4. 최적화 방안

### Priority 1: CPU 증설 (0.5 → 1 vCPU)

| 항목 | 값 |
|------|-----|
| 예상 효과 | Gateway init 80s → 40-50s (~40% 단축) |
| 비용 영향 | +$0.02048/hr (Fargate vCPU 단가), 15분 사용 기준 +$0.005/세션 |
| 구현 난이도 | 낮음 (CDK `cpu: 1024` 변경) |
| 리스크 | 없음 (롤백 용이) |

### Priority 2: SOCI Lazy Loading

| 항목 | 값 |
|------|-----|
| 예상 효과 | Fargate 프로비저닝 35s → 15-20s (~50% 단축) |
| 비용 영향 | 없음 |
| 구현 난이도 | 중간 (Linux 환경에서 SOCI 인덱스 빌드 필요) |
| 리스크 | macOS에서 SOCI 인덱스 생성 불가 → CI/CD 파이프라인 필요 |

### Priority 3: 컨테이너 Startup 병렬화

| 항목 | 값 |
|------|-----|
| 예상 효과 | 직렬 구간 ~5초 절약 |
| 비용 영향 | 없음 |
| 구현 난이도 | 낮음 |
| 리스크 | 없음 |

병렬화 설계:
```
S3 restore ──┐
              ├── Gateway wait → Client ready ──┐
              │                                  ├── Bridge + Pending consume
History load ─┘                                  │
                             IP discovery ───────┘ (background, non-blocking)
```

### Priority 4: Inactivity Timeout 조정

| 항목 | 값 |
|------|-----|
| 예상 효과 | 콜드 스타트 빈도 50-75% 감소 |
| 비용 영향 | 15분→30분: +$0.03/hr, 15분→60분: +$0.06/hr |
| 구현 난이도 | 낮음 (상수 변경) |
| 리스크 | 비용 증가 |

### Priority 5: Lambda Stale IP 타임아웃 개선

| 항목 | 값 |
|------|-----|
| 예상 효과 | Stale 상태 시 10.5초 타임아웃 → 즉시 fallback (PendingMsg 큐잉) |
| 비용 영향 | Lambda 비용 절감 |
| 구현 난이도 | 중간 (Bridge HTTP timeout 단축 + fallback 로직) |
| 리스크 | 낮음 |

### 종합 예상 효과

| 시나리오 | StartupTotal | FirstResponseTime |
|----------|-------------|-------------------|
| 현재 | ~96s | ~128s |
| P1 적용 (CPU 1 vCPU) | ~56s | ~88s |
| P1+P2 (+ SOCI) | ~41s | ~73s |
| P1+P2+P3 (+ 병렬화) | ~36s | ~68s |

## 5. 현재 인프라 사양

| 항목 | 값 |
|------|-----|
| Fargate CPU | 0.5 vCPU (512) |
| Fargate Memory | 1024 MB |
| Architecture | ARM64 |
| Docker Image | 258 MB (compressed) |
| OpenClaw Version | v2026.2.9 (latest: v2026.2.13) |
| Inactivity Timeout | 15분 |
| Lambda Runtime | Node.js 20 |
| Lambda Memory | 256 MB |
