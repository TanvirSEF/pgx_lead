import Stripe from 'stripe'
import { config } from './config.js'

const stripeClients = new Map<string, Stripe>()

function resolveStripeKeyForMode(mode?: 'test' | 'live'): string {
  const defaultKey = config.stripeSecretKey
  const isDefaultTest = /^(sk|rk)_test_/.test(defaultKey)
  const isDefaultLive = /^(sk|rk)_live_/.test(defaultKey)

  if (mode === 'test') {
    if (config.stripeTestSecretKey) return config.stripeTestSecretKey
    if (defaultKey && !isDefaultLive) return defaultKey
    throw new Error('Test/sandbox mode requested on Bridge 2, but STRIPE_TEST_SECRET_KEY is not configured.')
  }

  if (mode === 'live') {
    if (config.stripeLiveSecretKey) return config.stripeLiveSecretKey
    if (defaultKey && !isDefaultTest) return defaultKey
    throw new Error('Live mode requested on Bridge 2, but STRIPE_LIVE_SECRET_KEY (or live STRIPE_SECRET_KEY) is not configured.')
  }

  return config.stripeLiveSecretKey || defaultKey || config.stripeTestSecretKey
}

export function getStripeClient(mode?: 'test' | 'live'): Stripe {
  const secretKey = resolveStripeKeyForMode(mode)
  if (!secretKey) {
    throw new Error('Stripe Secret Key is not configured for PGX Leads Bridge.')
  }

  let client = stripeClients.get(secretKey)
  if (!client) {
    client = new Stripe(secretKey, {
      apiVersion: '2025-01-27.acacia' as any,
    })
    stripeClients.set(secretKey, client)
  }
  return client
}
