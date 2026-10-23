# API image. Build from the repository root:  docker build -f code/server/Dockerfile -t onboardiq-api .
# The API reads data/ (reference lists, mock extraction file) relative to the repository root, so the image keeps the same layout.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY code/server/package.json code/server/package-lock.json ./code/server/
RUN cd code/server && npm ci --omit=dev
COPY code/server ./code/server
COPY data ./data
RUN mkdir -p uploads
WORKDIR /app/code/server
EXPOSE 3001
CMD ["node", "src/index.js"]
