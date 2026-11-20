FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/bot-rules/package.json packages/bot-rules/package.json
RUN npm ci --workspace @reeldesk/web --no-audit --no-fund
COPY apps/web/ apps/web/
COPY packages/bot-rules/ packages/bot-rules/
COPY packages/localization/ packages/localization/
RUN npm run build --workspace @reeldesk/web

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/apps/web/.next/standalone/ ./
COPY --from=build --chown=node:node /app/apps/web/.next/static/ apps/web/.next/static/
COPY --from=build --chown=node:node /app/apps/web/public/ apps/web/public/
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
