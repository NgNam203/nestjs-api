# -------- Stage 1: build --------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for caching
COPY package.json package-lock.json ./

# Install deps (include dev deps for build)
RUN npm ci

# Copy source
COPY . .

# Generate prisma client + build
RUN npx prisma generate
RUN npm run build


# -------- Stage 2: runtime --------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache curl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy ONLY what we need from builder (includes generated Prisma client)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:3000/health || exit 1

CMD ["node", "dist/src/main.js"]