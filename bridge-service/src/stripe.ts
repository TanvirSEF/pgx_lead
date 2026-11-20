import Stripe from 'stripe'
import { config } from './config.js'

let stripeInstance: Stripe | null = null

export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    if (!config.stripeSecretKey) {
      console.warn('[PGX Leads Bridge] Warning: STRIPE_SECRET_KEY is not set. Stripe calls will fail until configured.')
    }
    stripeInstance = new Stripe(config.stripeSecretKey || 'sk_test_placeholder', {
      apiVersion: '2025-01-27.acacia' as any,
    })
  }
  return stripeInstance
}
