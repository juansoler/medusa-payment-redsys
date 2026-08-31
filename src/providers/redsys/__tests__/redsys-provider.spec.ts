import { describe, it, expect, vi, beforeEach } from "vitest"
import RedsysProviderService from "../service"
import { createMockDb } from "../../__tests__/mock-db"
import type { PaymentReference } from "../../../utils/reference-store"

const mockRedsysApi = {
  createRedirectForm: vi.fn(),
  processRestNotification: vi.fn(),
  restIniciaPeticion: vi.fn(),
}

vi.mock("redsys-easy", () => ({
  createRedsysAPI: vi.fn(() => mockRedsysApi),
  SANDBOX_URLS: "https://sis-t.redsys.es:25443/sis/",
  PRODUCTION_URLS: "https://sis.redsys.es/sis/",
}))

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  activity: vi.fn(),
  progress: vi.fn(),
  panic: vi.fn(),
  shouldLog: vi.fn(),
}

const defaultOptions: Record<string, unknown> = {
  secretKey: "test-secret-key",
  merchantCode: "999008881",
  terminal: "001",
  environment: "sandbox",
}

const ORDER_ID = "1234ABCD5678"
const SESSION_ID = "payses_123"

function createService(overrides?: Record<string, unknown>) {
  const options = { ...defaultOptions, ...overrides } as any
  const db = createMockDb()
  const service = new RedsysProviderService(
    { logger: mockLogger, pgConnection: db } as any,
    options
  )
  return { service, options, db }
}

function seed(
  db: ReturnType<typeof createMockDb>,
  overrides: Partial<PaymentReference> = {}
) {
  const ref: PaymentReference = {
    order_id: ORDER_ID,
    payment_session_id: SESSION_ID,
    provider: "redsys",
    cart_id: null,
    amount: "2550",
    currency_code: "eur",
    currency_num: "978",
    merchant_code: "999008881",
    terminal: "001",
    transaction_type: "0",
    confirmed_at: null,
    ds_response: null,
    auth_code: null,
    ...overrides,
  }
  db.rows.set(ref.order_id, ref)
  return ref
}

function confirm(db: ReturnType<typeof createMockDb>, orderId = ORDER_ID) {
  const row = db.rows.get(orderId)
  if (row) {
    row.confirmed_at = new Date("2026-08-31T00:00:00.000Z")
    row.ds_response = "0000"
    row.auth_code = "AUTH123"
  }
  return row
}

function buildNotification(
  reference: PaymentReference,
  overrides: Record<string, unknown> = {}
) {
  const merchantData = `${reference.cart_id ?? ""}|${reference.payment_session_id}|${reference.order_id}`
  return {
    Ds_Order: reference.order_id,
    Ds_Response: "0000",
    Ds_Amount: reference.amount,
    Ds_Currency: reference.currency_num,
    Ds_MerchantCode: reference.merchant_code,
    Ds_Terminal: reference.terminal,
    Ds_TransactionType: reference.transaction_type,
    Ds_MerchantData: merchantData,
    Ds_AuthorisationCode: "AUTH123",
    ...overrides,
  }
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    medusaSessionId: SESSION_ID,
    amount: "2550",
    currency: "978",
    status: "pending",
    transactionType: "0",
    ...overrides,
  }
}

describe("RedsysProviderService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("validateOptions", () => {
    it("throws when secretKey is missing", () => {
      expect(() =>
        RedsysProviderService.validateOptions({ merchantCode: "123" })
      ).toThrow("secretKey")
    })

    it("throws when merchantCode is missing", () => {
      expect(() =>
        RedsysProviderService.validateOptions({ secretKey: "abc" })
      ).toThrow("merchantCode")
    })

    it("passes with valid options", () => {
      expect(() =>
        RedsysProviderService.validateOptions({
          secretKey: "abc",
          merchantCode: "123",
        })
      ).not.toThrow()
    })
  })

  describe("initiatePayment", () => {
    it("creates a redirect form, persists a reference and returns session data", async () => {
      const { service, db } = createService()

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "base64params",
          Ds_Signature: "signature123",
        },
      })

      const result = await service.initiatePayment({
        amount: 25.5,
        currency_code: "EUR",
        data: { session_id: SESSION_ID },
        context: { cart_id: "cart_1" },
      } as any)

      expect(result.id).toBe(SESSION_ID)
      expect(result.data?.formUrl).toBe(
        "https://sis-t.redsys.es:25443/sis/realizarPago"
      )
      expect(result.data?.merchantParams).toBe("base64params")
      expect(result.data?.signature).toBe("signature123")
      expect(result.data?.status).toBe("pending")
      expect(result.data?.medusaSessionId).toBe(SESSION_ID)

      const orderId = result.data?.orderId as string
      expect(orderId).toMatch(/^\d{4}[A-Z0-9]{8}$/)

      const reference = db.rows.get(orderId)
      expect(reference).toBeDefined()
      expect(reference?.payment_session_id).toBe(SESSION_ID)
      expect(reference?.provider).toBe("redsys")
      expect(reference?.cart_id).toBe("cart_1")
      expect(reference?.amount).toBe("2550")
      expect(reference?.currency_code).toBe("eur")
      expect(reference?.currency_num).toBe("978")
      expect(reference?.merchant_code).toBe("999008881")
      expect(reference?.terminal).toBe("001")
      expect(reference?.transaction_type).toBe("0")
      expect(reference?.confirmed_at).toBeNull()

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTCODE).toBe("999008881")
      expect(params.DS_MERCHANT_TERMINAL).toBe("001")
      expect(params.DS_MERCHANT_AMOUNT).toBe("2550")
      expect(params.DS_MERCHANT_CURRENCY).toBe("978")
      expect(params.DS_MERCHANT_TRANSACTIONTYPE).toBe("0")
      // fixed positions: cartId | session | order
      expect(params.DS_MERCHANT_MERCHANTDATA).toBe(
        `cart_1|${SESSION_ID}|${orderId}`
      )
    })

    it("keeps MerchantData positions even without a cart id", async () => {
      const { service } = createService()

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "base64params",
          Ds_Signature: "signature123",
        },
      })

      const result = await service.initiatePayment({
        amount: 10,
        currency_code: "EUR",
        data: { session_id: SESSION_ID },
        context: {},
      } as any)

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTDATA).toBe(
        `|${SESSION_ID}|${result.data?.orderId}`
      )
    })

    it("uses context.idempotency_key as fallback session id", async () => {
      const { service } = createService()

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "base64params",
          Ds_Signature: "signature123",
        },
      })

      const result = await service.initiatePayment({
        amount: 10,
        currency_code: "EUR",
        data: {},
        context: { idempotency_key: SESSION_ID },
      } as any)

      expect(result.data?.medusaSessionId).toBe(SESSION_ID)
    })

    it("throws when the Medusa session id is missing", async () => {
      const { service } = createService()

      await expect(
        service.initiatePayment({
          amount: 10,
          currency_code: "EUR",
          data: {},
          context: {},
        } as any)
      ).rejects.toThrow("session ID")
    })

    it("rejects unsupported currencies instead of falling back to EUR", async () => {
      const { service } = createService()

      await expect(
        service.initiatePayment({
          amount: 10,
          currency_code: "XYZ",
          data: { session_id: SESSION_ID },
          context: {},
        } as any)
      ).rejects.toThrow("Unsupported Redsys currency")
    })

    it("includes notification and redirect URLs when configured", async () => {
      const { service } = createService({
        notificationUrl: "https://example.com/webhook",
        successUrl: "https://example.com/success",
        errorUrl: "https://example.com/error",
      })

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "params",
          Ds_Signature: "sig",
        },
      })

      await service.initiatePayment({
        amount: 10,
        currency_code: "EUR",
        data: { session_id: SESSION_ID },
        context: {},
      } as any)

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTURL).toBe(
        "https://example.com/webhook"
      )
      expect(params.DS_MERCHANT_URLOK).toContain(
        "https://example.com/success"
      )
      expect(params.DS_MERCHANT_URLKO).toContain(
        "https://example.com/error"
      )
    })
  })

  describe("authorizePayment", () => {
    it("returns PENDING for a pending session without a confirmed webhook", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns PENDING even when the stored status is authorized but no webhook confirmed it", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: sessionData({ status: "authorized" }),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns PENDING when the reference exists but is not confirmed", async () => {
      const { service, db } = createService()
      seed(db)

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns PENDING when session data is missing", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: {},
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns CAPTURED for a confirmed immediate capture (tx 0)", async () => {
      const { service, db } = createService()
      const ref = seed(db)
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("captured")
      expect(result.data?.status).toBe("captured")
    })

    it("returns AUTHORIZED for a confirmed preauthorization (tx 1)", async () => {
      const { service, db } = createService({
        transactionType: "1",
      })
      const ref = seed(db, { transaction_type: "1" })
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData({ transactionType: "1" }),
      } as any)

      expect(result.status).toBe("authorized")
      expect(result.data?.status).toBe("authorized")
    })

    it("rejects a confirmed webhook when the amount differs", async () => {
      const { service, db } = createService()
      const ref = seed(db)
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData({ amount: "9999" }),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("rejects a confirmed webhook when the currency differs", async () => {
      const { service, db } = createService()
      const ref = seed(db)
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData({ currency: "840" }),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("rejects a confirmed webhook for another payment session", async () => {
      const { service, db } = createService()
      const ref = seed(db)
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData({ medusaSessionId: "payses_other" }),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("rejects a confirmed webhook from the bizum provider", async () => {
      const { service, db } = createService()
      const ref = seed(db, { provider: "redsys-bizum" })
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("rejects a confirmed webhook when the merchant differs", async () => {
      const { service, db } = createService()
      const ref = seed(db, { merchant_code: "999999999" })
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("rejects a confirmed webhook when the transaction type differs", async () => {
      const { service, db } = createService()
      const ref = seed(db, { transaction_type: "1" })
      confirm(db, ref.order_id)

      const result = await service.authorizePayment({
        data: sessionData({ transactionType: "1" }),
      } as any)

      // reference says tx 1 but session says tx 0 -> mismatch
      const result2 = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("authorized")
      expect(result2.status).toBe("pending")
    })

    it("authorizes through the full initiate -> webhook -> authorize path", async () => {
      const { service, db } = createService()

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "base64params",
          Ds_Signature: "signature123",
        },
      })

      const initiated = await service.initiatePayment({
        amount: 25.5,
        currency_code: "EUR",
        data: { session_id: SESSION_ID },
        context: {},
      } as any)

      const orderId = initiated.data?.orderId as string
      const reference = db.rows.get(orderId)!

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(reference)
      )

      const webhookResult = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(webhookResult.action).toBe("captured")

      const authorizeResult = await service.authorizePayment({
        data: {
          orderId,
          medusaSessionId: SESSION_ID,
          amount: "2550",
          currency: "978",
          status: "pending",
          transactionType: "0",
        },
      } as any)

      expect(authorizeResult.status).toBe("captured")
    })
  })

  describe("getWebhookActionAndData", () => {
    it("returns SUCCESSFUL with normalized amount and real session id", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref)
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("captured")
      expect(result.data?.session_id).toBe(SESSION_ID)
      expect(result.data?.amount).toBe(25.5)

      const stored = db.rows.get(ORDER_ID)
      expect(stored?.confirmed_at).toBeDefined()
      expect(stored?.ds_response).toBe("0000")
      expect(stored?.auth_code).toBe("AUTH123")
    })

    it("returns AUTHORIZED for preauthorization webhooks (tx 1)", async () => {
      const { service, db } = createService()
      const ref = seed(db, { transaction_type: "1" })

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_TransactionType: "1" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("authorized")
    })

    it("returns NOT_SUPPORTED for an unknown order", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockReturnValue({
        Ds_Order: "9999ZZZZZZZZ",
        Ds_Response: "0000",
        Ds_MerchantData: `|${SESSION_ID}|9999ZZZZZZZZ`,
      })

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("returns NOT_SUPPORTED when MerchantData is malformed", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_MerchantData: `${SESSION_ID}|${ORDER_ID}` })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(db.rows.get(ORDER_ID)?.confirmed_at).toBeNull()
    })

    it("rejects when the amount does not match the reference", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_Amount: "9999" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(db.rows.get(ORDER_ID)?.confirmed_at).toBeNull()
    })

    it("rejects when the currency does not match the reference", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_Currency: "840" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the payment session id does not match", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, {
          Ds_MerchantData: `cart_1|payses_other|${ORDER_ID}`,
        })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the merchant order id does not match", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, {
          Ds_MerchantData: `cart_1|${SESSION_ID}|8888ZZZZZZZZ`,
        })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the merchant code does not match", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_MerchantCode: "999999999" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the terminal does not match", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_Terminal: "002" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the transaction type does not match", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_TransactionType: "1" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects a webhook meant for the bizum provider", async () => {
      const { service, db } = createService()
      const ref = seed(db, { provider: "redsys-bizum" })

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref)
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("returns FAILED for a declined payment", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref, { Ds_Response: "101" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("failed")
      expect(db.rows.get(ORDER_ID)?.confirmed_at).toBeNull()
    })

    it("returns NOT_SUPPORTED when the signature is invalid and changes nothing", async () => {
      const { service, db } = createService()
      seed(db)

      mockRedsysApi.processRestNotification.mockImplementation(() => {
        throw new Error("invalid signature")
      })

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(db.rows.get(ORDER_ID)?.confirmed_at).toBeNull()
    })

    it("is idempotent for a duplicate webhook", async () => {
      const { service, db } = createService()
      const ref = seed(db)

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(ref)
      )

      const first = await service.getWebhookActionAndData({ data: {} } as any)
      const second = await service.getWebhookActionAndData({ data: {} } as any)

      expect(first.action).toBe("captured")
      expect(second.action).toBe("captured")
      expect(db.rows.get(ORDER_ID)?.confirmed_at).toBeDefined()
    })
  })

  describe("capturePayment", () => {
    it("is a no-op for transactionType 0 (immediate capture)", async () => {
      const { service } = createService()

      const result = await service.capturePayment({
        data: sessionData({ transactionType: "0" }),
      } as any)

      expect(result.data).toEqual(
        expect.objectContaining({ orderId: ORDER_ID })
      )
      expect(mockRedsysApi.restIniciaPeticion).not.toHaveBeenCalled()
    })

    it("accepts code 0900 for a preauthorization confirmation", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0900",
        Ds_AuthorisationCode: "AUTH123",
      })

      const result = await service.capturePayment({
        data: sessionData({ transactionType: "1" }),
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "2",
        })
      )
      expect(result.data?.authCode).toBe("AUTH123")
    })

    it("rejects payment codes for a confirmation", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
        Ds_AuthorisationCode: "AUTH123",
      })

      await expect(
        service.capturePayment({
          data: sessionData({ transactionType: "1" }),
        } as any)
      ).rejects.toThrow()
    })
  })

  describe("cancelPayment", () => {
    it("accepts code 0400 for a cancellation", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0400",
      })

      const result = await service.cancelPayment({
        data: sessionData({ status: "authorized" }),
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "9",
        })
      )
      expect(result.data?.status).toBe("cancelled")
    })

    it("rejects other codes for a cancellation", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
      })

      await expect(
        service.cancelPayment({
          data: sessionData({ status: "authorized" }),
        } as any)
      ).rejects.toThrow()
    })
  })

  describe("refundPayment", () => {
    it("accepts code 0900 for a refund", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0900",
      })

      const result = await service.refundPayment({
        amount: 10,
        data: sessionData({ status: "authorized" }),
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "3",
          DS_MERCHANT_AMOUNT: "1000",
        })
      )
      expect(result.data?.status).toBe("refunded")
    })

    it("rejects payment codes like 0000 for a refund", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
      })

      await expect(
        service.refundPayment({
          amount: 10,
          data: sessionData({ status: "authorized" }),
        } as any)
      ).rejects.toThrow()
    })

    it("rejects generic 00xx codes for a refund", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0012",
      })

      await expect(
        service.refundPayment({
          amount: 10,
          data: sessionData({ status: "authorized" }),
        } as any)
      ).rejects.toThrow()
    })
  })

  describe("getPaymentStatus", () => {
    it.each([
      ["authorized", "authorized"],
      ["captured", "captured"],
      ["refunded", "captured"],
      ["cancelled", "canceled"],
      ["error", "error"],
      ["pending", "pending"],
    ])("maps %s to Medusa status %s", async (redsysStatus, medusaStatus) => {
      const { service } = createService()

      const result = await service.getPaymentStatus({
        data: { status: redsysStatus },
      } as any)

      expect(result.status).toBe(medusaStatus)
    })
  })

  describe("updatePayment", () => {
    it("generates a new order id, preserves the session id and builds 3-position MerchantData", async () => {
      const { service, db } = createService()

      mockRedsysApi.createRedirectForm.mockResolvedValue({
        url: "https://sis-t.redsys.es:25443/sis/realizarPago",
        body: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "newparams",
          Ds_Signature: "newsig",
        },
      })

      const result = await service.updatePayment({
        amount: 50,
        currency_code: "EUR",
        data: sessionData({ cartId: "cart_1" }),
        context: {},
      } as any)

      expect(result.data?.medusaSessionId).toBe(SESSION_ID)
      expect(result.data?.amount).toBe("5000")
      expect(result.data?.merchantParams).toBe("newparams")

      const orderId = result.data?.orderId as string
      expect(orderId).toMatch(/^\d{4}[A-Z0-9]{8}$/)
      expect(orderId).not.toBe(ORDER_ID)

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTDATA).toBe(
        `cart_1|${SESSION_ID}|${orderId}`
      )

      const reference = db.rows.get(orderId)
      expect(reference).toBeDefined()
      expect(reference?.payment_session_id).toBe(SESSION_ID)
    })

    it("throws when the Medusa session id is missing", async () => {
      const { service } = createService()

      await expect(
        service.updatePayment({
          amount: 50,
          currency_code: "EUR",
          data: { orderId: ORDER_ID },
          context: {},
        } as any)
      ).rejects.toThrow("session ID")
    })
  })

  describe("deletePayment", () => {
    it("returns empty object", async () => {
      const { service } = createService()

      const result = await service.deletePayment({ data: {} } as any)

      expect(result).toEqual({})
    })
  })

  describe("retrievePayment", () => {
    it("returns the input data", async () => {
      const { service } = createService()

      const result = await service.retrievePayment({
        data: { orderId: ORDER_ID },
      } as any)

      expect(result.data).toEqual({ orderId: ORDER_ID })
    })
  })
})
