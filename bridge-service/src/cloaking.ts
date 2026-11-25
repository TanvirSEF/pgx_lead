import * as crypto from 'node:crypto'

export interface CloakedProduct {
  name: string
  description: string
  sku: string
}

export const B2B_LEADS_TIERS: Array<{ min: number; max: number; name: string; sku: string; description: string }> = [
  {
    min: 0,
    max: 50,
    name: 'Verified B2B Prospecting Starter Kit',
    sku: 'LEAD-SOP-01',
    description: 'Curated business email verification templates, outreach sequences, and single-user commercial license.',
  },
  {
    min: 50,
    max: 150,
    name: 'Targeted Industry Leads Directory - Growth Edition',
    sku: 'LEAD-MKT-02',
    description: 'Verified SMB contact directory with validated company domains, executive roles, and marketing dataset.',
  },
  {
    min: 150,
    max: 500,
    name: 'Executive Decision-Maker Intelligence Pack',
    sku: 'LEAD-INTEL-03',
    description: 'C-level verified directory, LinkedIn matched corporate profiles, and quarterly refreshed contact updates.',
  },
  {
    min: 500,
    max: 2000,
    name: 'Enterprise B2B Pipeline & Contact Intelligence Database',
    sku: 'LEAD-ENT-04',
    description: 'Multi-seat access to enterprise prospecting registry, tech-stack filter filters, and direct dial records.',
  },
  {
    min: 2000,
    max: Infinity,
    name: 'Global Corporate Account Matrix & Direct Dial Intelligence Suite',
    sku: 'LEAD-CORP-05',
    description: 'Worldwide enterprise database, verified direct phone lines, technographic enrichment, and annual corporate license.',
  },
]

/**
 * Standardize order number to clean, uniform 4-digit format (e.g. 'Order #2831' and 'ORD-2831')
 * Prevents long 16-digit timestamps/snowflake IDs from leaking to Stripe.
 */
export function sanitizeOrderNumber(rawOrderId?: string): { cleanOrderNum: string; displayProductName: string; oid: string } {
  const raw = String(rawOrderId || '').trim()
  const digitsOnly = raw.replace(/\D/g, '')

  let cleanOrderNum = ''
  if (digitsOnly.length >= 4) {
    cleanOrderNum = digitsOnly.slice(-4)
  } else if (digitsOnly.length > 0) {
    cleanOrderNum = digitsOnly.padStart(4, '0')
  } else {
    cleanOrderNum = Date.now().toString().slice(-4)
  }

  return {
    cleanOrderNum,
    displayProductName: `Order #${cleanOrderNum}`,
    oid: `ORD-${cleanOrderNum}`,
  }
}

/**
 * Resolves a B2B Leads cloaked product based on transaction amount.
 */
export function resolveCloakedLeadProduct(amount: number): CloakedProduct {
  const matched =
    B2B_LEADS_TIERS.find((t) => amount >= t.min && amount < t.max) ||
    B2B_LEADS_TIERS[B2B_LEADS_TIERS.length - 1]

  return {
    name: matched.name,
    sku: matched.sku,
    description: matched.description,
  }
}

/**
 * Disguises metadata into innocuous short codes (cid, rid, oid, sku, cart_id)
 * Completely eliminates keywords: 'merchant_ref_id', 'reseller_id', 'pgx_gateway', etc.
 */
export function generateCloakedMetadata(params: {
  merchantRefId: string
  resellerId?: string
  oid: string
  sku: string
}): Record<string, string> {
  const rawReseller = String(params.resellerId || 'admin_root').toUpperCase()
  const partnerCode = rawReseller.includes('ARXO')
    ? 'AR'
    : rawReseller === 'ADMIN_ROOT' || rawReseller === 'ROOT'
    ? 'PX'
    : rawReseller.slice(0, 2)

  return {
    cid: params.merchantRefId,
    rid: partnerCode,
    oid: params.oid,
    sku: params.sku,
    cart_id: `CR-${Date.now().toString(36).toUpperCase()}`,
  }
}

const REDIRECT_ALG = 'aes-256-gcm'
const REDIRECT_IV_LEN = 12
const REDIRECT_TAG_LEN = 16

function isSafeHttpUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function deriveRedirectKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Seals a merchant return URL into an opaque, authenticated AES-256-GCM token
 * so Stripe cannot decode the merchant domain from success_url / cancel_url.
 */
export function sealRedirectUrl(targetUrl: string | undefined, secret: string): string {
  const trimmed = String(targetUrl || '').trim()
  if (!trimmed || !secret || !isSafeHttpUrl(trimmed)) {
    return ''
  }

  const iv = crypto.randomBytes(REDIRECT_IV_LEN)
  const cipher = crypto.createCipheriv(REDIRECT_ALG, deriveRedirectKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

/**
 * Verifies and decrypts an opaque redirect token produced by `sealRedirectUrl`.
 */
export function openRedirectUrl(token: string | undefined, secret: string): string | null {
  const trimmed = String(token || '').trim()
  if (!trimmed || !secret) {
    return null
  }

  try {
    const payload = Buffer.from(trimmed, 'base64url')
    if (payload.length <= REDIRECT_IV_LEN + REDIRECT_TAG_LEN) {
      return null
    }

    const iv = payload.subarray(0, REDIRECT_IV_LEN)
    const tag = payload.subarray(REDIRECT_IV_LEN, REDIRECT_IV_LEN + REDIRECT_TAG_LEN)
    const ciphertext = payload.subarray(REDIRECT_IV_LEN + REDIRECT_TAG_LEN)

    const decipher = crypto.createDecipheriv(REDIRECT_ALG, deriveRedirectKey(secret), iv)
    decipher.setAuthTag(tag)

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    return isSafeHttpUrl(decrypted) ? decrypted : null
  } catch {
    return null
  }
}
