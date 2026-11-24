# ==============================================================================
# 1. Base Image
# ==============================================================================
FROM oven/bun:1.4.4 AS base
WORKDIR /app

# ==============================================================================
# 2. Dependency Installation
# ==============================================================================
FROM base AS install
# Copy package manifests and lockfile to optimize caching
COPY package.json bun.lock ./
COPY packages/be-core/package.json ./packages/be-core/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/web/package.json ./packages/web/
COPY packages/api/package.json ./packages/api/
COPY packages/script/package.json ./packages/script/
COPY apps/auth-service/package.json ./apps/auth-service/
COPY apps/seat-service/package.json ./apps/seat-service/
COPY apps/payment-service/package.json ./apps/payment-service/

# Install dependencies using bun's frozen lockfile validation
RUN bun install --frozen-lockfile --ignore-scripts

# ==============================================================================
# 3. Source Compilation & Build
# ==============================================================================
FROM install AS builder
# Copy the rest of the application codebase
COPY . .

# Set PUBLIC_API_URL build argument for frontend static asset compilation
ARG PUBLIC_API_URL=http://localhost:3000
ENV PUBLIC_API_URL=${PUBLIC_API_URL}

# Build the frontend static assets
RUN bun --cwd packages/web build

# Compile the Elysia API server into a standalone platform-native binary
# This automatically targets the current architecture (x86_64 or arm64) of the builder
RUN cd packages/api && bun build --compile --production --outfile dist/server src/index.ts

# ==============================================================================
# 4. Production API Runner
# ==============================================================================
FROM oven/bun:1.3.14-slim AS api
WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV API_PORT=3000
ENV DATABASE_PATH=/app/data/sqlite.db
ENV WEB_URL=http://localhost:4097

# Create data directory for SQLite database persistence
RUN mkdir -p /app/data

# Copy the compiled standalone API binary from builder stage
COPY --from=builder /app/packages/api/dist/server ./server

# Expose API port
EXPOSE 3000

# Execute the self-contained native server binary
CMD ["./server"]

# ==============================================================================
# 5. Production Web (Nginx) Runner
# ==============================================================================
FROM nginx:alpine AS web

# Copy custom Nginx routing and server configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy React built static assets from builder stage
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

# Expose Nginx standard port
EXPOSE 80

# Run Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
