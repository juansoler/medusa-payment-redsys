# medusa-payment-redsys

Redsys / Sermepa TPV Virtual payment provider plugin for [MedusaJS v2](https://medusajs.com/).

This plugin enables payment processing through Redsys' hosted payment page (TPV Virtual) via redirect flow. Customers are redirected to the Redsys secure payment page to complete their transaction.

> **Production-proven**: This plugin is derived from a live production Medusa store processing real Redsys payments.

## Features

- Redsys hosted payment page / TPV Virtual redirect flow
- Sandbox and production environments
- One-step payment (immediate capture) and two-step payment (pre-authorization + capture)
- Full and partial refunds via Redsys API
- Payment cancellation
- Webhook handling with HMAC-SHA256 signature verification
- Spanish error messages for Redsys response codes
- Zero PCI scope — card data is handled by Redsys' secure page

## Prerequisites

- MedusaJS v2.13.0 or later
- Node.js v20 or later
- A [Redsys merchant account](https://comercios.redsys.es/) (or sandbox test credentials)
- `redsys-easy` v5.3.0+ (installed automatically as a dependency)

## Installation

```bash
npm install medusa-payment-redsys
# or
yarn add medusa-payment-redsys
# or
pnpm add medusa-payment-redsys
```

## Configuration

### Environment Variables

Add the following to your `.env` file:

```env
REDSYS_SECRET_KEY=sq7HjrUOBfKmC576ILgskD5srU870gJ7
REDSYS_MERCHANT_CODE=352468805
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
Secret Key: sq7HjrUOBfKmC576ILgskD5srU870gJ7
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
            resolve: "medusa-payment-redsys/providers/redsys",
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
        ],
      },
    },
  ],
})
```

### Enable in Region

Enable the Redsys provider in your Medusa admin panel under **Settings > Regions** and select **Redsys** as a payment provider.

The provider ID will be:

```
pp_redsys_redsys
```

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

1. Customer selects **Redsys** as payment method
2. `initiatePayment()` creates a signed redirect form with Redsys merchant parameters
3. Storefront renders the auto-submitting form → customer is redirected to Redsys' secure TPV
4. Customer completes payment on the Redsys hosted payment page
5. Redsys sends a **webhook notification** to `{backendUrl}/hooks/payment/redsys_redsys`
6. `getWebhookActionAndData()` validates the HMAC-SHA256 signature and updates the payment status
7. Redsys redirects the customer's browser to `successUrl` or `errorUrl`

### Storefront Integration

The payment session data returned by `initiatePayment` contains the fields needed to build the redirect form:

```ts
// Session data returned by the provider:
{
  orderId: "1234ABCD5678",
  amount: "2550",           // Amount in smallest currency unit (cents)
  currency: "978",           // Numeric currency code (978 = EUR)
  status: "pending",
  merchantParams: "base64...",  // Base64-encoded DS_MERCHANT parameters
  signature: "hmac...",         // HMAC-SHA256 signature
  signatureVersion: "HMAC_SHA256_V1",
  formUrl: "https://sis-t.redsys.es:25443/sis/realizarPago"
}
```

Render the redirect form on your storefront:

```html
<form
  id="redsys-form"
  action="https://sis-t.redsys.es:25443/sis/realizarPago"
  method="POST"
>
  <input type="hidden" name="Ds_SignatureVersion" value="HMAC_SHA256_V1" />
  <input type="hidden" name="Ds_MerchantParameters" value="..." />
  <input type="hidden" name="Ds_Signature" value="..." />
</form>
<script>
  document.getElementById("redsys-form").submit()
</script>
```

### Webhook

Medusa automatically exposes a webhook endpoint for the Redsys provider at:

```
/hooks/payment/redsys_redsys
```

For local development with sandbox, you must expose your backend to the internet (e.g., via [ngrok](https://ngrok.com/)) so Redsys can reach the webhook. Set `notificationUrl` to the ngrok URL.

**Important**: Redsys sends the notification to `notificationUrl` but the signature verification and payment status update happens through the Medusa webhook handler — make sure `notificationUrl` points to the same endpoint or forward notifications accordingly.

## Test Cards (Sandbox)

| Card Number | Brand | Behavior |
|---|---|---|
| 4548810000000003 | VISA | 3DS v2 approved |
| 5576441563045037 | Mastercard | 3DS v2 approved |
| 4548814479727229 | VISA | 3DS frictionless |
| 4548817212493017 | VISA | 3DS challenge |
| Any + CVV 999 | Any | Payment declined |

## Transaction Types

| Code | Type | Description |
|---|---|---|
| `"0"` | Payment | Authorization + immediate capture (default) |
| `"1"` | Pre-authorization | Reserve funds only |
| `"2"` | Confirmation | Capture pre-authorized funds |
| `"3"` | Refund | Full or partial refund |
| `"9"` | Cancellation | Cancel/void a transaction |

## Security

- **Never log PAN, CVV, or the secret key**. The provider strips sensitive fields from log output.
- **Always validate signatures server-side**. `getWebhookActionAndData()` uses `redsys-easy`'s `processRestNotification()` for HMAC-SHA256 verification.
- **Use HTTPS** for all communication with Redsys.
- **Do not trust client-side payment data**. The webhook with signature verification is the source of truth.
- The redirect flow keeps you out of PCI scope — card data is handled by Redsys' secure page.

## Currency Support

The plugin includes built-in numeric currency codes for all major currencies. If your currency is not listed, it defaults to EUR (`978`). See `src/types.ts` for the full list.

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
npx medusa plugin:add ../path-to/medusa-payment-redsys
```

## License

MIT — see [LICENSE](./LICENSE) file for details.

## Support

For issues and questions, please open an issue on [GitHub](https://github.com/juansoler/medusa-payment-redsys/issues).
