# ==========================================
# Backend Multi-Stage Dockerfile
# ==========================================

# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist

# Non-root user for security
USER node

EXPOSE 5000

CMD ["node", "dist/server.js"]
