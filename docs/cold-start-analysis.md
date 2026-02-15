# Cold Start Performance Analysis

> Date: 2026-02-14 | Region: ap-northeast-2 | Fargate ARM64 0.5 vCPU / 1024 MB

## 1. End-to-End Cold Start Timeline

Full flow from user sending a message to receiving a response:

```text
User sends message
    │
    ▼ [~3s] Lambda (telegram-webhook / ws-message)
    │       Init: 540ms, RunTask + PendingMsg DDB write: 2-3s
    │
    ▼ [~35s] ECS Fargate provisioning
    │        Task scheduling → ENI allocation → Image pull → Container start
    │
    ▼ [~1.3s] S3 workspace restore
    │
    ▼ [~80s] ★ OpenClaw Gateway initialization ★ ← 65% of total
    │        Plugin loading, Browser service, Canvas, Heartbeat...
    │
    ▼ [~0.3s] WebSocket handshake (Client Ready)
    │
    ▼ [~5s] Bridge start + Public IP discovery + TaskState update
    │
    ▼ [~15-30s] Pending message consumption + AI response generation
    │
    Response received

Total: ~126-150 seconds
```

## 2. CloudWatch Metric Data

### Container Startup Metrics (Namespace: ServerlessOpenClaw)

| Metric | Telegram avg | Web avg | Share |
| ------ | ------------ | ------- | ----- |
| **StartupTotal** | 95.6s | 97.7s | 100% |
| StartupS3Restore | 1.0s | 1.5s | ~1.3% |
| **StartupGatewayWait** | **77.9s** | **80.6s** | **~82%** |
| StartupClientReady | 0.2s | 0.3s | ~0.3% |
| Other (IP/State/Bridge) | ~16.5s | ~15.3s | ~16% |

> Note: All metrics include a `Channel` dimension (telegram/web). Querying without dimensions returns empty results.

### Runtime Metrics

| Metric | Telegram | Web |
| ------ | -------- | --- |
| MessageLatency avg | 58.4s | 50.3s |
| MessageLatency min (warm) | 18.5s | 4.2s |
| MessageLatency max (cold) | 137.4s | 155.5s |
| FirstResponseTime | 127.5s | 233.9s |

- **MessageLatency min** (warm state) represents pure AI response generation time
- **MessageLatency max** (cold state) includes PendingMessage queuing wait time
- **FirstResponseTime** = container startup + first AI response generation time

### Container Log Samples (3 samples, 2026-02-14)

| Container | Total | S3 | **Gateway** | Client |
| --------- | ----- | --- | ----------- | ------ |
| 95a3... (07:17) | 112.9s | 1.7s | **81.0s** | 107ms |
| bb0b... (06:51) | 101.4s | 1.2s | **76.6s** | 387ms |
| 4159... (06:39) | 90.1s | 1.4s | **80.1s** | 291ms |

### Lambda Execution Times (telegram-webhook)

| Type | Init | Duration | Total |
| ---- | ---- | -------- | ----- |
| Cold start (RunTask) | ~540ms | ~2.2-3.5s | ~3-4s |
| Warm (bridge forward) | — | ~450-530ms | ~500ms |
| Stale IP timeout | — | ~10.5s | ~10.5s |

## 3. Bottleneck Analysis

### 3.1 OpenClaw Gateway Initialization: 78-81s (65%)

Tasks performed by `openclaw gateway run`:
1. Config loading and doctor execution
2. 30+ plugin initialization
3. Browser control service startup (Chromium profiles)
4. Canvas host mounting
5. Heartbeat startup
6. WebSocket server binding

**Outside our control**: Internal initialization logic of the OpenClaw binary.

CPU scaling history:
- 0.25 vCPU → 120s (exceeded timeout)
- 0.5 vCPU → 80s (current)
- 1.0 vCPU → ~40-50s (estimated, assuming CPU-bound)

### 3.2 ECS Fargate Provisioning: ~35s (28%)

Measured by delta between Lambda REPORT timestamp and container first log:
- Lambda 06:39:08 → Container 06:39:43 = **~35 seconds**

Docker image: 258 MB compressed (ECR), ~1.27 GB uncompressed.

### 3.3 Serial Execution Segment: ~5-8s (5%)

Current execution order in `index.ts` (serial):
```text
S3 restore → Gateway wait → Client ready → Lifecycle init →
History load → Bridge start → IP discovery → TaskState update →
Pending message consume
```

### 3.4 Lambda Stale IP Timeout Issue

Between 06:48-06:50, 6 Lambda invocations failed with "fetch failed" at ~10.5s each. The previous container had stopped but TaskState still contained a stale IP, causing Bridge HTTP requests to time out. Telegram did not receive a 200 response, triggering repeated webhook retransmissions and wasting Lambda costs.

## 4. Optimization Proposals

### Priority 1: CPU Upgrade (0.5 → 1 vCPU)

| Item | Value |
| ---- | ----- |
| Expected impact | Gateway init 80s → 40-50s (~40% reduction) |
| Cost impact | +$0.02048/hr (Fargate vCPU rate), +$0.005/session at 15 min |
| Implementation effort | Low (CDK `cpu: 1024` change) |
| Risk | None (easy rollback) |

### Priority 2: SOCI Lazy Loading

| Item | Value |
| ---- | ----- |
| Expected impact | Fargate provisioning 35s → 15-20s (~50% reduction) |
| Cost impact | None |
| Implementation effort | Medium (SOCI index build requires Linux environment) |
| Risk | Cannot generate SOCI index on macOS → CI/CD pipeline needed |

### Priority 3: Container Startup Parallelization

| Item | Value |
| ---- | ----- |
| Expected impact | ~5s savings from serial segment |
| Cost impact | None |
| Implementation effort | Low |
| Risk | None |

Parallelization design:
```text
S3 restore ──┐
              ├── Gateway wait → Client ready ──┐
              │                                  ├── Bridge + Pending consume
History load ─┘                                  │
                             IP discovery ───────┘ (background, non-blocking)
```

### Priority 4: Inactivity Timeout Adjustment

| Item | Value |
| ---- | ----- |
| Expected impact | 50-75% reduction in cold start frequency |
| Cost impact | 15min→30min: +$0.03/hr, 15min→60min: +$0.06/hr |
| Implementation effort | Low (constant change) |
| Risk | Increased cost |

### Priority 5: Lambda Stale IP Timeout Fix

| Item | Value |
| ---- | ----- |
| Expected impact | Stale state: 10.5s timeout → immediate fallback (PendingMsg queuing) |
| Cost impact | Lambda cost reduction |
| Implementation effort | Medium (Bridge HTTP timeout reduction + fallback logic) |
| Risk | Low |

### Combined Expected Impact

| Scenario | StartupTotal | FirstResponseTime |
| -------- | ------------ | ----------------- |
| Current | ~96s | ~128s |
| P1 applied (CPU 1 vCPU) | ~56s | ~88s |
| P1+P2 (+ SOCI) | ~41s | ~73s |
| P1+P2+P3 (+ parallelization) | ~36s | ~68s |

## 5. Current Infrastructure Specs

| Item | Value |
| ---- | ----- |
| Fargate CPU | 0.5 vCPU (512) |
| Fargate Memory | 1024 MB |
| Architecture | ARM64 |
| Docker Image | 258 MB (compressed) |
| OpenClaw Version | v2026.2.9 (latest: v2026.2.13) |
| Inactivity Timeout | 15 minutes |
| Lambda Runtime | Node.js 20 |
| Lambda Memory | 256 MB |
