import { RedsysCurrencyCodes } from "../types"

/**
 * Convert ISO 4217 currency code (e.g. "EUR") to Redsys numeric code (e.g. "978").
 *
 * Fails closed: unsupported or missing currencies throw instead of silently
 * falling back to EUR, which could otherwise charge the wrong amount.
 */
export function getCurrencyNum(currencyCode: string): string {
  const upper = currencyCode?.toUpperCase()

  if (!upper || !RedsysCurrencyCodes[upper]) {
    throw new RangeError(`Unsupported Redsys currency: ${currencyCode}`)
  }

  return RedsysCurrencyCodes[upper]
}

/**
 * Convert Redsys numeric currency code (e.g. "978") to ISO 4217 code (e.g. "EUR").
 *
 * Fails closed: unknown numeric codes return `undefined` so callers can reject
 * the transaction instead of assuming a currency.
 */
export function getCurrencyCode(numericCode: string): string | undefined {
  const entries = Object.entries(RedsysCurrencyCodes) as [string, string][]
  const found = entries.find(([, value]) => value === numericCode)
  return found ? found[0].toLowerCase() : undefined
}
