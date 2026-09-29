# The Sealed web app as a self-contained Node server (Next.js standalone output).
#
#   docker build -t sealed-web \
#     --build-arg NEXT_PUBLIC_SOLANA_CLUSTER=devnet \
#     --build-arg NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com .
#   docker run -p 3000:3000 -e MONGODB_URI=... -e DATA_ENCRYPTION_KEY=... sealed-web
#
# NEXT_PUBLIC_* values are compiled into the browser code, so they are build arguments.
# Server secrets (MONGODB_URI, DATA_ENCRYPTION_KEY, RPC_URL) are runtime environment variables.

FROM node:24-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Dependencies first, so they stay cached while the source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @sealed/web...

COPY tsconfig.json ./
COPY packages/core packages/core
COPY apps/web apps/web

ARG NEXT_PUBLIC_SOLANA_CLUSTER=devnet
ARG NEXT_PUBLIC_RPC_URL=
ARG NEXT_PUBLIC_RPC_SUBSCRIPTIONS_URL=
ARG NEXT_PUBLIC_TRANSACTION_VERSION=
ARG NEXT_PUBLIC_ENABLE_TEST_WALLET=true
ENV NEXT_PUBLIC_SOLANA_CLUSTER=$NEXT_PUBLIC_SOLANA_CLUSTER \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_RPC_SUBSCRIPTIONS_URL=$NEXT_PUBLIC_RPC_SUBSCRIPTIONS_URL \
    NEXT_PUBLIC_TRANSACTION_VERSION=$NEXT_PUBLIC_TRANSACTION_VERSION \
    NEXT_PUBLIC_ENABLE_TEST_WALLET=$NEXT_PUBLIC_ENABLE_TEST_WALLET \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @sealed/web build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
