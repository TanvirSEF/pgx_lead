import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import {
  initiateHandler,
  payRelayHandler,
  returnHandler,
  webhookHandler,
} from './bridge.controller.js'

const app = express()

app.use(cors())

// Health check endpoint
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'pgx-leads-bridge-service',
    bridgeProfile: config.bridgeProfile,
    brandName: config.brandName,
    port: config.port,
    timestamp: new Date().toISOString(),
  })
})

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'PGX Leads Bridge Microservice',
    status: 'running',
    bridgeProfile: 'leads',
    endpoints: [
      'POST /api/gateway-bridge/initiate',
      'GET /api/gateway-bridge/pay?s=...',
      'GET /api/gateway-bridge/return',
      'POST /api/gateway-bridge/webhook',
      'GET /health',
    ],
  })
})

// Webhook endpoint requires raw body for Stripe signature validation
const rawBodyParser = [
  express.raw({ type: '*/*' }),
  (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (Buffer.isBuffer(req.body) && !config.stripeWebhookSecret) {
      try {
        req.body = JSON.parse(req.body.toString('utf-8'))
      } catch {
        // Fallback
      }
    }
    next()
  },
  webhookHandler,
]

app.post('/api/gateway-bridge/webhook', ...rawBodyParser)
app.post('/webhook', ...rawBodyParser)

// JSON body parser for all other routes
app.use(express.json())

// Bridge endpoints (Mounted under both /api/gateway-bridge and / for maximum reverse-proxy resilience)
app.post('/api/gateway-bridge/initiate', initiateHandler)
app.post('/initiate', initiateHandler)

app.get('/api/gateway-bridge/pay', payRelayHandler)
app.get('/pay', payRelayHandler)

app.get('/api/gateway-bridge/return', returnHandler)
app.get('/return', returnHandler)

// Error handling
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[PGX Leads Bridge Error]:', err)
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  })
})

app.listen(config.port, () => {
  console.log(`=======================================================`)
  console.log(` 🚀 PGX Leads Bridge Service running on port ${config.port}`)
  console.log(` 🔗 Bridge Profile: ${config.bridgeProfile} (Stripe Account #2)`)
  console.log(` 🌐 Gateway Target: ${config.pgxGatewayUrl}`)
  console.log(` 🛡️  Health check: http://localhost:${config.port}/health`)
  console.log(`=======================================================`)
})
