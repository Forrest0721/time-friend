FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.3 --activate
COPY . .
ARG APP_PACKAGE
RUN pnpm install --frozen-lockfile
RUN pnpm --filter "$APP_PACKAGE" build

ENV APP_PACKAGE=$APP_PACKAGE
ENV NODE_ENV=production

CMD ["sh", "-c", "pnpm --filter \"$APP_PACKAGE\" start"]
