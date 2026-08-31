import {
  AbstractPaymentProvider,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"
import { createRedsysAPI, SANDBOX_URLS, PRODUCTION_URLS } from "redsys-easy"
import type { Logger } from "@medusajs/framework/types"
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
} from "../../types"
import { BIZUM_PAY_METHOD } from "../../types"
import {
  getSmallestUnit,
  getAmountFromSmallestUnit,
} from "../../utils/amount"
import { getCurrencyNum, getCurrencyCode } from "../../utils/currency"
import { generateOrderId } from "../../utils/order-id"
import { getErrorMessage } from "../../utils/errors"
import {
  isRedsysPaymentAuthorized,
  isRedsysConfirmationAuthorized,
  isRedsysCancellationAuthorized,
} from "../../utils/response-codes"

type InjectedDependencies = {
  logger: Logger
}

const DEFAULTS = {
  terminal: "001",
  transactionType: "0",
} as const

const PROVIDER_ID = "redsys-bizum"
const PROVIDER_PREFIX = "pp_redsys-bizum"

class RedsysBizumProviderService extends AbstractPaymentProvider<RedsysOptions> {
  static identifier = "redsys-bizum"

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
    const inputData = (input.data || {}) as Record<string, unknown>

    const medusaSessionId =
      typeof inputData.session_id === "string"
        ? inputData.session_id
        : typeof input.context?.idempotency_key === "string"
          ? input.context.idempotency_key
          : undefined

    if (!medusaSessionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing Medusa payment session ID"
      )
    }

    const orderId = generateOrderId()
    const amount = this.assertPositiveAmount(input.amount)
    const amountStr = String(getSmallestUnit(amount, input.currency_code))
    const currencyNum = getCurrencyNum(input.currency_code)
    const currencyCode = input.currency_code.toLowerCase()
    const transactionType =
      this.options_.transactionType || DEFAULTS.transactionType
    const terminal = this.options_.terminal || DEFAULTS.terminal

    const context = (input.context || {}) as Record<string, unknown>
    const cartId = (context.cart_id as string) || ""
    const countryCode =
      (context.country_code as string) ||
      ((context.shipping_address as Record<string, unknown>)?.country_code as string) ||
      ""

    const merchantParams: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: terminal,
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_AMOUNT: amountStr,
      DS_MERCHANT_CURRENCY: currencyNum,
      DS_MERCHANT_TRANSACTIONTYPE: transactionType,
      DS_MERCHANT_CONSUMERLANGUAGE: "1",
      DS_MERCHANT_PAYMETHODS: BIZUM_PAY_METHOD,
    }

    if (this.options_.notificationUrl) {
      merchantParams.DS_MERCHANT_MERCHANTURL = this.options_.notificationUrl
    }

    const separator = (url: string) => url.includes("?") ? "&" : "?"
    const supportedCountryCodes = ["es", "en", "pt", "fr", "de", "it"]

    if (this.options_.successUrl) {
      let url = this.options_.successUrl
      if (countryCode && supportedCountryCodes.includes(countryCode)) {
        url = url.replace("/checkout/", "/" + countryCode + "/checkout/")
      }
      merchantParams.DS_MERCHANT_URLOK =
        url + separator(url) + "orderId=" + orderId
    }
    if (this.options_.errorUrl) {
      let url = this.options_.errorUrl
      if (countryCode && supportedCountryCodes.includes(countryCode)) {
        url = url.replace("/checkout/", "/" + countryCode + "/checkout/")
      }
      merchantParams.DS_MERCHANT_URLKO =
        url + separator(url) + "orderId=" + orderId
    }

    // Fixed positions: cartId | Medusa payment session id | Redsys order id
    merchantParams.DS_MERCHANT_MERCHANTDATA =
      `${cartId}|${medusaSessionId}|${orderId}`

    const form = await this.redsysApi.createRedirectForm(
      merchantParams as any
    )

    const sessionData: RedsysPaymentSessionData = {
      orderId,
      medusaSessionId,
      cartId: cartId || undefined,
      amount: amountStr,
      currency: currencyNum,
      currencyCode,
      status: "pending",
      transactionType,
      webhookConfirmed: false,
      merchantParams: form.body.Ds_MerchantParameters,
      signature: form.body.Ds_Signature,
      signatureVersion: form.body.Ds_SignatureVersion,
      formUrl: form.url,
    }

    if (cartId) {
      this.logger_.info("[REDSYS-BIZUM] cartId included in MerchantData: " + cartId)
    }
    if (countryCode) {
      this.logger_.info("[REDSYS-BIZUM] countryCode injected into URLs: " + countryCode)
    }
    this.logger_.info("[REDSYS-BIZUM] Redirect form created for order: " + orderId)

    return {
      id: medusaSessionId,
      data: sessionData as unknown as Record<string, unknown>,
    }
  }

  // ---------- Authorize ----------

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const sessionData =
      input.data as unknown as RedsysPaymentSessionData | undefined

    if (!sessionData?.orderId || !sessionData?.medusaSessionId) {
      return {
        status: PaymentSessionStatus.PENDING,
        data: input.data as Record<string, unknown>,
      }
    }

    // Solo se autoriza si un webhook HMAC válido confirmó esta sesión.
    if (sessionData.webhookConfirmed !== true) {
      this.logger_.warn(
        "[REDSYS-BIZUM] Session " +
          sessionData.medusaSessionId +
          " not authorized: no valid webhook confirmation for order " +
          sessionData.orderId
      )
      return {
        status: PaymentSessionStatus.PENDING,
        data: input.data as Record<string, unknown>,
      }
    }

    const status =
      sessionData.transactionType === "1"
        ? PaymentSessionStatus.AUTHORIZED
        : PaymentSessionStatus.CAPTURED

    return {
      status,
      data: {
        ...(input.data as Record<string, unknown>),
        status:
          status === PaymentSessionStatus.CAPTURED ? "captured" : "authorized",
      },
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
      isRedsysConfirmationAuthorized(String((response as any).Ds_Response))
    ) {
      sessionData.authCode = (response as any).Ds_AuthorisationCode
      this.logger_.info(
        "[REDSYS-BIZUM] Capture successful for order: " + sessionData.orderId
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

    if (isRedsysCancellationAuthorized(String((response as any).Ds_Response))) {
      sessionData.status = "cancelled"
      this.logger_.info(
        "[REDSYS-BIZUM] Payment cancelled for order: " + sessionData.orderId
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

    if (isRedsysConfirmationAuthorized(code)) {
      sessionData.status = "refunded"
      this.logger_.info(
        "[REDSYS-BIZUM] Refund processed for order: " +
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
      case "captured":
        return { status: PaymentSessionStatus.CAPTURED }
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

    if (!sessionData?.medusaSessionId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Missing Medusa payment session ID"
      )
    }

    const orderId = generateOrderId()
    const amount = this.assertPositiveAmount(input.amount)
    const amountStr = String(getSmallestUnit(amount, input.currency_code))
    const currencyNum = getCurrencyNum(input.currency_code)
    const currencyCode = input.currency_code.toLowerCase()
    const transactionType =
      this.options_.transactionType || DEFAULTS.transactionType
    const terminal = this.options_.terminal || DEFAULTS.terminal

    const cartId = sessionData.cartId || ""

    const merchantParams: Record<string, string> = {
      DS_MERCHANT_MERCHANTCODE: this.options_.merchantCode,
      DS_MERCHANT_TERMINAL: terminal,
      DS_MERCHANT_ORDER: orderId,
      DS_MERCHANT_AMOUNT: amountStr,
      DS_MERCHANT_CURRENCY: currencyNum,
      DS_MERCHANT_TRANSACTIONTYPE: transactionType,
      DS_MERCHANT_CONSUMERLANGUAGE: "1",
      DS_MERCHANT_PAYMETHODS: BIZUM_PAY_METHOD,
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

    // Fixed positions: cartId | Medusa payment session id | Redsys order id
    merchantParams.DS_MERCHANT_MERCHANTDATA =
      `${cartId}|${sessionData.medusaSessionId}|${orderId}`

    const form = await this.redsysApi.createRedirectForm(
      merchantParams as any
    )

    const newData: RedsysPaymentSessionData = {
      orderId,
      medusaSessionId: sessionData.medusaSessionId,
      cartId: cartId || undefined,
      amount: amountStr,
      currency: currencyNum,
      currencyCode,
      status: "pending",
      transactionType,
      webhookConfirmed: false,
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
        this.logger_.warn("[REDSYS-BIZUM] Webhook: invalid notification data")
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const orderId = String((notification as any).Ds_Order ?? "")
      const dsResponse = String((notification as any).Ds_Response ?? "")
      const amount = String((notification as any).Ds_Amount ?? "")
      const currencyNum = String((notification as any).Ds_Currency ?? "")
      const merchantCode = String((notification as any).Ds_MerchantCode ?? "")
      const terminal = String((notification as any).Ds_Terminal ?? "")
      const transactionType = String(
        (notification as any).Ds_TransactionType ?? ""
      )
      const authCode = String(
        (notification as any).Ds_AuthorisationCode ?? ""
      )

      let merchantData = String((notification as any).Ds_MerchantData ?? "")
      try {
        // Redsys URL-encodea el MerchantData (el "|" llega como %7C)
        merchantData = decodeURIComponent(merchantData)
      } catch {
        // ya estaba decodificado
      }
      const parts = merchantData.split("|")

      if (!orderId || parts.length !== 3) {
        this.logger_.warn(
          "[REDSYS-BIZUM] Webhook: missing order or malformed MerchantData"
        )
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const webhookSessionId = parts[1]
      const merchantOrderId = parts[2]

      const paymentSessionService = (this.container as any)
        ?.paymentSessionService

      let session: any
      try {
        session = await paymentSessionService.retrieve(webhookSessionId, {
          select: ["id", "data", "provider_id"],
        })
      } catch (error) {
        this.logger_.warn(
          "[REDSYS-BIZUM] Webhook: session not found " + webhookSessionId
        )
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      if (!session?.data) {
        this.logger_.warn(
          "[REDSYS-BIZUM] Webhook: session has no data " + webhookSessionId
        )
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      const sessionData = session.data as Record<string, any>

      const sameTerminal =
        Number.parseInt(terminal, 10) ===
        Number.parseInt(this.options_.terminal || DEFAULTS.terminal, 10)

      const validReference =
        merchantOrderId === sessionData.orderId &&
        webhookSessionId === sessionData.medusaSessionId &&
        amount === sessionData.amount &&
        currencyNum === sessionData.currency &&
        merchantCode === this.options_.merchantCode &&
        sameTerminal &&
        transactionType === sessionData.transactionType &&
        String(session.provider_id || "").startsWith(PROVIDER_PREFIX)

      if (!validReference) {
        this.logger_.error(
          "[REDSYS-BIZUM] Webhook data mismatch for order " + orderId
        )
        return { action: PaymentActions.NOT_SUPPORTED }
      }

      if (!isRedsysPaymentAuthorized(dsResponse)) {
        this.logger_.warn(
          "[REDSYS-BIZUM] Webhook: payment not authorized. Order: " +
            orderId +
            " Response: " +
            dsResponse
        )
        return { action: PaymentActions.FAILED }
      }

      await paymentSessionService.update({
        id: webhookSessionId,
        data: {
          ...sessionData,
          webhookConfirmed: true,
          responseCode: dsResponse,
          authCode,
        },
      })

      this.logger_.info(
        "[REDSYS-BIZUM] Webhook: payment authorized for order: " + orderId
      )

      const currencyCode = getCurrencyCode(currencyNum) || "eur"

      return {
        action:
          transactionType === "1"
            ? PaymentActions.AUTHORIZED
            : PaymentActions.SUCCESSFUL,
        data: {
          session_id: webhookSessionId,
          amount: getAmountFromSmallestUnit(amount, currencyCode),
        },
      }
    } catch (error) {
      this.logger_.error(
        "[REDSYS-BIZUM] Webhook error: " + (error as Error).message
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

export default RedsysBizumProviderService
