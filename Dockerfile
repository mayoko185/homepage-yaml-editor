FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache su-exec

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN npm install --global pnpm@11.7.0 && \
    pnpm install --prod --frozen-lockfile

COPY server.js ./
COPY public ./public
COPY --chmod=755 start.sh ./start.sh

RUN mkdir -p ./data /hp_config

EXPOSE 8081

CMD ["/app/start.sh"]
