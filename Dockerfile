# Stage 1: Build the React application & Bridge microservice
FROM node:20-alpine AS build

WORKDIR /app

# Accept Vite environment variables as build arguments with defaults
ARG VITE_SUPABASE_URL=http://pgxlead-supabase-d1b84d-72-62-81-204.sslip.io
ARG VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3OTUxNTY0NjcsImV4cCI6MTg5MzQ1NjAwMCwicm9sZSI6ImFub24iLCJpc3MiOiJzdXBhYmFzZSJ9.vZ1Bqv1riBMfKOFHygrfttR9o88LwkF7KWUjdNBGcLg
ARG VITE_SUPABASE_PROJECT_ID=pgxlead-supabase

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID

# Build frontend
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Build bridge-service
WORKDIR /app/bridge-service
RUN npm ci
RUN npm run build

# Stage 2: Serve React frontend with Nginx & run Bridge service with Node.js
FROM nginx:alpine

# Install Node.js to run the bridge microservice
RUN apk add --no-cache nodejs

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static frontend assets to Nginx html directory
COPY --from=build /app/dist /usr/share/nginx/html

# Copy built bridge-service
WORKDIR /app/bridge-service
COPY --from=build /app/bridge-service/package.json /app/bridge-service/package-lock.json ./
COPY --from=build /app/bridge-service/node_modules ./node_modules
COPY --from=build /app/bridge-service/dist ./dist

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80 4002

CMD ["/bin/sh", "/start.sh"]
