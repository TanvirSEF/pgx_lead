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
  gatewayBridgeSecret: process.env.GATEWAY_BRIDGE_SECRET || 'pgx_bridge_leads_sec_prod_99',
  pgxGatewayUrl: (process.env.PGX_GATEWAY_URL || 'http://localhost:5000').replace(/\/+$/, ''),
}
