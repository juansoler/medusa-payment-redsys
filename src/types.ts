/**
 * REDSYS Payment Plugin Types
 */

export interface RedsysOptions {
  /** REDSYS Secret Key (HMAC-SHA256) */
  secretKey: string
  /** REDSYS Merchant Code (FUC) */
  merchantCode: string
  /** REDSYS Terminal number @default "001" */
  terminal?: string
  /** Environment @default "sandbox" */
  environment?: "sandbox" | "production"
  /** Webhook notification URL for REDSYS to POST transaction results */
  notificationUrl?: string
  /** Success redirect URL (URLOK) after payment */
  successUrl?: string
  /** Error redirect URL (URLKO) after payment */
  errorUrl?: string
  /**
   * Transaction type for the payment flow
   * "0" = immediate capture (default)
   * "1" = pre-authorization
   */
  transactionType?: "0" | "1"
}

/**
 * REDSYS Transaction Types
 */
export const RedsysTransactionTypes = {
  PAYMENT: "0",
  PREAUTHORIZATION: "1",
  CONFIRMATION: "2",
  REFUND: "3",
  CANCELLATION: "9",
} as const

/**
 * REDSYS Currency Codes (ISO 4217 numeric)
 */
export const RedsysCurrencyCodes: Record<string, string> = {
  EUR: "978",
  USD: "840",
  GBP: "826",
  JPY: "392",
  MXN: "484",
  ARS: "032",
  CLP: "152",
  COP: "170",
  BRL: "986",
  CHF: "756",
  DKK: "208",
  NOK: "578",
  SEK: "752",
  PLN: "985",
  CZK: "203",
  HUF: "348",
  RON: "946",
  BGN: "975",
  HRK: "191",
  ISK: "352",
  TRY: "949",
  AUD: "036",
  CAD: "124",
  CNY: "156",
  INR: "356",
  KRW: "410",
  RUB: "643",
  ZAR: "710",
}

/**
 * REDSYS Response Codes
 */
export const RedsysResponseCodes = {
  AUTHORIZED: "0000",
  AUTHORIZED_BELOW_100: "00",
  REFUND_APPROVED: "0900",
  REFUND_APPROVED_BELOW_900: "900",
} as const

/**
 * Payment Session Data stored by the provider
 */
export interface RedsysPaymentSessionData {
  orderId: string
  amount: string
  currency: string
  status: "pending" | "authorized" | "refunded" | "cancelled" | "error"
  authCode?: string
  responseCode?: string
  transactionType: string
  /** Base64-encoded merchant parameters for the redirect form */
  merchantParams?: string
  /** HMAC-SHA256 signature for the redirect form */
  signature?: string
  /** Signature version (always "HMAC_SHA256_V1") */
  signatureVersion?: string
  /** Redsys form action URL */
  formUrl?: string
}

/**
 * Redirect form data returned to the storefront
 */
export interface RedsysRedirectForm {
  url: string
  body: {
    Ds_SignatureVersion: string
    Ds_MerchantParameters: string
    Ds_Signature: string
  }
}
