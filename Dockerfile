# Dockerfile for running backend apps in Docker
FROM node:18.6-alpine

RUN apk add python3 make g++

RUN mkdir backend
RUN mkdir frontend
COPY backend/package* backend/
COPY frontend/package* frontend/
RUN cd frontend && npm i
RUN cd backend && npm i
COPY . .

RUN cd backend && npm run build
