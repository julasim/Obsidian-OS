FROM node:22-slim

# rclone + FUSE fuer OneDrive-Mount im Container
RUN apt-get update && apt-get install -y --no-install-recommends \
    fuse3 curl ca-certificates && \
    curl -fsSL https://rclone.org/install.sh | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
