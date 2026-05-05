/**
 * Generate a unique order ID for Redsys.
 * Redsys requires:
 * - First 4 characters must be digits
 * - Max 12 characters
 * - Alphanumeric (digits + uppercase letters)
 */
export function generateOrderId(): string {
  const prefix = String(Math.floor(Math.random() * 9000 + 1000))
  const suffix = Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase()
  return (prefix + suffix).substring(0, 12)
}
