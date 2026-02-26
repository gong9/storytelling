# ============================================
# Stage 1: Dependencies
# ============================================
FROM docker.m.daocloud.io/library/node:20-alpine AS deps

# 安装构建 native modules 所需的依赖 (better-sqlite3 等)
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# ============================================
# Stage 2: Builder
# ============================================
FROM docker.m.daocloud.io/library/node:20-alpine AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 设置环境变量
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# 确保 public 目录存在（即使为空）
RUN mkdir -p public

# 构建应用
RUN pnpm build

# ============================================
# Stage 3: Runner
# ============================================
FROM docker.m.daocloud.io/library/node:20-alpine AS runner

WORKDIR /app

# 安装运行时依赖 (better-sqlite3 需要)
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制构建产物（public 可能为空但目录存在）
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# 创建输出目录并设置权限
RUN mkdir -p /app/out && chown -R nextjs:nodejs /app/out

# 切换到非 root 用户
USER nextjs

# 暴露端口
EXPOSE 3100

ENV PORT=3100
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
