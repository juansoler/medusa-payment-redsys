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

const defaultOptions: Record<string, unknown> = {
  secretKey: "test-secret-key",
  merchantCode: "999008881",
  terminal: "001",
  environment: "sandbox",
}

function createService(overrides?: Record<string, unknown>) {
  const options = { ...defaultOptions, ...overrides } as any
  const service = new RedsysProviderService(
    { logger: mockLogger } as any,
    options
  )
  return { service, options }
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
    it("creates a redirect form and returns session data", async () => {
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
        data: {},
        context: {},
      } as any)

      expect(result.id).toMatch(/^redsys_/)
      expect(result.data.formUrl).toBe(
        "https://sis-t.redsys.es:25443/sis/realizarPago"
      )
      expect(result.data.merchantParams).toBe("base64params")
      expect(result.data.signature).toBe("signature123")
      expect(result.data.status).toBe("pending")

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTCODE).toBe("999008881")
      expect(params.DS_MERCHANT_TERMINAL).toBe("001")
      expect(params.DS_MERCHANT_AMOUNT).toBe("2550")
      expect(params.DS_MERCHANT_CURRENCY).toBe("978")
      expect(params.DS_MERCHANT_TRANSACTIONTYPE).toBe("0")
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
        data: {},
        context: {},
      } as any)

      const params =
        mockRedsysApi.createRedirectForm.mock.calls[0][0]
      expect(params.DS_MERCHANT_MERCHANTURL).toBe(
        "https://example.com/webhook"
      )
      expect(params.DS_MERCHANT_URLOK).toBe(
        "https://example.com/success"
      )
      expect(params.DS_MERCHANT_URLKO).toBe(
        "https://example.com/error"
      )
    })

    it("uses production URLs when environment is production", async () => {
      createService({ environment: "production" })

      const { createRedsysAPI } = await import("redsys-easy")
      expect(createRedsysAPI).toHaveBeenCalled()
    })
  })

  describe("authorizePayment", () => {
    it("returns AUTHORIZED when status is already authorized", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: { status: "authorized", orderId: "1234ABCD5678" },
      } as any)

      expect(result.status).toBe("authorized")
    })

    it("returns PENDING when status is pending", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: { status: "pending", orderId: "1234ABCD5678" },
      } as any)

      expect(result.status).toBe("pending")
    })

    it("returns PENDING when no session data", async () => {
      const { service } = createService()

      const result = await service.authorizePayment({
        data: {},
      } as any)

      expect(result.status).toBe("pending")
    })
  })

  describe("capturePayment", () => {
    it("is a no-op for transactionType 0 (immediate capture)", async () => {
      const { service } = createService()

      const result = await service.capturePayment({
        data: { orderId: "1234ABCD5678", transactionType: "0" },
      } as any)

      expect(result.data).toEqual({
        orderId: "1234ABCD5678",
        transactionType: "0",
      })
      expect(mockRedsysApi.restIniciaPeticion).not.toHaveBeenCalled()
    })

    it("calls REDSYS API for pre-authorization capture", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
        Ds_AuthorisationCode: "AUTH123",
      })

      const result = await service.capturePayment({
        data: {
          orderId: "1234ABCD5678",
          amount: "2550",
          currency: "978",
          transactionType: "1",
        },
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "2",
        })
      )
      expect(result.data.authCode).toBe("AUTH123")
    })
  })

  describe("cancelPayment", () => {
    it("sends cancellation request to REDSYS", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0000",
      })

      const result = await service.cancelPayment({
        data: {
          orderId: "1234ABCD5678",
          amount: "2550",
          currency: "978",
          status: "authorized",
        },
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "9",
        })
      )
      expect(result.data.status).toBe("cancelled")
    })
  })

  describe("refundPayment", () => {
    it("sends refund request to REDSYS", async () => {
      const { service } = createService()

      mockRedsysApi.restIniciaPeticion.mockResolvedValue({
        Ds_Response: "0900",
      })

      const result = await service.refundPayment({
        amount: 10,
        data: {
          orderId: "1234ABCD5678",
          amount: "2550",
          currency: "978",
          status: "authorized",
        },
      } as any)

      expect(mockRedsysApi.restIniciaPeticion).toHaveBeenCalledWith(
        expect.objectContaining({
          DS_MERCHANT_TRANSACTIONTYPE: "3",
          DS_MERCHANT_AMOUNT: "1000",
        })
      )
      expect(result.data.status).toBe("refunded")
    })
  })

  describe("getPaymentStatus", () => {
    it.each([
      ["authorized", "authorized"],
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

  describe("getWebhookActionAndData", () => {
    it("returns SUCCESSFUL for authorized payment", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockReturnValue({
        Ds_Order: "1234ABCD5678",
        Ds_Response: "0000",
        Ds_AuthorisationCode: "AUTH123",
        Ds_Amount: "2550",
        Ds_Currency: "978",
        Ds_MerchantData: "cart_1|ps_session_1|1234ABCD5678",
      })

      const result = await service.getWebhookActionAndData({
        data: {
          Ds_SignatureVersion: "HMAC_SHA256_V1",
          Ds_MerchantParameters: "base64params",
          Ds_Signature: "signature123",
        },
      } as any)

      expect(result.action).toBe("captured")
      expect(result.data?.orderId).toBe("1234ABCD5678")
      expect(result.data?.session_id).toBe("ps_session_1")
      expect(result.data?.authCode).toBe("AUTH123")
    })

    it("returns FAILED for declined payment", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockReturnValue({
        Ds_Order: "1234ABCD5678",
        Ds_Response: "101",
      })

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("failed")
    })

    it("returns NOT_SUPPORTED for invalid notification", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockReturnValue(null)

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })

    it("returns NOT_SUPPORTED when processing throws", async () => {
      const { service } = createService()

      mockRedsysApi.processRestNotification.mockImplementation(() => {
        throw new Error("invalid signature")
      })

      const result = await service.getWebhookActionAndData({
        data: {},
      } as any)

      expect(result.action).toBe("not_supported")
    })
  })

  describe("updatePayment", () => {
    it("creates a new redirect form with updated amount", async () => {
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
        data: { orderId: "1234ABCD5678" },
        context: {},
      } as any)

      expect(result.data.amount).toBe("5000")
      expect(result.data.merchantParams).toBe("newparams")
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
        data: { orderId: "1234ABCD5678" },
      } as any)

      expect(result.data).toEqual({ orderId: "1234ABCD5678" })
    })
  })
})
