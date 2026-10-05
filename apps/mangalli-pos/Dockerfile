FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mangalli-pos/package.json apps/mangalli-pos/package.json
COPY packages/menu-pos-core/package.json packages/menu-pos-core/package.json
RUN pnpm install --frozen-lockfile --filter @1garis/mangalli-pos...

FROM deps AS build
COPY apps/mangalli-pos apps/mangalli-pos
COPY packages/menu-pos-core packages/menu-pos-core
RUN pnpm --filter @1garis/mangalli-pos build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
COPY --from=build /app/apps/mangalli-pos/public /app/apps/mangalli-pos/.next/standalone/apps/mangalli-pos/public
COPY --from=build /app/apps/mangalli-pos/.next/static /app/apps/mangalli-pos/.next/standalone/apps/mangalli-pos/.next/static
EXPOSE 4107
CMD ["sh", "-c", "pnpm --filter @1garis/mangalli-pos db:migrate && PORT=4107 HOSTNAME=0.0.0.0 node apps/mangalli-pos/.next/standalone/apps/mangalli-pos/server.js"]
