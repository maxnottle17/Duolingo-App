FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production DB_PATH=/data/tracker.db PORT=3000
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
