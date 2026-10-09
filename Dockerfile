FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.3 --activate

FROM base AS build

COPY . .
RUN pnpm install --frozen-lockfile

ARG APP_PACKAGE
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter "$APP_PACKAGE" build

FROM base AS runtime

COPY --from=build --chown=node:node /app /app
ARG APP_PACKAGE
ENV APP_PACKAGE=$APP_PACKAGE
ENV NODE_ENV=production

USER node

CMD ["sh", "-c", "pnpm --filter \"$APP_PACKAGE\" start"]
