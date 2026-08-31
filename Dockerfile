FROM node:24-alpine AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . ./
RUN pnpm prisma generate && pnpm build

FROM dependencies AS migrator

COPY . ./
RUN pnpm prisma generate
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM postgres:18.6-alpine3.24 AS postgres-tools

FROM dependencies AS operations

COPY --from=postgres-tools /usr/local/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-tools /usr/local/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=postgres-tools /usr/local/bin/dropdb /usr/local/bin/dropdb
COPY --from=postgres-tools /usr/local/bin/createdb /usr/local/bin/createdb
COPY --from=postgres-tools /usr/local/lib/ /usr/local/lib/
COPY . ./
RUN pnpm prisma generate
ENTRYPOINT ["pnpm", "exec", "tsx", "scripts/database-backup.ts"]

FROM node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
