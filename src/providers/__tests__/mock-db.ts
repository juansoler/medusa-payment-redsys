import type { DbConnection, PaymentReference } from "../../utils/reference-store"

/**
 * In-memory implementation of the `pgConnection` knex-like interface used by
 * the reference store. Records inserts/updates so tests can inspect state.
 */
export function createMockDb(): DbConnection & { rows: Map<string, PaymentReference> } {
  const rows = new Map<string, PaymentReference>()

  const db = {
    rows,

    async raw(
      sql: string,
      bindings: unknown[] = []
    ): Promise<{ rows?: unknown[]; rowCount?: number }> {
      if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
        return { rows: [] }
      }

      if (/^INSERT INTO/i.test(sql)) {
        const [
          order_id,
          payment_session_id,
          provider,
          cart_id,
          amount,
          currency_code,
          currency_num,
          merchant_code,
          terminal,
          transaction_type,
        ] = bindings as string[]

        rows.set(order_id, {
          order_id,
          payment_session_id,
          provider,
          cart_id: cart_id ?? null,
          amount,
          currency_code,
          currency_num,
          merchant_code,
          terminal,
          transaction_type,
          confirmed_at: null,
          ds_response: null,
          auth_code: null,
        })

        return { rows: [], rowCount: 1 }
      }

      if (/^SELECT/i.test(sql)) {
        const orderId = bindings[0] as string
        const row = rows.get(orderId)
        return { rows: row ? [row] : [] }
      }

      if (/^UPDATE/i.test(sql)) {
        const [ds_response, auth_code, order_id] = bindings as string[]
        const row = rows.get(order_id)
        if (row) {
          row.confirmed_at = new Date("2026-08-31T00:00:00.000Z")
          row.ds_response = ds_response
          row.auth_code = auth_code
        }
        return { rows: [], rowCount: row ? 1 : 0 }
      }

      throw new Error("Unexpected SQL: " + sql)
    },
  }

  return db
}
