# Dockerfile for running backend apps in Docker
FROM node:18.6-alpine

RUN apk add python3 make g++

COPY backend/package.json .
RUN npm i
COPY . .

RUN cd backend && npm run build
