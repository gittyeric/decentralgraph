# Dockerfile for running backend apps in Docker
FROM node:18.7-alpine

RUN apk add python3 make g++

WORKDIR /opt
RUN mkdir backend
RUN mkdir frontend
COPY backend/package* backend/
COPY frontend/package* frontend/
RUN cd frontend && npm i

RUN cd backend && npm i
COPY . .
WORKDIR /opt/backend

RUN npm run build

ENV NODE_ENV=dev

# SERVICE can be "core" or "bridge"
CMD npm run "$SERVICE:$NODE_ENV"
