FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates espeak-ng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["node","--experimental-sqlite","server.mjs"]
