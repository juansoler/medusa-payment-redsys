/**
 * Currencies without decimals (0 decimal places) where the smallest unit is 1.
 */
const ZERO_DECIMAL_CURRENCIES = ["jpy", "krw", "vnd", "isk", "clp"]

/**
 * Convert amount to smallest currency unit (cents for most currencies).
 * Redsys expects amounts in the smallest unit (e.g., EUR cents).
 */
export function getSmallestUnit(amount: number, currency: string): number {
  const normalizedCurrency = currency.toLowerCase()

  if (ZERO_DECIMAL_CURRENCIES.includes(normalizedCurrency)) {
    return Math.round(amount)
  }

  return Math.round(amount * 100)
}

/**
 * Convert an amount received from Redsys (smallest unit, e.g. "2550") back to
 * the main unit (e.g. 25.5) that Medusa uses for amounts.
 *
 * For zero-decimal currencies the smallest unit IS the main unit, so the value
 * is returned as-is.
 */
export function getAmountFromSmallestUnit(
  amount: string | number,
  currency: string
): number {
  const parsed = Number(amount)

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RangeError(`Invalid amount from Redsys: ${amount}`)
  }

  const normalizedCurrency = currency.toLowerCase()

  if (ZERO_DECIMAL_CURRENCIES.includes(normalizedCurrency)) {
    return parsed
  }

  return parsed / 100
}
