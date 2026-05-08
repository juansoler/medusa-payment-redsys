import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createRedsysAPI, SANDBOX_URLS, PRODUCTION_URLS } from "redsys-easy"
import type { Logger } from "@medusajs/medusa"
import type {
  InitiatePaymentInput,
  InitiatePaymentOutput,
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
} from "@medusajs/types"

import type {
  RedsysOptions,
  RedsysPaymentSessionData,
  RedsysRedirectForm,
} from "../../types"
import { getSmallestUnit } from "../../utils/amount"
import { getCurrencyNum } from "../../utils/currency"
import { generateOrderId } from "../../utils/order-id"
import { getErrorMessage } from "../../utils/errors"

type InjectedDependencies = {
  logger: Logger
}

const DEFAULTS = {
  terminal: "001",
  transactionType: "0",
} as const

class RedsysProviderService extends AbstractPaymentProvider<RedsysOptions> {
  static identifier = "redsys"

  protected logger_: Logger
  protected options_: RedsysOptions
  protected redsysApi: ReturnType<typeof createRedsysAPI>

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.secretKey || typeof options.secretKey !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Redsys secretKey is required and must be a string"
      )
    }
    if (!options.merchantCode || typeof options.merchantCode !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Redsys merchantCode is required and must be a string"
      )
    }
  }

  constructor(container: InjectedDependencies, options: RedsysOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options

    this.redsysApi = createRedsysAPI({
      secretKey: options.secretKey,
      urls:
        options.environment === "production" ? PRODUCTION_URLS : SANDBOX_URLS,
    })
  }

  // ---------- Initiate ----------

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const orderId = generateOrderId()
    const sessionId = "redsys_" + orderId
    const amount = this.assertPositiveAmount(input.amount)
    const amountStr = String(getSmallestUnit(amount, input.currency_code))
    const currencyNum = getCurrencyNum(input.currency_code)
    const transactionType =
      this.options_.transactionType || DEFAULTS.transactionType

    const merchantParams: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: this.options_.terminal || DEFAULTS.terminal,
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_AMOUNT: amountStr,
      DS_MERCHANT_CURRENCY: currencyNum,
      DS_MERCHANT_TRANSACTIONTYPE: transactionType,
      DS_MERCHANT_CONSUMERLANGUAGE: "1",
    }

    if (this.options_.notificationUrl) {
      merchantParams.DS_MERCHANT_MERCHANTURL = this.options_.notificationUrl
    }

    const separator = (url: string) => url.includes("?") ? "&" : "?"

    if (this.options_.successUrl) {
      merchantParams.DS_MERCHANT_URLOK =
        this.options_.successUrl + separator(this.options_.successUrl) + "orderId=" + orderId
    }
    if (this.options_.errorUrl) {
      merchantParams.DS_MERCHANT_URLKO =
        this.options_.errorUrl + separator(this.options_.errorUrl) + "orderId=" + orderId
    }

    merchantParams.DS_MERCHANT_MERCHANTDATA = sessionId + "|" + orderId

    const form = await this.redsysApi.createRedirectForm(
      merchantParams as any
    )

    const sessionData: RedsysPaymentSessionData = {
      orderId,
      amount: amountStr,
      currency: currencyNum,
      status: "pending",
      transactionType,
      merchantParams: form.body.Ds_MerchantParameters,
      signature: form.body.Ds_Signature,
      signatureVersion: form.body.Ds_SignatureVersion,
      formUrl: form.url,
    }

    this.logger_.info("[REDSYS] Redirect form created for order: " + orderId)

    return {
      id: sessionId,
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

// ---------- Authorize ----------

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (
      sessionData?.status === "authorized" ||
      sessionData?.status === "pending"
    ) {
      return {
        status: PaymentSessionStatus.AUTHORIZED,
        data: input.data as Record<string, unknown>,
      }
    }

    return {
      status: PaymentSessionStatus.PENDING,
      data: input.data as Record<string, unknown>,
    }
  }

  // ---------- Capture ----------

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (!sessionData?.orderId) {
      return { data: input.data as Record<string, unknown> | undefined }
    }

    const transactionType =
      sessionData.transactionType || DEFAULTS.transactionType

    if (transactionType !== "1") {
      return { data: input.data as Record<string, unknown> | undefined }
    }

    const params: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: this.options_.terminal || DEFAULTS.terminal,
      DS_MERCHANT_ORDER: sessionData.orderId,
      DS_MERCHANT_AMOUNT: sessionData.amount,
      DS_MERCHANT_CURRENCY: sessionData.currency,
      DS_MERCHANT_TRANSACTIONTYPE: "2",
    }

    const response = await this.redsysApi.restIniciaPeticion(params as any)

    if (
      (response as any).Ds_Response === "0000" ||
      String((response as any).Ds_Response).startsWith("00")
    ) {
      sessionData.authCode = (response as any).Ds_AuthorisationCode
      this.logger_.info(
        "[REDSYS] Capture successful for order: " + sessionData.orderId
      )
    } else {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        getErrorMessage((response as any).Ds_Response)
      )
    }

    return {
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

  // ---------- Cancel ----------

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (!sessionData?.orderId) {
      return { data: input.data as Record<string, unknown> | undefined }
    }

    if (sessionData.status === "cancelled") {
      return { data: input.data as Record<string, unknown> | undefined }
    }

    const params: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: this.options_.terminal || DEFAULTS.terminal,
      DS_MERCHANT_ORDER: sessionData.orderId,
      DS_MERCHANT_AMOUNT: sessionData.amount,
      DS_MERCHANT_CURRENCY: sessionData.currency,
      DS_MERCHANT_TRANSACTIONTYPE: "9",
    }

    const response = await this.redsysApi.restIniciaPeticion(params as any)

    if (
      (response as any).Ds_Response === "0000" ||
      String((response as any).Ds_Response).startsWith("00")
    ) {
      sessionData.status = "cancelled"
      this.logger_.info(
        "[REDSYS] Payment cancelled for order: " + sessionData.orderId
      )
    } else {
      this.logger_.warn(
        "[REDSYS] Cancellation responded with code: " +
          (response as any).Ds_Response
      )
    }

    return {
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

  // ---------- Refund ----------

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (!sessionData?.orderId) {
      return { data: input.data as Record<string, unknown> | undefined }
    }

    const refundAmount = this.assertPositiveAmount(input.amount)

    const currencyToAlpha: Record<string, string> = {
      "978": "eur",
      "840": "usd",
      "826": "gbp",
      "392": "jpy",
    }
    const currencyCode = currencyToAlpha[sessionData.currency] || "eur"
    const amountStr = String(getSmallestUnit(refundAmount, currencyCode))

    const params: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: this.options_.terminal || DEFAULTS.terminal,
      DS_MERCHANT_ORDER: sessionData.orderId,
      DS_MERCHANT_AMOUNT: amountStr,
      DS_MERCHANT_CURRENCY: sessionData.currency,
      DS_MERCHANT_TRANSACTIONTYPE: "3",
    }

    const response = await this.redsysApi.restIniciaPeticion(params as any)
    const code = String((response as any).Ds_Response)

    if (
      code === "0000" ||
      code.startsWith("00") ||
      code === "0900" ||
      code === "900"
    ) {
      sessionData.status = "refunded"
      this.logger_.info(
        "[REDSYS] Refund processed for order: " +
          sessionData.orderId +
          " Amount: " +
          amountStr
      )
    } else {
      throw new MedusaError(
        MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
        getErrorMessage((response as any).Ds_Response)
      )
    }

    return {
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

  // ---------- Status ----------

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (!sessionData?.status) {
      return { status: PaymentSessionStatus.PENDING }
    }

    switch (sessionData.status) {
      case "authorized":
        return { status: PaymentSessionStatus.AUTHORIZED }
      case "refunded":
        return { status: PaymentSessionStatus.CAPTURED }
      case "cancelled":
        return { status: PaymentSessionStatus.CANCELED }
      case "error":
        return { status: PaymentSessionStatus.ERROR }
      default:
        return { status: PaymentSessionStatus.PENDING }
    }
  }

  // ---------- Retrieve ----------

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data as Record<string, unknown> | undefined }
  }

  // ---------- Update ----------

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined
    const orderId = sessionData?.orderId || generateOrderId()
    const sessionId = "redsys_" + orderId
    const amount = this.assertPositiveAmount(input.amount)
    const amountStr = String(getSmallestUnit(amount, input.currency_code))
    const currencyNum = getCurrencyNum(input.currency_code)
    const transactionType =
      this.options_.transactionType || DEFAULTS.transactionType

    const merchantParams: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: this.options_.terminal || DEFAULTS.terminal,
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_AMOUNT: amountStr,
      DS_MERCHANT_CURRENCY: currencyNum,
      DS_MERCHANT_TRANSACTIONTYPE: transactionType,
      DS_MERCHANT_CONSUMERLANGUAGE: "1",
    }

    if (this.options_.notificationUrl) {
      merchantParams.DS_MERCHANT_MERCHANTURL = this.options_.notificationUrl
    }

    const separator = (url: string) => url.includes("?") ? "&" : "?"

    if (this.options_.successUrl) {
      merchantParams.DS_MERCHANT_URLOK =
        this.options_.successUrl + separator(this.options_.successUrl) + "orderId=" + orderId
    }
    if (this.options_.errorUrl) {
      merchantParams.DS_MERCHANT_URLKO =
        this.options_.errorUrl + separator(this.options_.errorUrl) + "orderId=" + orderId
    }

    merchantParams.DS_MERCHANT_MERCHANTDATA = sessionId + "|" + orderId

    const form = await this.redsysApi.createRedirectForm(
      merchantParams as any
    )

    const newData: RedsysPaymentSessionData = {
      orderId,
      amount: amountStr,
      currency: currencyNum,
      status: "pending",
      transactionType,
      merchantParams: form.body.Ds_MerchantParameters,
      signature: form.body.Ds_Signature,
      signatureVersion: form.body.Ds_SignatureVersion,
      formUrl: form.url,
    }

    return {
      data: newData as unknown as Record<string, unknown>,
    }
  }

  // ---------- Delete ----------

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return {}
  }

  // ---------- Webhook ----------

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    try {
      const notification = this.redsysApi.processRestNotification(
        payload.data as any
      )

      if (!notification) {
        this.logger_.warn("[REDSYS] Webhook: invalid notification data")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const dsResponse = String((notification as any).Ds_Response)

      if (dsResponse === "0000" || dsResponse.startsWith("00")) {
        this.logger_.info(
          "[REDSYS] Webhook: payment authorized for order: " +
            (notification as any).Ds_Order
        )

        let sessionId: string | undefined
        let orderId = (notification as any).Ds_Order

        try {
          const merchantData = (notification as any).Ds_MerchantData
          if (merchantData) {
            const parts = merchantData.split("|")
            if (parts.length >= 3) {
              orderId = parts[2]
              sessionId = parts[1]
            }
          }
        } catch {
          // MerchantData parsing is best-effort
        }

        return {
          action: PaymentActions.SUCCESSFUL,
          data: {
            session_id: sessionId || "redsys_" + orderId,
            amount: (notification as any).Ds_Amount || 0,
          },
        }
      }

      this.logger_.warn(
        "[REDSYS] Webhook: payment not authorized. Order: " +
          (notification as any).Ds_Order +
          " Response: " +
          dsResponse
      )

      return {
        action: PaymentActions.FAILED,
      }
    } catch (error) {
      this.logger_.error(
        "[REDSYS] Webhook error: " + (error as Error).message
      )
      return { action: PaymentActions.NOT_SUPPORTED }
    }
  }

  // ---------- Helpers ----------

  private assertPositiveAmount(amount: unknown): number {
    const n = parseFloat(String(amount))
    if (!Number.isFinite(n) || n <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "amount must be a positive finite number, got \"" + amount + "\""
      )
    }
    return n
  }
}

export default RedsysProviderService
