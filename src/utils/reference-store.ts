/**
 * Persistent store for Redsys payment references.
 *
 * A reference is created in `initiatePayment` (and `updatePayment`) BEFORE the
 * customer is redirected to Redsys, and records every detail that a webhook
 * must later match to confirm the payment. `authorizePayment` only authorizes
 * a session whose reference has been marked as confirmed by a valid, fully
 * matching webhook — this is what prevents replaying an old `orderId`.
 */

export interface DbConnection {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: unknown[]; rowCount?: number }>
}

export interface PaymentReference {
  order_id: string
  payment_session_id: string
  provider: string
  cart_id: string | null
  amount: string
  currency_code: string
  currency_num: string
  merchant_code: string
  terminal: string
  transaction_type: string
  confirmed_at: Date | string | null
  ds_response: string | null
  auth_code: string | null
}

export interface CreatePaymentReferenceInput {
  orderId: string
  paymentSessionId: string
  provider: string
  cartId: string | null
  amount: string
  currencyCode: string
  currencyNum: string
  merchantCode: string
  terminal: string
  transactionType: string
}

const TABLE = "redsys_payment_reference"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    order_id          VARCHAR(12)  PRIMARY KEY,
    payment_session_id VARCHAR(255) NOT NULL,
    provider          VARCHAR(64)  NOT NULL,
    cart_id           VARCHAR(255),
    amount            VARCHAR(32)  NOT NULL,
    currency_code     VARCHAR(8)   NOT NULL,
    currency_num      VARCHAR(8)   NOT NULL,
    merchant_code     VARCHAR(16)  NOT NULL,
    terminal          VARCHAR(8)   NOT NULL,
    transaction_type  VARCHAR(4)   NOT NULL,
    confirmed_at      TIMESTAMPTZ,
    ds_response       VARCHAR(16),
    auth_code         VARCHAR(16),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )
`

let ensurePromise: Promise<void> | undefined

/**
 * Create the reference table if it doesn't exist yet. Memoized per process so
 * it only runs once.
 */
export function ensureReferenceTable(
  connection: DbConnection
): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = connection
      .raw(CREATE_TABLE_SQL)
      .then(() => undefined)
      .catch((error) => {
        ensurePromise = undefined
        throw error
      })
  }

  return ensurePromise
}

export async function createPaymentReference(
  connection: DbConnection,
  input: CreatePaymentReferenceInput
): Promise<void> {
  await ensureReferenceTable(connection)

  await connection.raw(
    `INSERT INTO ${TABLE} (
      order_id, payment_session_id, provider, cart_id, amount,
      currency_code, currency_num, merchant_code, terminal, transaction_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (order_id) DO NOTHING`,
    [
      input.orderId,
      input.paymentSessionId,
      input.provider,
      input.cartId,
      input.amount,
      input.currencyCode,
      input.currencyNum,
      input.merchantCode,
      input.terminal,
      input.transactionType,
    ]
  )
}

export async function getPaymentReference(
  connection: DbConnection,
  orderId: string
): Promise<PaymentReference | undefined> {
  await ensureReferenceTable(connection)

  const result = await connection.raw(
    `SELECT * FROM ${TABLE} WHERE order_id = ?`,
    [orderId]
  )

  const rows = (result.rows ?? []) as PaymentReference[]

  return rows[0]
}

export async function markPaymentReferenceConfirmed(
  connection: DbConnection,
  orderId: string,
  dsResponse: string,
  authCode: string
): Promise<void> {
  await ensureReferenceTable(connection)

  await connection.raw(
    `UPDATE ${TABLE}
     SET confirmed_at = NOW(), ds_response = ?, auth_code = ?
     WHERE order_id = ?`,
    [dsResponse, authCode, orderId]
  )
}
