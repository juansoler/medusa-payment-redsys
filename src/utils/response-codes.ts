/**
 * Strict Redsys response-code validators.
 *
 * These replace `parseInt`-based checks which were too permissive (e.g. they
 * accepted `"0099abc"`, `"0.5"` or any leading-zero string). Each validator
 * enforces the exact digit length and the exact expected value.
 */

/**
 * A payment/preauthorization is authorized when Redsys returns a 4-digit code
 * between 0000 and 0099.
 */
export function isRedsysPaymentAuthorized(response: string): boolean {
  if (!/^\d{4}$/.test(response)) {
    return false
  }

  const code = Number(response)
  return code >= 0 && code <= 99
}

/**
 * A confirmation (capture of a preauthorization) or refund is approved when
 * Redsys returns code 900 (formatted as "0900" or "900").
 */
export function isRedsysConfirmationAuthorized(response: string): boolean {
  return /^\d{3,4}$/.test(response) && Number(response) === 900
}

/**
 * A cancellation is approved when Redsys returns code 400 (formatted as "0400"
 * or "400").
 */
export function isRedsysCancellationAuthorized(response: string): boolean {
  return /^\d{3,4}$/.test(response) && Number(response) === 400
}
