import dotenv from 'dotenv'

dotenv.config()

const nodeEnv = process.env.NODE_ENV || 'development'
const isProd = nodeEnv === 'production'
const gatewayBridgeSecret = (
  process.env.GATEWAY_BRIDGE_SECRET || (isProd ? '' : 'pgx-leads-dev-bridge-secret')
).trim()

export const config = {
  env: nodeEnv,
  isProd,
  port: parseInt(process.env.PORT || '4002', 10),
  bridgeProfile: 'leads' as const,
  brandName: 'PGX Leads',
  storefrontUrl: (process.env.STOREFRONT_URL || 'https://pgxleads.shop').replace(/\/+$/, ''),
  bridgeBaseUrl: (process.env.BRIDGE_BASE_URL || 'https://pgxleads.shop').replace(/\/+$/, ''),
  stripeSecretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
  stripeTestSecretKey: (process.env.STRIPE_TEST_SECRET_KEY || '').trim(),
  stripeLiveSecretKey: (process.env.STRIPE_LIVE_SECRET_KEY || '').trim(),
  stripeWebhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  stripeTestWebhookSecret: (process.env.STRIPE_TEST_WEBHOOK_SECRET || '').trim(),
  stripeLiveWebhookSecret: (process.env.STRIPE_LIVE_WEBHOOK_SECRET || '').trim(),
  stripePaymentMethodConfiguration: (process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION || '').trim(),
  adaptivePricingEnabled: String(process.env.STRIPE_ADAPTIVE_PRICING_ENABLED || '').trim().toLowerCase() !== 'false',
  gatewayBridgeSecret,
  redirectSecret: (process.env.BRIDGE_REDIRECT_SECRET || gatewayBridgeSecret).trim(),
  pgxGatewayUrl: (process.env.PGX_GATEWAY_URL || 'http://localhost:5000').replace(/\/+$/, ''),
}

export function getConfiguredWebhookSecrets(): string[] {
  return Array.from(
    new Set(
      [config.stripeLiveWebhookSecret, config.stripeTestWebhookSecret, config.stripeWebhookSecret].filter(Boolean)
    )
  )
}
