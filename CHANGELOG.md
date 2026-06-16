# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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