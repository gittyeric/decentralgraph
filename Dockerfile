# Dockerfile for running backend apps in Docker
FROM node:18.6-alpine

RUN apk add python3 make g++

RUN mkdir backend
COPY backend/package* backend.
RUN cd backend && npm i
COPY . .

RUN cd backend && npm run build
