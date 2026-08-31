import { describe, it, expect, vi, beforeEach } from "vitest"
import RedsysProviderService from "../service"

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

const mockPaymentSessionService = {
  retrieve: vi.fn(),
  update: vi.fn(),
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
  const service = new RedsysProviderService(
    { logger: mockLogger, paymentSessionService: mockPaymentSessionService } as any,
    options
  )
  return { service, options }
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    orderId: ORDER_ID,
    medusaSessionId: SESSION_ID,
    amount: "2550",
    currency: "978",
    currencyCode: "eur",
    status: "pending",
    transactionType: "0",
    webhookConfirmed: false,
    ...overrides,
  }
}

function buildNotification(
  data: Record<string, any>,
  overrides: Record<string, unknown> = {}
) {
  const merchantData = `${data.cartId || ""}|${data.medusaSessionId}|${data.orderId}`
  return {
    Ds_Order: data.orderId,
    Ds_Response: "0000",
    Ds_Amount: data.amount,
    Ds_Currency: data.currency,
    Ds_MerchantCode: "999008881",
    Ds_Terminal: "001",
    Ds_TransactionType: data.transactionType,
    Ds_MerchantData: merchantData,
    Ds_AuthorisationCode: "AUTH123",
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
    it("creates a redirect form and returns session data with webhookConfirmed false", async () => {
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
        amount: 25.5,
        currency_code: "EUR",
        data: { session_id: SESSION_ID },
        context: { cart_id: "cart_1" },
      } as any)

      expect(result.id).toBe(SESSION_ID)
      expect(result.data.status).toBe("pending")
      expect(result.data.webhookConfirmed).toBe(false)
      expect(result.data.medusaSessionId).toBe(SESSION_ID)

      const orderId = result.data.orderId as string
      expect(orderId).toMatch(/^\d{4}[A-Z0-9]{8}$/)

      const params = mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_AMOUNT).toBe("2550")
      expect(params.DS_MERCHANT_CURRENCY).toBe("978")
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

      const params = mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTDATA).toBe(
        `|${SESSION_ID}|${result.data.orderId}`
      )
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
  })

  describe("authorizePayment", () => {
    it("returns PENDING for a session without webhook confirmation", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: sessionData(),
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns PENDING even when the stored status is authorized but webhook not confirmed", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: sessionData({ status: "authorized" }),
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
      const { service } = createService()

      const result = await service.authorizePayment({
        data: sessionData({ webhookConfirmed: true }),
      } as any)

      expect(result.status).toBe("captured")
      expect(result.data?.status).toBe("captured")
    })

    it("returns AUTHORIZED for a confirmed preauthorization (tx 1)", async () => {
      const { service } = createService({ transactionType: "1" })

      const result = await service.authorizePayment({
        data: sessionData({ transactionType: "1", webhookConfirmed: true }),
      } as any)

      expect(result.status).toBe("authorized")
      expect(result.data?.status).toBe("authorized")
    })
  })

  describe("getWebhookActionAndData", () => {
    it("confirms the session and returns SUCCESSFUL with normalized amount", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })

      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data)
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("captured")
      expect(result.data?.session_id).toBe(SESSION_ID)
      expect(result.data?.amount).toBe(25.5)

      expect(mockPaymentSessionService.update).toHaveBeenCalledWith({
        id: SESSION_ID,
        data: expect.objectContaining({ webhookConfirmed: true }),
      })
    })

    it("returns AUTHORIZED for preauthorization webhooks (tx 1)", async () => {
      const { service } = createService({ transactionType: "1" })
      const data = sessionData({ transactionType: "1" })

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_TransactionType: "1" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("authorized")
    })

    it("returns NOT_SUPPORTED when the session is not found", async () => {
      const { service } = createService()

      mockPaymentSessionService.retrieve.mockRejectedValue(
        new Error("not found")
      )
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(sessionData())
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(mockPaymentSessionService.update).not.toHaveBeenCalled()
    })

    it("rejects when the amount does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_Amount: "9999" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(mockPaymentSessionService.update).not.toHaveBeenCalled()
    })

    it("rejects when the currency does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_Currency: "840" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the session id does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, {
          Ds_MerchantData: `cart_1|payses_other|${ORDER_ID}`,
        })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects a webhook meant for the bizum provider", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys-bizum_redsys-bizum",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data)
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the merchant code does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_MerchantCode: "999999999" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the terminal does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_Terminal: "002" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("rejects when the transaction type does not match", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_TransactionType: "1" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("returns FAILED for a declined payment and does not confirm", async () => {
      const { service } = createService()
      const data = sessionData()

      mockPaymentSessionService.retrieve.mockResolvedValue({
        id: SESSION_ID,
        data,
        provider_id: "pp_redsys_redsys",
      })
      mockRedsysApi.processRestNotification.mockReturnValue(
        buildNotification(data, { Ds_Response: "101" })
      )

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("failed")
      expect(mockPaymentSessionService.update).not.toHaveBeenCalled()
    })

    it("returns NOT_SUPPORTED when the signature is invalid and changes nothing", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockImplementation(() => {
        throw new Error("invalid signature")
      })

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
      expect(mockPaymentSessionService.update).not.toHaveBeenCalled()
    })
  })

  describe("capturePayment", () => {
    it("is a no-op for transactionType 0", async () => {
      const { service } = createService()

      const result = await service.capturePayment({
        data: sessionData({ transactionType: "0" }),
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).not.toHaveBeenCalled()
      expect(result.data).toEqual(
        expect.objectContaining({ orderId: ORDER_ID })
      )
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

      expect(result.data?.authCode).toBe("AUTH123")
    })

    it("rejects payment codes for a confirmation", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
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
    it("generates a new order id, preserves the session id and resets webhookConfirmed", async () => {
      const { service } = createService()

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
        data: sessionData({ cartId: "cart_1", webhookConfirmed: true }),
        context: {},
      } as any)

      expect(result.data.medusaSessionId).toBe(SESSION_ID)
      expect(result.data.amount).toBe("5000")
      expect(result.data.webhookConfirmed).toBe(false)

      const orderId = result.data.orderId as string
      expect(orderId).not.toBe(ORDER_ID)

      const params = mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTDATA).toBe(
        `cart_1|${SESSION_ID}|${orderId}`
      )
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
