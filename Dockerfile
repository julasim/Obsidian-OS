FROM node:22-slim

# System-Abhaengigkeiten + rclone
RUN apt-get update && \
    apt-get install -y --no-install-recommends fuse3 curl ca-certificates unzip && \
    curl -fsSL https://rclone.org/install.sh -o /tmp/install-rclone.sh && \
    bash /tmp/install-rclone.sh && \
    rm /tmp/install-rclone.sh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
