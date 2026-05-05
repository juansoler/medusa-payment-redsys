/**
 * Convert amount to smallest currency unit (cents for most currencies)
 * Redsys expects amounts in the smallest unit (e.g., EUR cents)
 */
export function getSmallestUnit(amount: number, currency: string): number {
  const normalizedCurrency = currency.toLowerCase()

  // Currencies without decimals (0 decimal places)
  const zeroDecimal = ["jpy", "krw", "vnd", "isk", "clp"]
  if (zeroDecimal.includes(normalizedCurrency)) {
    return Math.round(amount)
  }

  // Standard currencies with 2 decimal places
  return Math.round(amount * 100)
}
