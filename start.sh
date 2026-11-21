#!/bin/sh
echo "[Startup] Starting PGX Leads Bridge Microservice on port 4002..."
cd /app/bridge-service && node dist/server.js &

echo "[Startup] Starting Nginx on port 80..."
exec nginx -g "daemon off;"
