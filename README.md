# @jsm406/medusa-plugin-redsys

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
3. Customer clicks "Place Order" → storefront calls `cart.complete()` to create the order, stores a cookie mapping the Redsys internal order ID to the Medusa order ID, then auto-submits the redirect form to Redsys TPV
4. Customer completes payment on the Redsys hosted payment page
5. Redsys sends a **webhook notification** to `{backendUrl}/hooks/payment/redsys_redsys`
6. `getWebhookActionAndData()` validates the HMAC-SHA256 signature and updates the payment status
7. Redsys redirects the customer's browser to `successUrl` or `errorUrl` with the Redsys order ID as a query parameter
8. Storefront callback page reads the sessionStorage to resolve the Medusa order ID and redirects to the order confirmation page

### Important: authorizePayment Behavior

This plugin's `authorizePayment` returns `AUTHORIZED` for sessions with status `"pending"` **and** `"authorized"`. This is intentional for the redirect flow: the real authorization happens on Redsys TPV and is confirmed via webhook. Without this, `cart.complete()` would fail with a 400 error because Medusa requires the payment session to be authorized before completing the cart.

### ID Mapping (Redsys → Medusa)

The plugin generates a 12-character alphanumeric `orderId` (e.g. `97727XYIWRRF`) used as Redsys' merchant order reference. When the order is completed via `cart.complete()`, Medusa generates its own order ID (e.g. `order_01KR3B4X...`). These are **different IDs**.

The callback URL from Redsys only contains the Redsys order ID, not the Medusa order ID. To bridge this gap, the storefront stores the mapping `redsys_map_{redsysOrderId}` → `{ medusaOrderId, countryCode }` in `sessionStorage` before redirecting to the TPV. The callback page reads this value to redirect to the correct order confirmation page.

## Storefront Integration

Redsys is a **redirect-based** payment method (no card input in your storefront — the customer enters card data on Redsys' secure TPV). You must adapt your Medusa Next.js storefront with the changes below.

### 1. `src/lib/constants.tsx` — Register the payment method

Add Redsys to the payment info map and add a helper function:

```tsx
// Inside paymentInfoMap, add:
pp_redsys_redsys: {
  title: "Credit / Debit Card",
  icon: <CreditCard />,
},

// Add helper function:
export const isRedsys = (providerId?: string) => {
  return providerId?.startsWith("pp_redsys_")
}
```

### 2. `src/lib/data/cart.ts` — Add order completion without redirect

Add a `completeCartWithoutRedirect` function. The standard `placeOrder` does a `redirect()` (server-side), but Redsys needs to redirect the browser to the TPV instead. This function completes the cart, creates the order, but returns the result so the client can handle the TPV redirect:

```ts
export async function completeCartWithoutRedirect(cartId?: string) {
  const id = cartId || (await getCartId())

  if (!id) {
    throw new Error("No existing cart found when completing cart")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const cartRes = await sdk.store.cart
    .complete(id, {}, headers)
    .then(async (cartRes) => {
      const cartCacheTag = await getCacheTag("carts")
      revalidateTag(cartCacheTag)
      return cartRes
    })
    .catch(medusaError)

  if (cartRes?.type === "order") {
    const orderCacheTag = await getCacheTag("orders")
    revalidateTag(orderCacheTag)
    removeCartId()
  }

  return cartRes
}
```

### 3. `src/modules/checkout/components/payment-button/index.tsx` — Redsys payment button

Add a `RedsysPaymentButton` component that:
1. Reads the payment session data (formUrl, merchantParams, signature) from the cart
2. Calls `completeCartWithoutRedirect()` to create the order
3. Stores the Redsys → Medusa order ID mapping in `sessionStorage` (with country code), then builds and auto-submits a `<form>` to Redsys' TPV

```tsx
// Add import:
import { isManual, isRedsys, isStripeLike } from "@lib/constants"
import { completeCartWithoutRedirect, placeOrder } from "@lib/data/cart"

// Add case in PaymentButton's switch:
case isRedsys(paymentSession?.provider_id):
  return (
    <RedsysPaymentButton
      notReady={notReady}
      cart={cart}
      data-testid={dataTestId}
    />
  )

// Add the component:
const RedsysPaymentButton = ({
  cart,
  notReady,
  "data-testid": dataTestId,
}: {
  cart: HttpTypes.StoreCart
  notReady: boolean
  "data-testid"?: string
}) => {
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handlePayment = async () => {
    setSubmitting(true)

    const paymentSession = cart.payment_collection?.payment_sessions?.find(
      (s) => s.status === "pending" && isRedsys(s.provider_id)
    )

    const redsysData = paymentSession?.data as Record<string, string> | undefined

    if (!redsysData?.formUrl || !redsysData?.merchantParams || !redsysData?.signature) {
      setErrorMessage("No se pudieron obtener los datos de pago de Redsys")
      setSubmitting(false)
      return
    }

    const cartRes = await completeCartWithoutRedirect()
      .catch((err) => {
        setErrorMessage(err.message)
        setSubmitting(false)
        return null
      })

    if (!cartRes || cartRes.type !== "order") {
      setErrorMessage(cartRes ? "Error al crear el pedido" : "")
      setSubmitting(false)
      return
    }

    // Store Redsys ID → Medusa ID mapping + country code in sessionStorage.
    // The callback page reads this to redirect to the order confirmation.
    const medusaOrderId = cartRes.order.id
    const redsysOrderId = redsysData.orderId || ""
    const countryCode = cart.shipping_address?.country_code?.toLowerCase() || "dk"
    sessionStorage.setItem(
      `redsys_map_${redsysOrderId}`,
      JSON.stringify({ medusaOrderId, countryCode })
    )

    const form = document.createElement("form")
    form.method = "POST"
    form.action = redsysData.formUrl

    const fields: Record<string, string> = {
      Ds_SignatureVersion: redsysData.signatureVersion,
      Ds_MerchantParameters: redsysData.merchantParams,
      Ds_Signature: redsysData.signature,
    }

    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = name
      input.value = value
      form.appendChild(input)
    })

    document.body.appendChild(form)
    form.submit()
  }

  return (
    <>
      <Button
        disabled={notReady || submitting}
        isLoading={submitting}
        onClick={handlePayment}
        size="large"
        data-testid={dataTestId}
      >
        Place order
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="redsys-payment-error-message"
      />
    </>
  )
}
```

### 4. `src/app/checkout/redsys-callback/page.tsx` — Callback page (new file)

Create a **client component** page that Redsys redirects to after payment. It reads the `orderId` query param (Redsys internal ID), looks up the real Medusa order ID from `sessionStorage`, and redirects to the order confirmation page:

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

export default function RedsysCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [status, setStatus] = useState<"loading" | "error" | "success">("loading")

  const isError = searchParams?.get("error") === "1"
  const redsysOrderId = searchParams?.get("orderId")

  useEffect(() => {
    if (isError) {
      setStatus("error")
      return
    }

    if (!redsysOrderId) {
      setStatus("success")
      return
    }

    const stored = sessionStorage.getItem(`redsys_map_${redsysOrderId}`)

    if (stored) {
      let orderData: { medusaOrderId: string; countryCode: string }
      try {
        orderData = JSON.parse(stored)
      } catch {
        orderData = { medusaOrderId: stored, countryCode: "dk" }
      }
      sessionStorage.removeItem(`redsys_map_${redsysOrderId}`)
      router.replace(
        `/${orderData.countryCode}/order/${orderData.medusaOrderId}/confirmed`
      )
      return
    }

    setStatus("success")
  }, [isError, redsysOrderId, router])

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
        <p className="text-gray-600">Procesando pago...</p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
        <h1 className="text-2xl font-bold text-red-600">Pago no completado</h1>
        <p className="text-gray-600">
          La operación no se ha completado correctamente.
        </p>
        <a href="/" className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
          Volver a la tienda
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
      <h1 className="text-2xl font-bold text-green-600">Pago procesado</h1>
      <p className="text-gray-600">Tu pago ha sido procesado correctamente.</p>
      <a href="/" className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
        Volver a la tienda
      </a>
    </div>
  )
}
```

### 5. `src/middleware.ts` — Bypass region redirect

If your storefront uses middleware to enforce region/country code prefixes in URLs (as the default Medusa Next.js storefront does), add a bypass so `/checkout/redsys-callback` is not redirected. Add this early in the `middleware` function:

```ts
// Redsys callback URL — bypass region redirect
if (request.nextUrl.pathname.startsWith("/checkout/redsys-callback")) {
  return NextResponse.next()
}
```

### 6. `medusa-config.ts` — CORS

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
  orderId: "1234ABCD5678",
  amount: "2550",
  currency: "978",
  status: "pending",
  transactionType: "0",
  merchantParams: "base64...",          // Base64-encoded merchant parameters
  signature: "hmac...",                 // HMAC-SHA256 signature
  signatureVersion: "HMAC_SHA256_V1",
  formUrl: "https://sis-t.redsys.es:25443/sis/realizarPago"
}
```

These fields are used in step 3 to build the auto-submitting redirect form.

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
npx medusa plugin:add ../path-to/@jsm406/medusa-plugin-redsys
```

## License

MIT — see [LICENSE](./LICENSE) file for details.

## Support

For issues and questions, please open an issue on [GitHub](https://github.com/juansoler/medusa-plugin-redsys/issues).
