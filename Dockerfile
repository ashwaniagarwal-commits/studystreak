# StudyStreak v0 — Fastify on Node 22 LTS, Alpine for small image.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY server ./server
COPY public ./public

# App Runner pings /healthz; expose the port.
EXPOSE 8080

# Drop privileges. The `node` user exists in the image.
USER node

CMD ["node", "server/server.js"]
