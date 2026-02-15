# Cold Start Optimization

> Region: ap-northeast-2 | Fargate ARM64 1 vCPU / 2048 MB

## Phase 1: Infrastructure Optimization (Complete)

All 5 optimizations applied. Cold start reduced from ~126-150s to **63.9s** (~57% reduction).

### 1.1 End-to-End Cold Start Timeline

```text
User sends message
    |
    v [~2.9s] Lambda (telegram-webhook / ws-message)
    |         RunTask + PendingMsg DDB write
    |
    v [~25s] ECS Fargate provisioning (estimated, with SOCI potential)
    |        Task scheduling -> ENI allocation -> Image pull -> Container start
    |
    v [parallel] S3 restore + History load (Promise.all)
    |
    v [~30-35s] * OpenClaw Gateway initialization *
    |           Plugin loading, Browser service, Canvas, Heartbeat...
    |
    v [~0.3s] WebSocket handshake (Client Ready)
    |
    v [~3s] Pending message consumption + AI response generation
    |
    v (background) IP discovery + TaskState update (non-blocking)
    |
    Response received

Total: ~64s (measured 2026-02-15)
Previous: ~126-150s (2026-02-14, before optimizations)
```

### 1.2 Latest Measurement (2026-02-15)

Measured via `make cold-start` (WebSocket channel, cold start from idle):

| Metric | Value |
| ------ | ----- |
| Start type | COLD (container idle -> RunTask) |
| "Starting" status | +2.9s |
| **First response** | **63.9s** |
| **Stream complete** | **67.0s** |
| Messages total | 55 |

**Improvement from baseline:**

| Version | First Response | Reduction |
| ------- | -------------- | --------- |
| Baseline (0.5 vCPU, serial startup) | ~126-150s | -- |
| After CPU upgrade only (1 vCPU) | ~76.8s | ~40% |
| **All optimizations applied** | **63.9s** | **~57%** |

Timing breakdown (estimated from 63.9s total):
- Lambda -> ECS RunTask trigger: ~2.9s
- ECS provisioning + Container startup + Gateway init: ~58s
- AI inference (first token): ~3s

### 1.3 Applied Optimizations

#### P1: CPU Upgrade (0.5 -> 1 vCPU) -- APPLIED

| Item | Value |
| ---- | ----- |
| Impact | Gateway init 80s -> 40-50s (~40% reduction) |
| Cost | +$0.02048/hr (Fargate vCPU rate), +$0.005/session at 15 min |
| Status | Applied (CPU 512->1024, Memory 1024->2048) |

#### P2: SOCI Lazy Loading -- APPLIED

| Item | Value |
| ---- | ----- |
| Impact | Fargate provisioning 35s -> 15-20s (~50% reduction) |
| Cost | None |
| Status | Applied (GitHub Actions workflow: `.github/workflows/deploy-image.yml`) |

#### P3: Container Startup Parallelization -- APPLIED

| Item | Value |
| ---- | ----- |
| Impact | ~5s savings from serial segment |
| Cost | None |
| Status | Applied (`startup.ts`: Promise.all for S3+History, non-blocking IP discovery) |

Parallelization design:
```text
S3 restore ---+
              +--- Gateway wait -> Client ready ---+
              |                                     +--- Bridge + Pending consume
History load -+                                     |
                             IP discovery ----------+ (background, non-blocking)
```

#### P4: Dynamic Inactivity Timeout -- APPLIED

| Item | Value |
| ---- | ----- |
| Impact | 50-75% reduction in cold start frequency during active hours |
| Cost | Near-neutral (+$0.25-0.35/mo) |
| Status | Applied (watchdog Lambda: active hours 30min / inactive hours 10min) |

Approach: Watchdog Lambda queries CloudWatch `MessageLatency` to detect active hours (KST). If the current hour-of-day had messages on >= 2 of the past 7 days, use 30-min timeout (active). Otherwise, use 10-min timeout (inactive). First 7 days fall back to the current 15-min default.

#### P5: Lambda Stale IP Timeout Fix -- APPLIED

| Item | Value |
| ---- | ----- |
| Impact | Stale state: 10.5s timeout -> immediate fallback (PendingMsg queuing) |
| Cost | Lambda cost reduction |
| Status | Applied (3s Bridge timeout, fallback to PendingMsg + deleteTaskState, watchdog stale detection) |

#### Combined Impact (Estimated vs Actual)

| Scenario | Estimated | Actual |
| -------- | --------- | ------ |
| Baseline (0.5 vCPU, serial) | ~128s | ~126-150s |
| P1 only (CPU 1 vCPU) | ~88s | ~76.8s |
| **All applied (P1-P5)** | **~68s** | **63.9s** |

Total improvement: **~57% reduction** from baseline.

### 1.4 Baseline CloudWatch Metrics (2026-02-14, pre-optimization)

#### Container Startup Metrics (Namespace: ServerlessOpenClaw)

| Metric | Telegram avg | Web avg | Share |
| ------ | ------------ | ------- | ----- |
| **StartupTotal** | 95.6s | 97.7s | 100% |
| StartupS3Restore | 1.0s | 1.5s | ~1.3% |
| **StartupGatewayWait** | **77.9s** | **80.6s** | **~82%** |
| StartupClientReady | 0.2s | 0.3s | ~0.3% |
| Other (IP/State/Bridge) | ~16.5s | ~15.3s | ~16% |

> Note: All metrics include a `Channel` dimension (telegram/web). Querying without dimensions returns empty results.

#### Runtime Metrics

| Metric | Telegram | Web |
| ------ | -------- | --- |
| MessageLatency avg | 58.4s | 50.3s |
| MessageLatency min (warm) | 18.5s | 4.2s |
| MessageLatency max (cold) | 137.4s | 155.5s |
| FirstResponseTime | 127.5s | 233.9s |

- **MessageLatency min** (warm state) represents pure AI response generation time
- **MessageLatency max** (cold state) includes PendingMessage queuing wait time
- **FirstResponseTime** = container startup + first AI response generation time

#### Container Log Samples (3 samples, 2026-02-14)

| Container | Total | S3 | **Gateway** | Client |
| --------- | ----- | --- | ----------- | ------ |
| 95a3... (07:17) | 112.9s | 1.7s | **81.0s** | 107ms |
| bb0b... (06:51) | 101.4s | 1.2s | **76.6s** | 387ms |
| 4159... (06:39) | 90.1s | 1.4s | **80.1s** | 291ms |

#### Lambda Execution Times (telegram-webhook)

| Type | Init | Duration | Total |
| ---- | ---- | -------- | ----- |
| Cold start (RunTask) | ~540ms | ~2.2-3.5s | ~3-4s |
| Warm (bridge forward) | -- | ~450-530ms | ~500ms |
| Stale IP timeout | -- | ~10.5s | ~10.5s |

### 1.5 Bottleneck Analysis

#### OpenClaw Gateway Initialization: 78-81s (65% of baseline)

Tasks performed by `openclaw gateway run`:
1. Config loading and doctor execution
2. 30+ plugin initialization
3. Browser control service startup (Chromium profiles)
4. Canvas host mounting
5. Heartbeat startup
6. WebSocket server binding

**Outside our control**: Internal initialization logic of the OpenClaw binary.

CPU scaling history:
- 0.25 vCPU -> 120s (exceeded timeout)
- 0.5 vCPU -> 80s (previous)
- 1.0 vCPU -> ~35s (current, measured)

#### ECS Fargate Provisioning: ~35s (28% of baseline)

Measured by delta between Lambda REPORT timestamp and container first log:
- Lambda 06:39:08 -> Container 06:39:43 = **~35 seconds**

Docker image: 258 MB compressed (ECR), ~1.27 GB uncompressed.

#### Lambda Stale IP Timeout Issue (resolved)

Between 06:48-06:50, 6 Lambda invocations failed with "fetch failed" at ~10.5s each. The previous container had stopped but TaskState still contained a stale IP, causing Bridge HTTP requests to time out. Resolved by P5 (3s timeout + fallback).

---

## Phase 2: Gateway Init Reduction (In Progress)

> Research completed 2026-02-15. Implementation pending.

Gateway init (~30-35s) remains the largest single bottleneck (~52% of total cold start). Since `openclaw gateway run` is an external binary, optimization options are constrained.

### 2.1 Remaining Bottleneck

| Component | Duration | Share |
| --------- | -------- | ----- |
| Lambda -> RunTask | ~2.9s | 5% |
| ECS provisioning | ~25s | 39% |
| **Gateway init** | **~30-35s** | **~52%** |
| Client ready + AI response | ~3s | 5% |

### 2.2 Approaches Evaluated

#### P6: zstd Container Image Compression

**Status: Implementable**

Standard gzip -> zstd compression reduces Fargate image pull + extraction time by up to 27%.

```bash
docker buildx build \
  --platform linux/arm64 \
  -t $ECR_REPO:latest \
  --provenance=false \
  --push \
  --compression=zstd \
  --force-compression=true \
  --compression-level=3 \
  -f packages/container/Dockerfile .
```

| Item | Value |
| ---- | ----- |
| Expected impact | ECS provisioning ~25s -> ~18s (~7s savings) |
| Compatible with SOCI | Yes (Fargate auto-detects both) |
| Requires | Fargate platform 1.4+ (current), Docker Buildx |
| Cost | None |
| Risk | None (transparent to application) |

**Source**: [AWS Blog -- Reducing Fargate Startup with zstd](https://aws.amazon.com/blogs/containers/reducing-aws-fargate-startup-times-with-zstd-compressed-container-images/)

#### P7: CPU Upgrade to 2 vCPU

**Status: Implementable**

| CPU | Gateway Init (measured/estimated) | Monthly Cost Delta |
| --- | --------------------------------- | ------------------ |
| 0.5 vCPU | ~80s | baseline |
| 1 vCPU | ~35s (measured) | +$0.005/session |
| **2 vCPU** | **~20-25s (estimated)** | **+$0.01/session** |
| 4 vCPU | ~15-18s (estimated, diminishing returns) | +$0.02/session |

| Item | Value |
| ---- | ----- |
| Expected impact | Gateway init ~35s -> ~20-25s |
| Cost impact | +$0.01/session (at ~15 min session) |
| Implementation | CDK `cpu: 2048`, `memoryLimitMiB: 4096` |
| Risk | Low (easy rollback); diminishing returns beyond 2 vCPU |

#### P8: OpenClaw Version Upgrade

**Status: Should monitor**

Current: v2026.2.9 (latest available: v2026.2.13). Newer versions may include startup performance improvements, plugin lazy loading, or reduced Chromium overhead.

**Recommendation**: Test latest version and benchmark Gateway init time.

#### P9: Predictive Pre-Warming (EventBridge Scheduled Scaling)

**Status: Good cost/performance balance**

Pre-launch a container before expected usage windows using EventBridge + Lambda.

```
EventBridge (cron: 0 9 ? * MON-FRI *) -> Lambda -> ECS RunTask
```

| Item | Value |
| ---- | ----- |
| Expected impact | Eliminates cold start during scheduled hours |
| Cost | Only pay for actual running time (e.g., 8hr/day = ~$8-10/month) |
| Implementation | EventBridge rule + Lambda to call RunTask |
| Synergy | Works with existing dynamic watchdog (30min active / 10min inactive) |
| Risk | Misses off-schedule usage; container idles during quiet hours |

This could extend the existing watchdog logic: if the current hour is a predicted active hour, pre-launch a container proactively rather than waiting for the first message.

#### P10: Warm Standby Container (desiredCount=1)

**Status: Most effective, but expensive**

Keep a single Fargate task always running via ECS Service.

| Item | Value |
| ---- | ----- |
| Expected impact | Cold start -> 0s (always warm) |
| Monthly cost (On-Demand) | ~$35-40/month (1 vCPU, 2 GB, ARM64, ap-northeast-2) |
| Monthly cost (Spot) | ~$10-12/month (70% discount, risk of interruption) |

Cost calculation (US East reference, Seoul ~10-20% higher):
- vCPU: $0.03238/hr x 730h = $23.64
- Memory: $0.00356/hr/GB x 2GB x 730h = $5.20
- **Total On-Demand: ~$28.84/month** (US East), **~$32-38/month** (Seoul estimated)
- **Fargate Spot: ~$9-12/month** (70% discount)

**Trade-off**: Conflicts with the project's $1/month cost target. Only viable if usage grows enough to justify the cost.

#### Blocked Approaches

| Approach | Status | Reason |
| -------- | ------ | ------ |
| Lambda SnapStart | Blocked (runtime) | Not available for Node.js (Java/Python 3.12+/.NET 8 only) |
| Lambda migration | Blocked (architecture) | Gateway requires persistent WebSocket server + Chromium (see Section 2.3) |
| OpenClaw headless mode | Blocked (upstream) | No documented flags for disabling plugins or minimal mode |
| CRIU checkpoint/restore | Blocked (Fargate) | No host-level kernel access on Fargate |
| OpenClaw lazy plugin loading | Blocked (upstream) | Requires OpenClaw to support deferred init |

### 2.3 Lambda SnapStart / Lambda Migration Analysis

> Research completed 2026-02-15 via OpenClaw codebase analysis (`references/openclaw`) + Perplexity queries.

**Conclusion: Not viable.** Both Lambda SnapStart and migrating the Gateway to Lambda are blocked by fundamental architectural incompatibilities.

#### Lambda SnapStart Limitations

Lambda SnapStart creates a pre-initialized snapshot of the execution environment to eliminate cold starts. However:

| Constraint | Detail |
| ---------- | ------ |
| **Runtime support** | Java (11/17/21/25), Python 3.12+, .NET 8 only. **Node.js not supported.** |
| **Snapshot scope** | Captures memory state after `init` phase only. Cannot snapshot running servers or open connections. |
| **Execution model** | Lambda is request-response (max 15 min). Cannot host persistent WebSocket servers. |

Even if Node.js were supported, SnapStart snapshots the init phase — the Gateway's 30-35s init would need to complete before snapshot, and the resulting snapshot cannot include bound sockets or running services.

#### OpenClaw Gateway Architecture (Why Lambda Is Incompatible)

Analysis of the OpenClaw source code reveals the following architecture:

**Runtime:** Node.js 22, TypeScript compiled via `tsdown`, entry: `openclaw.mjs` → `dist/entry.js` → CLI → `startGatewayServer()`

**Startup sequence** (`src/gateway/server.impl.ts`):

```text
1. Config loading, validation, legacy migration
2. Plugin auto-enable + plugin loading (jiti TypeScript JIT)
   - 36+ extensions discovered from extensions/ directory
   - Synchronous register() calls per plugin
3. Runtime config resolution (auth, TLS, bind mode)
4. Canvas host server startup (HTTP + WebSocket on separate port)
5. WebSocket server binding (port 18789, persistent connections)
6. Sidecars (parallel):
   - Browser control server (Playwright + Chromium)
   - Gmail watcher
   - Internal hooks loader
   - Channel startup (Telegram, Discord, Slack, WhatsApp, etc.)
   - Plugin services
   - Memory backend
   - Bonjour/mDNS discovery
   - Heartbeat runner
   - Cron scheduler
```

**Lambda-incompatible components:**

| Component | Reason |
| --------- | ------ |
| WebSocket server (:18789) | Lambda cannot bind/listen on ports. API Gateway WebSocket API uses a different model (discrete event handlers). |
| Browser control (Playwright) | Requires persistent Chromium process. Lambda has 512MB `/tmp`, 10GB ephemeral storage max — Chromium alone needs ~400MB+ RAM. |
| Canvas host (HTTP+WS server) | Separate server process on its own port. |
| Plugin system (36+ extensions) | Heavy synchronous init via `jiti` transpiler. Each plugin calls `register()` during load. |
| Docker image (1.27GB) | Lambda container images support up to 10GB but cold start scales with image size. 1.27GB → estimated 5-30s+ image pull alone. |

**Environmental skip flags** (exist but insufficient):

| Flag | Skips |
| ---- | ----- |
| `OPENCLAW_SKIP_BROWSER_CONTROL_SERVER=1` | Playwright/Chromium |
| `OPENCLAW_SKIP_CANVAS_HOST=1` | Canvas UI server |
| `OPENCLAW_SKIP_CHANNELS=1` | Channel initialization |
| `OPENCLAW_SKIP_GMAIL_WATCHER=1` | Email watcher |
| `OPENCLAW_SKIP_CRON=1` | Cron jobs |
| `plugins.enabled: false` | All plugins |

Even with all optional services disabled, the core Gateway still requires a persistent WebSocket server for client connections and the JSON-RPC protocol handler — fundamentally incompatible with Lambda's request-response model.

**Test-only minimal mode** (`OPENCLAW_TEST_MINIMAL_GATEWAY=1`) exists but is gated behind `VITEST=1` and is not designed for production use.

### 2.4 Phase 2 Priority Matrix

| Priority | Approach | Impact | Cost | Effort |
| -------- | -------- | ------ | ---- | ------ |
| **P6** | zstd compression | ~7s savings | Free | Low |
| **P7** | CPU 2 vCPU | ~10-15s savings | +$0.01/session | Low |
| **P8** | OpenClaw version upgrade | Unknown | Free | Low |
| **P9** | Predictive pre-warming | Eliminates cold start (scheduled) | ~$8-10/month | Medium |
| P10 | Warm standby (Spot) | Eliminates cold start | ~$10-12/month | Low |

### 2.5 Projected Cold Start

| Scenario | First Response |
| -------- | -------------- |
| Current (Phase 1 complete) | **63.9s** |
| + P6 zstd compression | ~57s |
| + P7 CPU 2 vCPU | ~42-47s |
| + P9 Predictive pre-warming | **0s** (during active hours) |

---

## Infrastructure Specs

| Item | Value |
| ---- | ----- |
| Fargate CPU | 1 vCPU (1024) |
| Fargate Memory | 2048 MB |
| Architecture | ARM64 |
| Docker Image | 258 MB (compressed) |
| OpenClaw Version | v2026.2.9 (latest: v2026.2.13) |
| Inactivity Timeout | Dynamic (active: 30min / inactive: 10min) |
| Lambda Runtime | Node.js 20 |
| Lambda Memory | 256 MB |

## References

- [AWS Blog -- Reducing Fargate Startup with zstd](https://aws.amazon.com/blogs/containers/reducing-aws-fargate-startup-times-with-zstd-compressed-container-images/)
- [AWS Lambda SnapStart](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html) -- Supported runtimes: Java, Python 3.12+, .NET 8 (Node.js not supported)
- [AWS Lambda Container Image Support](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html) -- Up to 10GB images, but cold start scales with size
- [CRIU on Containers](https://www.devzero.io/blog/checkpoint-restore-with-criu)
- [Using CRaC on EKS](https://aws.amazon.com/blogs/containers/using-crac-to-reduce-java-startup-times-on-amazon-eks/)
- [Fargate vs Lambda Decision Guide](https://docs.aws.amazon.com/decision-guides/latest/fargate-or-lambda/fargate-or-lambda.html)
- [OpenClaw Gateway Configuration](https://docs.openclaw.ai/gateway/configuration)
- [Fargate Task Recommendations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-recommendations.html)
