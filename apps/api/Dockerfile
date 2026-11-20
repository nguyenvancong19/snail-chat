FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/bot-rules/package.json packages/bot-rules/package.json

FROM dependencies AS build
RUN npm ci --workspace @reeldesk/api --no-audit --no-fund
COPY apps/api/ apps/api/
COPY packages/bot-rules/ packages/bot-rules/
COPY packages/localization/ packages/localization/
RUN npm run build --workspace @reeldesk/api

FROM dependencies AS runtime
ENV NODE_ENV=production PORT=4000 BIND_HOST=0.0.0.0 DATA_DIR=/app/data
RUN npm ci --workspace @reeldesk/api --omit=dev --no-audit --no-fund \
    && mkdir -p /app/data/videos && chown -R node:node /app/data
COPY packages/bot-rules/ packages/bot-rules/
COPY packages/localization/ packages/localization/
COPY --from=build /app/apps/api/dist/ apps/api/dist/
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
