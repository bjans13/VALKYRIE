# Use Debian 13 (Trixie) as base image
FROM debian:trixie-slim

# Set environment variables
ENV NODE_VERSION=20.x
ENV NODE_ENV=production

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    gnupg \
    openssh-client \
    && curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION} | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application
COPY . .

# Create volume for SSH keys and config
VOLUME ["/usr/src/app/.ssh"]

# Create volume for logs
VOLUME ["/usr/src/app/logs"]

# Start the bot
CMD ["npm", "start"]
