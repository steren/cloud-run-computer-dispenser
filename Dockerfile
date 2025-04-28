FROM node:22-slim
WORKDIR /usr/src/app
COPY . .
ENTRYPOINT [ "node", "server.js" ]