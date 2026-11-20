import type { Request, Response } from 'express'
import { config } from './config.js'
import { bridgeService } from './bridge.service.js'
import { getStripeClient } from './stripe.js'

export async function initiateHandler(req: Request, res: Response): Promise<void> {
  const secretHeader =
    (req.headers['x-gateway-bridge-secret'] as string) ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '')

  if (!secretHeader || secretHeader.trim() !== config.gatewayBridgeSecret.trim()) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing gateway bridge secret' })
    return
  }

  const { merchantRefId, amount } = req.body
  if (!merchantRefId || typeof amount !== 'number') {
    res.status(400).json({ error: 'Missing required parameters: merchantRefId and amount (number)' })
    return
  }

  try {
    const result = await bridgeService.initiateCheckout(req.body)
    res.status(200).json(result)
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to initiate checkout session' })
  }
}

export function payRelayHandler(req: Request, res: Response): void {
  const encodedUrl = req.query.s as string
  let targetStripeUrl = config.storefrontUrl

  if (encodedUrl) {
    try {
      const decoded = Buffer.from(encodedUrl, 'base64url').toString('utf-8')
      if (decoded.startsWith('https://checkout.stripe.com/')) {
        targetStripeUrl = decoded
      }
    } catch {
      // Fallback
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Referrer-Policy', 'no-referrer')

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>PGX Leads — Secure Checkout</title>
  <style>
    body {
      background-color: #060b20;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3.5px solid rgba(255,255,255,0.12);
      border-top-color: #f59e0b;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 24px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .brand span { color: #f59e0b; }
    p { font-size: 13px; color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="brand">PGX <span>LEADS</span></div>
  <p>Connecting to 256-bit encrypted checkout...</p>
  <script>
    var target = ${JSON.stringify(targetStripeUrl)};
    if (window.top !== window.self) {
      window.top.location.replace(target);
    } else {
      window.location.replace(target);
    }
  </script>
</body>
</html>`)
}

export function returnHandler(req: Request, res: Response): void {
  const encodedRedir = req.query.redir as string
  let targetUrl = config.storefrontUrl

  if (encodedRedir) {
    try {
      const decoded = Buffer.from(encodedRedir, 'base64url').toString('utf-8')
      if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
        targetUrl = decoded
      }
    } catch {
      // Fallback
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Referrer-Policy', 'no-referrer')

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>PGX Leads — Returning to Merchant</title>
  <style>
    body {
      background-color: #060b20;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3.5px solid rgba(255,255,255,0.12);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 24px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    .brand span { color: #10b981; }
    p { font-size: 13px; color: #94a3b8; margin: 0; }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <div class="brand">PAYMENT <span>VERIFIED</span></div>
  <p>Returning you securely to the merchant...</p>
  <script>
    var target = ${JSON.stringify(targetUrl)};
    if (window.top !== window.self) {
      window.top.location.replace(target);
    } else {
      window.location.replace(target);
    }
  </script>
</body>
</html>`)
}

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const stripe = getStripeClient()
  const sig = req.headers['stripe-signature'] as string

  let event: any = req.body

  if (config.stripeWebhookSecret && sig) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripeWebhookSecret)
    } catch (err: any) {
      console.error(`[PGX Leads Webhook] Signature verification failed: ${err.message}`)
      res.status(400).send(`Webhook Error: ${err.message}`)
      return
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const metadata = session.metadata || {}

    const merchantRefId = metadata.cid
    const partnerCode = metadata.rid || 'PX'
    const rawOrderId = metadata.oid || ''
    const sku = metadata.sku || ''

    if (merchantRefId) {
      const grossAmount = (session.amount_total || 0) / 100
      const currency = (session.currency || 'USD').toUpperCase()

      const resellerId = partnerCode === 'AR' ? 'ARXO' : 'admin_root'

      await bridgeService.forwardSettlementToGateway({
        stripeSessionId: session.id,
        stripeEventId: event.id || session.id,
        merchantRefId,
        resellerId,
        orderId: rawOrderId,
        bridgeProfile: 'leads',
        grossAmount,
        currency,
        customerEmail: session.customer_details?.email || session.customer_email,
        customerName: session.customer_details?.name,
        cloakedProductName: `B2B Intelligence Package (${sku})`,
        realProductName: rawOrderId ? `Order #${rawOrderId.replace(/^ORD-/, '')}` : 'B2B Leads',
        metadata: {
          ...metadata,
          source_bridge: 'pgxleads.shop',
        },
      })
    }
  }

  res.status(200).json({ received: true })
}
