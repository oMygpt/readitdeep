# Frontend Dockerfile
# =============================================================================
# GHCR 替代方案 (Nginx):
#   FROM cgr.dev/chainguard/nginx:latest
#   或 ghcr.io/nginxinc/nginx-unprivileged:stable-alpine
# =============================================================================
FROM node:20-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build
RUN npm run build

# Production image
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
