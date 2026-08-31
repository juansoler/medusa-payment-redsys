# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-08-31

### Security

- `authorizePayment()` no longer authorizes `pending` (or forged `authorized`) sessions. A payment is only authorized after an HMAC-confirmed webhook that fully matches the stored payment reference.
- Webhooks are correlated with the real Medusa payment session ID (`payses_...`) instead of an artificial `redsys_*` ID, so Medusa's `processPaymentWorkflow` can find the payment/session.
- Webhook validation now checks order, amount, currency, provider, merchant, terminal and transaction type against the reference stored at `initiatePayment`/`updatePayment` time.
- A new `redsys_payment_reference` table (created lazily via `pgConnection`) prevents replaying previously confirmed `orderId`s.
- `generateOrderId()` now uses `node:crypto` `randomInt` instead of `Math.random()`.
- `getCurrencyNum()` throws on unsupported currencies instead of silently falling back to EUR.

### Fixed

- Webhook `Ds_Amount` (smallest unit, e.g. `"2550"`) is normalized back to the main unit (`25.5`) before being passed to Medusa.
- Webhook action is `AUTHORIZED` for preauthorizations (tx `1`) and `SUCCESSFUL` for immediate captures (tx `0`).
- Strict Redsys response-code validation: payment 4-digit codes 0000-0099, confirmation/refund code 900, cancellation code 400.
- `updatePayment()` generates a fresh `orderId` and keeps MerchantData at a fixed 3-position layout (`cartId|sessionId|orderId`).
- `refundPayment()` no longer accepts generic `00xx` codes.
- Storefront flow no longer creates the order before the payment (see `examples/storefront-redsys.md`).

## [1.0.12] - 2026-05-13

### Fixed

- Response code validation: payments now correctly accept codes 0000-0099 (was incorrectly validating)
- `isRedsysPaymentAuthorized()`: accepts codes 0-99 for payment authorization
- `isRedsysRefundOrConfirmationAuthorized()`: accepts code 900 for refund/confirmation
- `isRedsysCancellationAuthorized()`: accepts code 400 for cancellation
- Types: Updated `signatureVersion` comment to clarify actual signature uses HMAC-SHA256 (v1 identifier is returned by redsys-es library)

## [1.0.11] - 2025-10-15

### Fixed

- Webhook handler: FAILED webhook action no longer includes extra fields (Medusa types constraint)

## [1.0.0] - 2025-05-05

### Added

- Initial release of Redsys payment plugin for MedusaJS v2
- Redsys hosted payment page / TPV Virtual redirect flow
- One-step payment (immediate capture) with transactionType "0"
- Two-step payment (pre-authorization) with transactionType "1"
- Full and partial refunds via Redsys REST API
- Payment cancellation (void) support
- Webhook notification handling with HMAC-SHA256 signature verification
- Sandbox and production environment support
- Spanish error messages for Redsys response codes
- Comprehensive type definitions (RedsysOptions, RedsysPaymentSessionData)
- Utility modules for amount conversion, currency mapping, order ID generation, and error messages
- Unit tests with vitest, following Medusa v2 community patterns