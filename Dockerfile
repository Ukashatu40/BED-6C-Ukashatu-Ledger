# Dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# ── deps stage ──────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

# ── build stage ─────────────────────────────
FROM base AS builder
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# ── production stage ─────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3000
CMD ["node", "dist/main"]

# ── development stage ────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

EXPOSE 3000
CMD ["npm", "run", "start:dev"]