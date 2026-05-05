import { RedsysCurrencyCodes } from "../types"

/**
 * Convert ISO 4217 currency code (e.g. "EUR") to Redsys numeric code (e.g. "978")
 * Falls back to EUR ("978") for unknown currencies.
 */
export function getCurrencyNum(currencyCode: string): string {
  const upper = currencyCode?.toUpperCase() || "EUR"
  return RedsysCurrencyCodes[upper] || "978"
}

/**
 * Convert Redsys numeric currency code (e.g. "978") to ISO 4217 code (e.g. "EUR")
 * Falls back to "eur" for unknown codes.
 */
export function getCurrencyCode(numericCode: string): string {
  const entries = Object.entries(RedsysCurrencyCodes) as [string, string][]
  const found = entries.find(([_, value]) => value === numericCode)
  return found ? found[0].toLowerCase() : "eur"
}
