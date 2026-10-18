FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production POKADROVO_PORT=5173 POKADROVO_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
RUN rm -rf server/tests && mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "server/healthcheck.mjs"]
CMD ["node", "server/container.mjs"]
