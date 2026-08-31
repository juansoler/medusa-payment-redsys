# @jsm406/medusa-plugin-redsys

Redsys / Sermepa TPV Virtual payment provider plugin for [MedusaJS v2](https://medusajs.com/).

This plugin enables payment processing through Redsys' hosted payment page (TPV Virtual) via redirect flow. Customers are redirected to the Redsys secure payment page to complete their transaction.

> **Production-proven**: This plugin is derived from a live production Medusa store processing real Redsys payments.

## Features

- Redsys hosted payment page / TPV Virtual redirect flow
- **Bizum mobile payment support** via Redsys TPV
- Sandbox and production environments
- One-step payment (immediate capture) and two-step payment (pre-authorization + capture)
- Full and partial refunds via Redsys API
- Payment cancellation
- Webhook handling with HMAC-SHA256 signature verification
- **Secure webhook correlation**: a payment is only authorized after a valid, fully matching webhook (order, session, amount, currency, provider, merchant, terminal and transaction type)
- Spanish error messages for Redsys response codes
- Zero PCI scope — card data is handled by Redsys' secure page

## Prerequisites

- MedusaJS v2.13.0 or later
- Node.js v20 or later
- A [Redsys merchant account](https://comercios.redsys.es/) (or sandbox test credentials)
- `redsys-easy` v5.3.0+ (installed automatically as a dependency)
- PostgreSQL (the plugin persists a `redsys_payment_reference` table)

## Installation

```bash
npm install @jsm406/medusa-plugin-redsys
# or
yarn add @jsm406/medusa-plugin-redsys
# or
pnpm add @jsm406/medusa-plugin-redsys
```

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
REDSYS_SECRET_KEY=sq7Hj....
REDSYS_MERCHANT_CODE=999008881
REDSYS_TERMINAL=001
REDSYS_ENVIRONMENT=sandbox
REDSYS_NOTIFICATION_URL=https://your-api.com/hooks/payment/redsys_redsys
REDSYS_SUCCESS_URL=https://your-store.com/checkout/redsys-callback
REDSYS_ERROR_URL=https://your-store.com/checkout/redsys-callback?error=1
```

For sandbox testing, use the following test credentials from Redsys:

```
Merchant Code: 999008881
Terminal: 001
Secret Key: sq7Hj.......
Environment: sandbox
```

### Medusa Configuration

In your `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/config"

export default defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/payment",
      options: {
        providers: [
          {
            resolve: "@jsm406/medusa-plugin-redsys/providers/redsys",
            id: "redsys",
            options: {
              secretKey: process.env.REDSYS_SECRET_KEY,
              merchantCode: process.env.REDSYS_MERCHANT_CODE,
              terminal: process.env.REDSYS_TERMINAL || "001",
              environment:
                process.env.REDSYS_ENVIRONMENT || "sandbox",
              notificationUrl:
                process.env.REDSYS_NOTIFICATION_URL,
              successUrl: process.env.REDSYS_SUCCESS_URL,
              errorUrl: process.env.REDSYS_ERROR_URL,
              transactionType: "0", // "0" = immediate capture, "1" = pre-authorization
            },
          },
          // Bizum provider (optional - uses same credentials)
          {
            resolve: "@jsm406/medusa-plugin-redsys/providers/redsys-bizum",
            id: "redsys-bizum",
            options: {
              secretKey: process.env.REDSYS_SECRET_KEY,
              merchantCode: process.env.REDSYS_MERCHANT_CODE,
              terminal: process.env.REDSYS_TERMINAL || "001",
              environment:
                process.env.REDSYS_ENVIRONMENT || "sandbox",
              notificationUrl:
                process.env.REDSYS_BIZUM_NOTIFICATION_URL || process.env.REDSYS_NOTIFICATION_URL,
              successUrl: process.env.REDSYS_SUCCESS_URL,
              errorUrl: process.env.REDSYS_ERROR_URL,
              transactionType: "0",
            },
          },
        ],
      },
    },
  ],
})
```

### Enable in Region

Enable the Redsys provider(s) in your Medusa admin panel under **Settings > Regions**:

- **Credit/Debit Card**: Select **Redsys** as a payment provider
  - Provider ID: `pp_redsys_redsys`
- **Bizum**: Select **Redsys Bizum** as a payment provider
  - Provider ID: `pp_redsys_redsys_bizum`

You can enable one or both providers depending on which payment methods you want to offer.

## Options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `secretKey` | string | Yes | — | Redsys HMAC-SHA256 secret key |
| `merchantCode` | string | Yes | — | Redsys merchant code (FUC) |
| `terminal` | string | No | `"001"` | Terminal number |
| `environment` | string | No | `"sandbox"` | `"sandbox"` or `"production"` |
| `notificationUrl` | string | No | — | Webhook URL for Redsys to POST transaction results |
| `successUrl` | string | No | — | URL to redirect after successful payment (URLOK) |
| `errorUrl` | string | No | — | URL to redirect after failed payment (URLKO) |
| `transactionType` | string | No | `"0"` | `"0"` = immediate capture, `"1"` = pre-authorization |

## Payment Flow

1. Customer selects **Redsys** as payment method → Medusa creates a Payment Session (`payses_...`)
2. `initiatePayment()` generates a secure Redsys `orderId`, records a **payment reference** (`orderId` ↔ payment session, amount, currency, merchant, terminal, transaction type) in the `redsys_payment_reference` table, and creates a signed redirect form
3. Customer clicks "Place Order" → the storefront saves `{ cartId, countryCode }` in `sessionStorage` and auto-submits the redirect form to Redsys TPV. **`cart.complete()` is NOT called here** — no order is created before the payment exists
4. Customer completes payment on the Redsys hosted payment page
5. Redsys sends a **webhook notification** to `{backendUrl}/hooks/payment/redsys_redsys`
6. `getWebhookActionAndData()` verifies the HMAC signature and validates the order, session, amount, currency, provider, merchant, terminal and transaction type against the stored reference, then marks it as confirmed
7. Medusa authorizes/captures the payment and **completes the cart server-side**, creating the order
8. Redsys redirects the customer's browser to `successUrl` or `errorUrl` with the Redsys order ID as a query parameter
9. Storefront callback page reads the saved `cartId`, retries `cart.complete()` if needed, and redirects to the order confirmation page

### Security: authorizePayment Behavior

A payment session is only authorized after a **valid HMAC-confirmed webhook** that fully matches the stored payment reference. `authorizePayment` returns `PENDING` for any session whose reference is missing, not confirmed, or mismatched (amount, currency, session, provider, merchant or transaction type). It never trusts the stored `status` field, so a `"pending"` — or even a forged `"authorized"` — status can never authorize a payment on its own.

### ID Mapping (Redsys → Medusa)

The plugin generates a 12-character alphanumeric `orderId` (e.g. `97727XYIWRRF`) used as Redsys' merchant order reference. When the cart is completed after payment, Medusa generates its own order ID (e.g. `order_01KR3B4X...`). These are **different IDs**.

The callback URL from Redsys only contains the Redsys order ID, not the Medusa order ID. To bridge this gap, the storefront stores the mapping `redsys_cart_{redsysOrderId}` → `{ cartId, countryCode }` in `sessionStorage` before redirecting to the TPV. The callback page uses the `cartId` to retrieve/complete the order and redirect to the correct confirmation page.

## Storefront Integration

Redsys is a **redirect-based** payment method (no card input in your storefront — the customer enters card data on Redsys' secure TPV). You must adapt your Medusa Next.js storefront with the changes below.

> **Security**: starting with v1.1.1 the storefront must **not** call `cart.complete()` before redirecting to Redsys. Doing so would fail anyway (the payment is not authorized yet) and previously created unpaid orders. The Redsys webhook completes the cart after the payment is confirmed.

### 1. `src/lib/constants.tsx` — Register the payment methods

Add Redsys and Bizum to the payment info map and add helper functions:

```tsx
// Inside paymentInfoMap, add:
pp_redsys_redsys: {
  title: "Credit / Debit Card",
  icon: <CreditCard />,
},
pp_redsys_redsys_bizum: {
  title: "Bizum",
  icon: <Smartphone />,
},

// Add helper functions:
export const isRedsys = (providerId?: string) => {
  return providerId?.startsWith("pp_redsys_redsys") && !providerId?.includes("bizum")
}

export const isRedsysBizum = (providerId?: string) => {
  return providerId?.startsWith("pp_redsys_redsys_bizum")
}
```

### 2. Payment buttons and callback page

The full copyable implementation lives in [`examples/storefront-redsys.md`](./examples/storefront-redsys.md). The two critical changes vs. older versions:

- The payment buttons **no longer call `cart.complete()`** before redirecting to Redsys. They only store `{ cartId, countryCode }` in `sessionStorage` under `redsys_cart_{orderId}` and submit the redirect form. The HMAC-confirmed webhook completes the cart server-side.
- The callback page reads `orderId` from the URL, recovers the `cartId`, and retries `cart.complete()` with exponential backoff to bridge the race between the browser redirect and the webhook arrival.

### 3. `src/middleware.ts` — Bypass region redirect

If your storefront uses middleware to enforce region/country code prefixes in URLs (as the default Medusa Next.js storefront does), add a bypass so `/checkout/redsys-callback` is not redirected. Add this early in the `middleware` function:

```ts
// Redsys callback URL — bypass region redirect
if (request.nextUrl.pathname.startsWith("/checkout/redsys-callback")) {
  return NextResponse.next()
}
```

### 4. `medusa-config.ts` — CORS

Ensure your storefront domain is allowed in CORS:

```ts
projectConfig: {
  http: {
    storeCors: "http://localhost:8000,https://your-store.com",
  },
}
```

### Session Data Reference

The payment session `data` field returned by `initiatePayment`:

```ts
{
  orderId: "1234ABCD5678",        // Redsys merchant order (12 chars, ^\d{4}[A-Z0-9]{8}$)
  medusaSessionId: "payses_...",  // Real Medusa payment session ID — never the Redsys order
  cartId: "cart_...",             // Optional
  amount: "2550",                 // Smallest currency unit (cents)
  currency: "978",                // Redsys numeric currency code
  status: "pending",
  transactionType: "0",
  merchantParams: "base64...",          // Base64-encoded merchant parameters
  signature: "hmac...",                 // HMAC-SHA256 signature
  signatureVersion: "HMAC_SHA256_V1",   // Version identifier returned by redsys-easy
  formUrl: "https://sis-t.redsys.es:25443/sis/realizarPago"
}
```

> **Note**: The `signatureVersion: "HMAC_SHA256_V1"` identifier in the callback URL is the value returned by the `redsys-easy` library and is normal. This does not indicate a problem — the actual signature computation follows the Redsys v4.1 specification.

### Webhook

Medusa automatically exposes webhook endpoints for the Redsys providers at:

```
/hooks/payment/redsys_redsys        (Card payments)
/hooks/payment/redsys_redsys_bizum  (Bizum payments)
```

For local development with sandbox, you must expose your backend to the internet (e.g., via [ngrok](https://ngrok.com/)) so Redsys can reach the webhook. Set `notificationUrl` to the ngrok URL.

**Important**: Redsys sends the notification to `notificationUrl` but the signature verification and payment status update happens through the Medusa webhook handler — make sure `notificationUrl` points to the same endpoint or forward notifications accordingly.

## Persistence: `redsys_payment_reference`

The plugin creates and manages a small table to guarantee that only payments it initiated can ever be confirmed:

| Column | Purpose |
|---|---|
| `order_id` | Redsys order ID (primary key) |
| `payment_session_id` | Real Medusa payment session (`payses_...`) |
| `provider` | `redsys` or `redsys-bizum` |
| `cart_id` | Medusa cart, if available |
| `amount`, `currency_code`, `currency_num` | Expected amount/currency |
| `merchant_code`, `terminal`, `transaction_type` | Expected merchant/terminal/type |
| `confirmed_at`, `ds_response`, `auth_code` | Set by the validated webhook |

The table is created lazily with `CREATE TABLE IF NOT EXISTS` on first use, so no manual migration is required. A webhook can only confirm a payment that the plugin itself recorded in `initiatePayment`/`updatePayment`, and only if every field matches.

## Test Cards (Sandbox)

### Card Payments

| Card Number | Brand | Behavior |
|---|---|---|
| 4548810000000003 | VISA | 3DS v2 approved |
| 5576441563045037 | Mastercard | 3DS v2 approved |
| 4548814479727229 | VISA | 3DS frictionless |
| 4548817212493017 | VISA | 3DS challenge |
| Any + CVV 999 | Any | Payment declined |

### Bizum (Sandbox)

**Important**: In sandbox, Bizum transactions cannot exceed **10€**. Use a discount coupon or low-price test product.

| Field | Value |
|---|---|
| Phone number | `700 000 000` |
| PIN | `1234` |
| SMS code | `123456` |

**Test scenarios by amount:**

| Amount | Result |
|---|---|
| < 5€ | Payment approved |
| 5€ - 10€ | Payment approved |
| 10€ - 15€ | Payment declined (exceeds sandbox limit) |
| > 15€ | Payment declined (no Bizum user) |

## Transaction Types

| Code | Type | Description |
|---|---|---|
| `"0"` | Payment | Authorization + immediate capture (default) |
| `"1"` | Pre-authorization | Reserve funds only |
| `"2"` | Confirmation | Capture pre-authorized funds |
| `"3"` | Refund | Full or partial refund |
| `"9"` | Cancellation | Cancel/void a transaction |

## Security

- **Never log PAN, CVV, or the secret key.** The provider strips sensitive fields from log output.
- **Always validate signatures server-side.** `getWebhookActionAndData()` uses `redsys-easy`'s `processRestNotification()`, which verifies the HMAC signature before anything else.
- **The webhook is the only source of truth.** A payment is authorized only when a valid webhook confirms a payment the plugin previously recorded, and the amount, currency, provider, merchant, terminal and transaction type all match. Reusing an old `orderId` is impossible because each payment session gets its own reference.
- **Use HTTPS** for all communication with Redsys.
- **Do not trust client-side payment data.** The webhook with signature verification is the source of truth.
- **Amounts are normalized.** `Ds_Amount` is received in the smallest unit (e.g. `"2550"`) and converted back to the main unit (`25.5`) before being passed to Medusa.
- **Unsupported currencies fail closed.** An unknown currency throws instead of silently charging in EUR.
- The redirect flow keeps you out of PCI scope — card data is handled by Redsys' secure page.

### Upgrading from < 1.1.1

Sessions created before v1.1.1 do not carry a `medusaSessionId` and have no payment reference, so they will not be authorized (fail-closed). Customers in the middle of a checkout will need to refresh / recreate their payment session. This is intentional: it is safer to reject than to authorize an unverified payment.

## Currency Support

The plugin includes built-in numeric currency codes for all major currencies (see `src/types.ts` for the full list). Unsupported currencies are **rejected** with an error rather than silently falling back to EUR.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode (for local plugin development)
npm run dev
```

### Local Testing with a Medusa Project

```bash
# From your plugin directory
npm run dev

# In your Medusa project directory:
npx medusa plugin:add ../path-to/@jsm406/medusa-plugin-redsys
```

## License

MIT — see [LICENSE](./LICENSE) file for details.

## Version History

### v1.1.1 (2026-08-31) — Security release

- **SECURITY**: Never authorize a `pending` Redsys payment before an HMAC-confirmed webhook
- **SECURITY**: Correlate webhooks with the real Medusa payment session ID (`payses_...`) instead of an artificial `redsys_*` ID
- **SECURITY**: Validate order, amount, currency, provider, merchant, terminal and transaction type before confirming a webhook
- **SECURITY**: Persist a payment reference (`redsys_payment_reference`) for every initiated payment, preventing reuse of previously confirmed `orderId`s
- **SECURITY**: Generate Redsys order IDs using cryptographic randomness instead of `Math.random()`
- **SECURITY**: Reject unsupported currencies instead of silently falling back to EUR
- **FIX**: Normalize webhook amounts (`Ds_Amount` in cents → main unit) before passing them to Medusa
- **FIX**: Return `AUTHORIZED` for preauthorizations and `SUCCESSFUL` for immediate captures in webhook actions
- **FIX**: Tighten Redsys response-code validation (4-digit payment codes 0000-0099, confirmation/refund 900, cancellation 400)
- **FIX**: Make `updatePayment()` generate a fresh `orderId` and keep MerchantData at fixed 3-position layout
- **FIX**: Storefront flow no longer creates the order before the payment (see `examples/storefront-redsys.md`)

### v1.1.0 (2026-06-16)
- **Added**: Bizum payment method support via Redsys TPV
- New `redsys-bizum` provider with `DS_MERCHANT_PAYMETHODS: "z"` parameter
- Full lifecycle support: initiate, authorize, capture, cancel, refund, webhook
- Same configuration as card provider (can share credentials)
- Separate webhook endpoint at `/hooks/payment/redsys_redsys_bizum`

### v1.0.12 (2026-05-13)
- **Fixed**: Response code validation for payment authorization (codes 0-99), refunds/confirmations (code 900), cancellations (code 400)
- **Note**: The `signatureVersion: "HMAC_SHA256_V1"` in the callback URL is normal - it's the identifier returned by the redsys-es library. The actual HMAC computation follows Redsys v4.1 specification.

### v1.0.0 (2025-05-05)
- Initial release

## Support

For issues and questions, please open an issue on [GitHub](https://github.com/juansoler/medusa-plugin-redsys/issues).
