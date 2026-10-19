FROM node:20-alpine AS base
RUN apk add --no-cache curl

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Builder
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Worker
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
# Commit con el que se construyó la imagen (deploy.sh lo pasa como build arg).
# Permite detectar un contenedor que sigue con una imagen antigua.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs
CMD ["npx", "tsx", "src/server/worker.ts"]

# Runner — salida `standalone` de Next (output: "standalone" en next.config).
# Antes se copiaba todo node_modules y se arrancaba con `npm start`
# (next start), que no está soportado con output standalone.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
