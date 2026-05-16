FROM node:20.20.0-alpine AS builder
WORKDIR /spooty
COPY . .
RUN npm ci
RUN npm run build

FROM node:20.20.0-alpine
WORKDIR /spooty

RUN apk add --no-cache ffmpeg redis python3 py3-pip curl yt-dlp \
  && addgroup -S spooty \
  && adduser -S spooty -G spooty

COPY --from=builder --chown=spooty:spooty /spooty/dist .
COPY --from=builder --chown=spooty:spooty /spooty/src ./src
COPY --from=builder --chown=spooty:spooty /spooty/package.json ./package.json
COPY --from=builder --chown=spooty:spooty /spooty/package-lock.json ./package-lock.json
COPY --from=builder --chown=spooty:spooty /spooty/src/backend/.env.docker ./.env

RUN npm prune --production \
  && rm -rf src package.json package-lock.json \
  && mkdir -p /spooty/backend/downloads /spooty/backend/config /spooty/config \
  && chown -R spooty:spooty /spooty

USER spooty

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "backend/main.js"]
