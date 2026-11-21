#!/bin/sh
# Start PGX Leads Bridge Microservice in background on port 4002
echo "[Startup] Starting PGX Leads Bridge Microservice on port 4002..."
cd /app/bridge-service && node dist/server.js &

# Start Nginx in foreground on port 80
echo "[Startup] Starting Nginx on port 80..."
nginx -g "daemon off;"
