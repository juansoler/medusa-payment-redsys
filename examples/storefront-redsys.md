# Storefront integration — secure Redsys redirect flow

> **Security note (v1.1.1)**: the plugin no longer authorizes a `pending` payment
> session. The ONLY thing that authorizes a payment is a webhook from Redsys with a
> valid HMAC signature that matches the stored payment reference. Therefore the
> storefront must **NOT** call `cart.complete()` before redirecting to Redsys —
> doing so creates an order before the payment exists. The webhook completes the
> cart server-side. The callback page below only needs to recover the `cartId` and
> (optionally) retry `cart.complete()` to bridge the tiny race between the
> browser redirect and the webhook arrival.

This example targets the default Medusa Next.js storefront.

## 1. `src/lib/constants.tsx` — register the payment methods

```tsx
// Inside paymentInfoMap, add:
pp_redsys_redsys: {
  title: "Credit / Debit Card",
  icon: <CreditCard />,
},
"pp_redsys-bizum_redsys-bizum": {
  title: "Bizum",
  icon: <Smartphone />,
},

// Add helper functions:
export const isRedsys = (providerId?: string) => {
  return providerId?.startsWith("pp_redsys_redsys") && !providerId?.includes("bizum")
}

export const isRedsysBizum = (providerId?: string) => {
  return providerId?.startsWith("pp_redsys-bizum")
}
```

## 2. `src/modules/checkout/components/payment-button/index.tsx` — payment buttons

Both buttons follow the same pattern:

1. Read the payment session data (`formUrl`, `merchantParams`, `signature`, `signatureVersion`, `orderId`).
2. Save `{ cartId, countryCode }` in `sessionStorage` under `redsys_cart_${orderId}`.
3. Auto-submit the POST form to Redsys.

```tsx
// Add imports:
import { isManual, isRedsys, isRedsysBizum, isStripeLike } from "@lib/constants"

// Add cases in PaymentButton's switch:
case isRedsysBizum(paymentSession?.provider_id):
  return (
    <RedsysBizumPaymentButton
      notReady={notReady}
      cart={cart}
      data-testid={dataTestId}
    />
  )

case isRedsys(paymentSession?.provider_id):
  return (
    <RedsysPaymentButton
      notReady={notReady}
      cart={cart}
      data-testid={dataTestId}
    />
  )

// Redsys Card Payment Button:
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

    // IMPORTANT: do NOT call cart.complete() here. The Redsys webhook is what
    // completes the cart after the payment is confirmed.
    const redsysOrderId = redsysData.orderId || ""
    sessionStorage.setItem(
      `redsys_cart_${redsysOrderId}`,
      JSON.stringify({
        cartId: cart.id,
        countryCode: cart.shipping_address?.country_code?.toLowerCase() || "dk",
      })
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

// Bizum Payment Button (identical flow, different provider check):
const RedsysBizumPaymentButton = ({
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
      (s) => s.status === "pending" && isRedsysBizum(s.provider_id)
    )

    const redsysData = paymentSession?.data as Record<string, string> | undefined

    if (!redsysData?.formUrl || !redsysData?.merchantParams || !redsysData?.signature) {
      setErrorMessage("No se pudieron obtener los datos de pago de Bizum")
      setSubmitting(false)
      return
    }

    const redsysOrderId = redsysData.orderId || ""
    sessionStorage.setItem(
      `redsys_cart_${redsysOrderId}`,
      JSON.stringify({
        cartId: cart.id,
        countryCode: cart.shipping_address?.country_code?.toLowerCase() || "dk",
      })
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
        Pagar con Bizum
      </Button>
      <ErrorMessage
        error={errorMessage}
        data-testid="redsys-bizum-payment-error-message"
      />
    </>
  )
}
```

## 3. `src/app/checkout/redsys-callback/page.tsx` — callback page (new file)

Redsys redirects the browser to `successUrl` (URLOK) with `orderId` as a query
parameter after the payment. By then the webhook has usually already completed the
cart, but there can be a small race between the browser redirect and the webhook
arrival. This page retries `cart.complete()` with exponential backoff; once the
order exists it redirects to the confirmation page.

```tsx
"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { completeCart } from "@lib/data/cart"

const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 800

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

    const stored = sessionStorage.getItem(`redsys_cart_${redsysOrderId}`)

    if (!stored) {
      setStatus("success")
      return
    }

    let storedData: { cartId: string; countryCode: string }
    try {
      storedData = JSON.parse(stored)
    } catch {
      storedData = { cartId: "", countryCode: "dk" }
    }

    if (!storedData.cartId) {
      setStatus("success")
      return
    }

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const tryComplete = async (attempt: number): Promise<string | null> => {
      try {
        const cartRes = await completeCart(storedData.cartId)

        if (cartRes?.type === "order") {
          sessionStorage.removeItem(`redsys_cart_${redsysOrderId}`)
          return cartRes.order.id
        }
      } catch {
        // payment not confirmed yet — retry
      }

      if (attempt >= MAX_ATTEMPTS) {
        return null
      }

      await sleep(BASE_DELAY_MS * attempt * attempt)
      return tryComplete(attempt + 1)
    }

    ;(async () => {
      const orderId = await tryComplete(1)

      if (orderId) {
        router.replace(`/${storedData.countryCode}/order/${orderId}/confirmed`)
        return
      }

      setStatus("success")
    })()
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

`completeCart` above is the store's existing helper (usually imported from
`@lib/data/cart`); it calls `sdk.store.cart.complete(id, {}, headers)`. Completing
an already-completed cart is idempotent in Medusa (it returns the existing order),
so the retry is safe.

## 4. `src/middleware.ts` — bypass region redirect

Add early in the `middleware` function:

```ts
// Redsys callback URL — bypass region redirect
if (request.nextUrl.pathname.startsWith("/checkout/redsys-callback")) {
  return NextResponse.next()
}
```

## 5. `medusa-config.ts` — CORS

Ensure your storefront domain is allowed in CORS:

```ts
projectConfig: {
  http: {
    storeCors: "http://localhost:8000,https://your-store.com",
  },
}
```

## How the secure flow works

```text
1. Customer selects Redsys → Medusa creates the payment session (payses_...)
2. initiatePayment() generates a secure Redsys orderId and stores a payment
   reference (orderId ↔ payses_..., amount, currency, merchant, terminal, type)
3. Storefront saves { cartId, countryCode } and redirects to Redsys TPV
4. Customer pays on the Redsys hosted page
5. Redsys sends an HMAC-signed webhook
6. getWebhookActionAndData() verifies the signature and validates orderId,
   session, amount, currency, provider, merchant, terminal and transaction type
   against the stored reference, then marks it as confirmed
7. Medusa authorizes/captures the payment and completes the cart server-side
8. Browser returns to /checkout/redsys-callback?orderId=... → the page retries
   cart.complete() if needed and redirects to the order confirmation page
```

No order is created before the payment is confirmed. If `cart.complete()` is
attempted before the webhook arrives it simply fails, and the retry logic above
(backed by the server-side webhook) completes the cart as soon as Redsys confirms
the payment.
