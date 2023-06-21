FROM node:18.6-alpine as builder

RUN mkdir /react-ui
COPY frontend/package.json frontend/package-lock.json /react-ui/

WORKDIR /react-ui

# Install the dependencies and make the folder
RUN npm i

COPY frontend ./

# Build the project and copy the files
RUN npm run build

FROM nginx:alpine

COPY ./frontend/nginx.conf /etc/nginx/nginx.conf

## Axe default nginx index page
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /react-ui/build /usr/share/nginx/html

EXPOSE ${FRONTEND_PORT} 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
