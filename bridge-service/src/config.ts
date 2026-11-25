import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: parseInt(process.env.PORT || '4002', 10),
  bridgeProfile: 'leads' as const,
  brandName: 'PGX Leads',
  storefrontUrl: (process.env.STOREFRONT_URL || 'https://pgxleads.shop').replace(/\/+$/, ''),
  bridgeBaseUrl: (process.env.BRIDGE_BASE_URL || 'https://pgxleads.shop').replace(/\/+$/, ''),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePaymentMethodConfiguration: (process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION || '').trim(),
  adaptivePricingEnabled: String(process.env.STRIPE_ADAPTIVE_PRICING_ENABLED || '').trim().toLowerCase() !== 'false',
  gatewayBridgeSecret: process.env.GATEWAY_BRIDGE_SECRET || 'pgx-leads-super-secret-gateway-bridge-key-2026',
  pgxGatewayUrl: (process.env.PGX_GATEWAY_URL || 'http://localhost:5000').replace(/\/+$/, ''),
}
