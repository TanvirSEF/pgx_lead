import { config } from './config.js'
import { getStripeClient } from './stripe.js'
import {
  sanitizeOrderNumber,
  resolveCloakedLeadProduct,
  generateCloakedMetadata,
  type CloakedProduct,
} from './cloaking.js'

export interface InitiateCheckoutInput {
  merchantRefId: string
  resellerId?: string
  amount: number
  currency?: string
  orderId?: string
  customerEmail?: string
  customerName?: string
  successUrl?: string
  cancelUrl?: string
  mode?: 'test' | 'live'
}

export interface InitiateCheckoutResult {
  success: boolean
  sessionId: string
  checkoutUrl: string
  directUrl?: string | null
  cloakedProduct: {
    name: string
    sku: string
  }
}

export interface GatewaySettlementPayload {
  stripeSessionId: string
  stripeEventId: string
  merchantRefId: string
  resellerId: string
  orderId: string
  bridgeProfile: 'leads'
  grossAmount: number
  currency: string
  customerEmail?: string
  customerName?: string
  cloakedProductName?: string
  realProductName?: string
  metadata?: Record<string, any>
}

export class BridgeService {
  /**
   * Initiates a cloaked Stripe Checkout Session on Stripe Account #2 (pgxleads.shop)
   */
  async initiateCheckout(input: InitiateCheckoutInput): Promise<InitiateCheckoutResult> {
    const stripe = getStripeClient()

    const unitAmountCents = Math.round(input.amount * 100)
    if (unitAmountCents < 50) {
      throw new Error('Transaction amount must be at least $0.50 USD equivalent.')
    }

    const currency = (input.currency || 'USD').toLowerCase()

    // 1. Sanitize order number to uniform 4 digits
    const { cleanOrderNum, displayProductName, oid } = sanitizeOrderNumber(input.orderId)

    // 2. Cloak against authentic B2B Lead catalog
    const cloakedItem: CloakedProduct = resolveCloakedLeadProduct(input.amount)

    // 3. Disguise metadata into innocuous short codes (cid, rid, oid, sku, cart_id)
    const cloakedMetadata = generateCloakedMetadata({
      merchantRefId: input.merchantRefId,
      resellerId: input.resellerId,
      oid,
      sku: cloakedItem.sku,
    })

    // 4. Cloak return URLs to this bridge service domain
    const encodedSuccess = input.successUrl ? Buffer.from(input.successUrl).toString('base64url') : ''
    const encodedCancel = input.cancelUrl ? Buffer.from(input.cancelUrl).toString('base64url') : ''

    const cloakedSuccessUrl = `${config.bridgeBaseUrl}/api/gateway-bridge/return?status=success&session_id={CHECKOUT_SESSION_ID}&redir=${encodedSuccess}`
    const cloakedCancelUrl = `${config.bridgeBaseUrl}/api/gateway-bridge/return?status=cancel&redir=${encodedCancel}`

    // 5. Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      payment_method_options: {
        card: {
          request_three_d_secure: 'any',
        },
      },
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: displayProductName,
              description: `Payment for ${displayProductName}`,
            },
            unit_amount: unitAmountCents,
          },
          quantity: 1,
        },
      ],
      metadata: cloakedMetadata,
      payment_intent_data: {
        description: displayProductName,
        metadata: cloakedMetadata,
      },
      customer_email: input.customerEmail || undefined,
      success_url: cloakedSuccessUrl,
      cancel_url: cloakedCancelUrl,
    })

    console.log(
      `[PGX Leads Bridge] Created session ${session.id} for client ${input.merchantRefId} ($${input.amount} ${currency.toUpperCase()}) [Item: ${cloakedItem.name} | SKU: ${cloakedItem.sku}]`
    )

    const encodedStripeUrl = session.url ? Buffer.from(session.url).toString('base64url') : ''
    const cloakedCheckoutUrl = `${config.bridgeBaseUrl}/api/gateway-bridge/pay?s=${encodedStripeUrl}`

    return {
      success: true,
      sessionId: session.id,
      checkoutUrl: cloakedCheckoutUrl,
      directUrl: session.url,
      cloakedProduct: {
        name: cloakedItem.name,
        sku: cloakedItem.sku,
      },
    }
  }

  /**
   * Forwards a verified Stripe payment settlement event from Account #2 to PGX Gateway
   */
  async forwardSettlementToGateway(payload: GatewaySettlementPayload): Promise<boolean> {
    const targetEndpoint = `${config.pgxGatewayUrl}/api/v1/webhooks/gateway-settle`

    try {
      console.log(`[PGX Leads Bridge] Forwarding settlement to PGX Gateway: ${targetEndpoint} for session ${payload.stripeSessionId}`)

      const res = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gateway-bridge-secret': config.gatewayBridgeSecret,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error(`[PGX Leads Bridge] PGX Gateway settlement failed with HTTP ${res.status}: ${errorText}`)
        return false
      }

      const resData = await res.json()
      console.log(`[PGX Leads Bridge] PGX Gateway credited transaction successfully:`, resData)
      return true
    } catch (err: any) {
      console.error(`[PGX Leads Bridge] Failed to dispatch settlement to PGX Gateway: ${err.message}`)
      return false
    }
  }
}

export const bridgeService = new BridgeService()
