FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --only=production

COPY . .

RUN mkdir -p ./data /hp_config && \
    apk add --no-cache su-exec

EXPOSE 8081

RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
