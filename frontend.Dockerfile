FROM node:18.6-alpine as builder

COPY frontend/package.json frontend/package-lock.json ./

# Install the dependencies and make the folder
RUN npm i && mkdir /react-ui && mv ./node_modules ./react-ui

WORKDIR /react-ui

COPY . .

# Build the project and copy the files
RUN npm run build

FROM nginx:alpine

COPY ./frontend/nginx.conf /etc/nginx/nginx.conf

## Axe default nginx index page
RUN rm -rf /usr/share/nginx/html/*

COPY --from=builder /react-ui/build /usr/share/nginx/html

EXPOSE 3000 80

ENTRYPOINT ["nginx", "-g", "daemon off;"]
