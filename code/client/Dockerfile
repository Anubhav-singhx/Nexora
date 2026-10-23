# Web image: builds the React app and serves it with nginx, which forwards /api to the API container.
# Build from the repository root:  docker build -f code/client/Dockerfile -t onboardiq-web .
FROM node:22-slim AS build
WORKDIR /app
COPY code/client/package.json code/client/package-lock.json ./
RUN npm ci
COPY code/client ./
RUN npm run build

FROM nginx:1.27-alpine
COPY code/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
