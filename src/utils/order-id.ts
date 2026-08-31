import { randomInt } from "node:crypto"

/**
 * Character set used for the non-numeric part of the Redsys order ID.
 */
const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

/**
 * Generates a cryptographically secure Redsys order ID.
 *
 * Redsys requirements:
 * - First 4 characters must be digits
 * - Maximum 12 characters
 * - Alphanumeric (digits + uppercase letters)
 *
 * The resulting ID always matches `^\d{4}[A-Z0-9]{8}$` (12 characters).
 * It MUST NOT be used as the Medusa payment session identifier.
 */
export function generateOrderId(): string {
  const prefix = String(randomInt(1000, 10000))

  let suffix = ""

  for (let i = 0; i < 8; i++) {
    suffix += ALPHANUMERIC[randomInt(0, ALPHANUMERIC.length)]
  }

  return prefix + suffix
}
