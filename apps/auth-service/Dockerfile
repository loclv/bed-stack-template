FROM oven/bun:1.3.14 AS base
WORKDIR /app

# ── Install dependencies ──────────────────────────────────────────────
FROM base AS install
COPY package.json bun.lock ./
COPY packages/be-core/package.json ./packages/be-core/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/web/package.json ./packages/web/
COPY packages/api/package.json ./packages/api/
COPY packages/script/package.json ./packages/script/
COPY apps/auth-service/package.json ./apps/auth-service/
COPY apps/seat-service/package.json ./apps/seat-service/
COPY apps/payment-service/package.json ./apps/payment-service/
RUN bun install --frozen-lockfile --production --ignore-scripts

# ── Build ─────────────────────────────────────────────────────────────
FROM install AS builder
COPY tsconfig.base.json ./
COPY packages/be-core/ ./packages/be-core/
COPY packages/contracts/ ./packages/contracts/
COPY apps/auth-service/ ./apps/auth-service/

# ── Production runner ─────────────────────────────────────────────────
FROM oven/bun:1.3.14-slim AS runner
WORKDIR /app

# Non-root user for security
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -s /bin/sh appuser

COPY --from=builder --chown=appuser:appgroup /app ./

USER appuser

ENV NODE_ENV=production
ENV AUTH_PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "fetch('http://localhost:3001/health/live').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "apps/auth-service/src/index.ts"]
