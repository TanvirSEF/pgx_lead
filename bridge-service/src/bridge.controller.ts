import type { Request, Response } from 'express'
import { config, getConfiguredWebhookSecrets } from './config.js'
import { bridgeService } from './bridge.service.js'
import { openRedirectUrl } from './cloaking.js'
import { getStripeClient } from './stripe.js'

export async function initiateHandler(req: Request, res: Response): Promise<void> {
  const configuredSecret = config.gatewayBridgeSecret.trim()
  if (!configuredSecret) {
    res.status(401).json({ error: 'Unauthorized: Gateway bridge secret is not configured on this server.' })
    return
  }

  const secretHeader =
    (req.headers['x-gateway-bridge-secret'] as string) ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '')

  if (!secretHeader || secretHeader.trim() !== configuredSecret) {
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

export async function sessionStatusHandler(req: Request, res: Response): Promise<void> {
  const configuredSecret = config.gatewayBridgeSecret.trim()
  const secretHeader =
    (req.headers['x-gateway-bridge-secret'] as string) ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : '')

  if (!configuredSecret || !secretHeader || secretHeader.trim() !== configuredSecret) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing gateway bridge secret' })
    return
  }

  const sessionId = String(req.params.sessionId || '').trim()
  if (!sessionId) {
    res.status(400).json({ error: 'Session ID is required' })
    return
  }

  try {
    const status = await bridgeService.getSessionStatus(sessionId)
    res.status(200).json(status)
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to retrieve Stripe session status' })
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
  const sealedRedir = req.query.redir as string
  const sessionId = (req.query.session_id as string) || ''
  const targetUrl = (() => {
    const decrypted = openRedirectUrl(sealedRedir, config.redirectSecret)
    if (!decrypted) {
      return config.storefrontUrl
    }
    if (sessionId && decrypted.includes('{CHECKOUT_SESSION_ID}')) {
      return decrypted.replace('{CHECKOUT_SESSION_ID}', encodeURIComponent(sessionId))
    }
    if (sessionId && !decrypted.includes('session_id=')) {
      const separator = decrypted.includes('?') ? '&' : '?'
      return `${decrypted}${separator}session_id=${encodeURIComponent(sessionId)}`
    }
    return decrypted
  })()

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
  const sig = req.headers['stripe-signature'] as string | undefined
  const webhookSecrets = getConfiguredWebhookSecrets()

  let event: any = null
  let lastError: Error | null = null

  if (sig && webhookSecrets.length > 0) {
    for (const secret of webhookSecrets) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret)
        if (event) break
      } catch (err: any) {
        lastError = err
      }
    }
  }

  if (!event) {
    if (!config.isProd && webhookSecrets.length === 0 && !Buffer.isBuffer(req.body) && req.body?.type) {
      console.warn('[PGX Leads Webhook] Non-production mode with no webhook secret configured; accepting parsed JSON body.')
      event = req.body
    } else {
      const msg = lastError?.message || (webhookSecrets.length === 0 ? 'Stripe webhook secret not configured' : 'Missing or invalid stripe-signature')
      console.error(`[PGX Leads Webhook] Signature verification failed: ${msg}`)
      res.status(400).send(`Webhook Error: ${msg}`)
      return
    }
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object

    // Delayed payment methods (e.g. SEPA, ACH) emit checkout.session.completed with payment_status='unpaid'
    if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      console.log(`[PGX Leads Webhook] Session ${session.id} has payment_status=${session.payment_status}; awaiting async settlement.`)
      res.status(200).json({ received: true, pendingAsync: true })
      return
    }

    const metadata = session.metadata || {}

    const merchantRefId = metadata.cid
    const partnerCode = metadata.rid || 'PX'
    const rawOrderId = metadata.oid || ''
    const sku = metadata.sku || ''

    if (merchantRefId) {
      const grossAmount = (session.amount_total || 0) / 100
      const currency = (session.currency || 'USD').toUpperCase()

      const resellerId = partnerCode === 'AR' ? 'ARXO' : 'admin_root'

      const forwarded = await bridgeService.forwardSettlementToGateway({
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

      if (!forwarded) {
        res.status(502).json({ error: 'Failed to forward settlement to PGX Gateway' })
        return
      }
    }
  } else if (
    event.type === 'checkout.session.async_payment_failed' ||
    event.type === 'checkout.session.expired'
  ) {
    const session = event.data.object
    const metadata = session.metadata || {}
    const merchantRefId = metadata.cid
    if (merchantRefId) {
      const partnerCode = metadata.rid || 'PX'
      const rawOrderId = metadata.oid || ''
      const sku = metadata.sku || ''
      const resellerId = partnerCode === 'AR' ? 'ARXO' : 'admin_root'
      const failureReason =
        event.type === 'checkout.session.expired'
          ? 'Checkout session expired without payment'
          : 'Async payment failed in Stripe'

      await bridgeService.forwardSettlementToGateway({
        status: 'failed',
        stripeSessionId: session.id,
        stripeEventId: event.id || session.id,
        merchantRefId,
        resellerId,
        orderId: rawOrderId,
        bridgeProfile: 'leads',
        grossAmount: (session.amount_total || 0) / 100,
        currency: (session.currency || 'USD').toUpperCase(),
        customerEmail: session.customer_details?.email || session.customer_email,
        customerName: session.customer_details?.name,
        cloakedProductName: `B2B Intelligence Package (${sku})`,
        realProductName: rawOrderId ? `Order #${rawOrderId.replace(/^ORD-/, '')}` : 'B2B Leads',
        failureReason,
        declineCode: event.type,
        metadata: {
          ...metadata,
          source_bridge: 'pgxleads.shop',
        },
      })
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object
    const metadata = paymentIntent.metadata || {}
    const merchantRefId = metadata.cid
    if (merchantRefId) {
      let resolvedSessionId: string | undefined
      try {
        const modeHint = paymentIntent.livemode ? 'live' : 'test'
        const sessions = await getStripeClient(modeHint).checkout.sessions.list({
          payment_intent: paymentIntent.id,
          limit: 1,
        })
        resolvedSessionId = sessions.data[0]?.id
      } catch (err: any) {
        console.warn(`[PGX Leads Webhook] Could not resolve session for failed PI ${paymentIntent.id}: ${err.message}`)
      }

      const partnerCode = metadata.rid || 'PX'
      const rawOrderId = metadata.oid || ''
      const sku = metadata.sku || ''
      const resellerId = partnerCode === 'AR' ? 'ARXO' : 'admin_root'
      const lastErr = paymentIntent.last_payment_error

      await bridgeService.forwardSettlementToGateway({
        status: 'failed',
        stripeSessionId: resolvedSessionId,
        stripePaymentIntentId: paymentIntent.id,
        stripeEventId: event.id || paymentIntent.id,
        merchantRefId,
        resellerId,
        orderId: rawOrderId,
        bridgeProfile: 'leads',
        grossAmount: (paymentIntent.amount || 0) / 100,
        currency: (paymentIntent.currency || 'USD').toUpperCase(),
        customerEmail: paymentIntent.receipt_email || undefined,
        cloakedProductName: `B2B Intelligence Package (${sku})`,
        realProductName: rawOrderId ? `Order #${rawOrderId.replace(/^ORD-/, '')}` : 'B2B Leads',
        failureReason: lastErr?.message || 'Card payment declined or blocked by Stripe',
        declineCode: lastErr?.decline_code || lastErr?.code || 'payment_failed',
        metadata: {
          ...metadata,
          source_bridge: 'pgxleads.shop',
        },
      })
    }
  }

  res.status(200).json({ received: true })
}
