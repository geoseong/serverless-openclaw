# Stage 1: Build
FROM --platform=linux/arm64 node:20-slim AS builder

WORKDIR /build

# Copy workspace root files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/container/package.json packages/container/tsconfig.json packages/container/
COPY packages/container/src/ packages/container/src/

RUN npm pkg delete scripts.prepare && \
    npm ci
RUN npm run build --workspace=packages/shared --workspace=packages/container

# Stage 2: Runtime
FROM --platform=linux/arm64 node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl unzip && \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o /tmp/awscliv2.zip && \
    unzip -q /tmp/awscliv2.zip -d /tmp && \
    /tmp/aws/install && \
    rm -rf /tmp/aws /tmp/awscliv2.zip && \
    apt-get purge -y unzip && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r openclaw && useradd -r -g openclaw -m openclaw

WORKDIR /app

# Copy production dependencies (remove workspace symlink first)
RUN mkdir -p /app/node_modules
COPY --from=builder /build/packages/container/dist/ /app/dist/
COPY --from=builder /build/node_modules/ /app/node_modules/
# Overwrite workspace symlink with real shared package
RUN rm -rf /app/node_modules/@serverless-openclaw/shared
COPY --from=builder /build/packages/shared/dist/ /app/node_modules/@serverless-openclaw/shared/dist/
COPY --from=builder /build/packages/shared/package.json /app/node_modules/@serverless-openclaw/shared/
COPY packages/container/package.json /app/
COPY packages/container/start-openclaw.sh /app/

RUN chmod +x /app/start-openclaw.sh && \
    mkdir -p /data/workspace && \
    chown -R openclaw:openclaw /app /data

USER openclaw

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/start-openclaw.sh"]
