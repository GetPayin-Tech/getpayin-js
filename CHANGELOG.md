# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- A billing `country` is now matched without regard to case, and the upper-cased value is what gets signed and sent. `us` satisfied neither this SDK's check nor the server's, so `usState` and `postalCode` were quietly dropped and the charge reached the gateway with no address the issuer could verify — an AVS result of "not supplied" on a payment it might otherwise have approved. `US` and `us` are now the same country.
- A United States or Canadian address missing its state or postal code is refused before the request leaves, with `GetpayinValidationError` naming the field, instead of returning a 422 about a field the caller had no way to know was conditional.

### Added

- `GetpayinValidationError`, thrown when parameters cannot produce a valid call. Carries `field`, the SDK name of the offending input.
- `UsBillingAddress` and `CaBillingAddress`, for a caller who knows the country at compile time and wants the conditional fields required by the type. `BillingAddress` keeps them optional because a `country` typed as `string` satisfies every arm of a union, so TypeScript cannot express the rule on its own.

- Wallets beside the hosted card fields: `wallets` and `wallet` on `loadFields`, plus `walletready` / `walleterror` events and a `WalletMethod` type. The fields tokenise a card and nothing else, so a wallet comes from a second widget mounted beside them, offering that method alone. A payer who uses it never calls `pay()`, so its outcome arrives as a `success` or `declined` event. Google Pay works on your own origin; Apple Pay needs the domain showing the button verified with Apple first, which is a one-off step per integration.
- `success` and `declined` on `FieldsEventMap`. The SDK has always emitted them; they were missing from the type, which wallets make load-bearing because a wallet result has no promise to return through.

- Hosted card fields: a `@getpayin/getpayin/fields` entry point (`loadFields`, `loadFieldsSdk`) that mounts PayLink's card fields in your own page, fully typed, plus `mode: 'fields'` on `invoices.create` and the `fields` block it returns. It is a separate entry point because it runs in the payer's browser and must never pull in the signing code the main export holds; the browser bundle contains no reference to `hashToken`. The SDK script itself is loaded from PayLink rather than vendored, so it cannot drift from the API it talks to. Wallets stay on `checkoutUrl` — Apple Pay needs the serving domain verified, and that domain is PayLink's.
- Optional `tokenize` field on `invoices.create` (`tokenize?: boolean`), and `tokenizationId` on the result. Keeps the payer's card as well as charging it — one checkout, one authorization — instead of running a separate `cards.tokenize` and taking a second hold. Like `paymentMode` and `iframe` it is an unsigned passthrough, so adopting it does not change the string an existing integration signs; a golden-signature fixture pins that. The payer's "save my card" consent governs the card, not the sale: unticked, the payment still completes and no card is kept.
- Optional `iframe` field on `invoices.create` (`iframe?: boolean | number`). Like `paymentMode`, it is an unsigned passthrough — sent in the request body but excluded from the HMAC signature. Set `iframe: true` to request a checkout suitable for embedding.
- Retry with exponential backoff and full jitter for transient failures (429, 5xx, network errors, timeouts), honoring `Retry-After`. Only replay-safe requests are retried — GETs, calls carrying an `Idempotency-Key`, and pure reads such as `payments.checkStatus`. Charges are never replayed.
- `maxRetries` client option (default `2`; `0` disables).
- `GetpayinApiError.retryAfterMs` and `GetpayinApiError.isRateLimited`.
- `User-Agent: getpayin-js/<version> node/<version>` on every request.
- `RevokeTokenParams` type, exported.
- Tooling: ESLint, Prettier, coverage thresholds, `publint` + `attw` export validation, and a smoke test that loads the built `dist/` in both ESM and CJS.

### Fixed

- **Security:** `hashToken` was serialized in plaintext by `JSON.stringify(client)` and shown by `console.log(client)`, once per resource namespace. It is now a non-enumerable property.
- **Packaging:** CJS consumers resolved to ESM type declarations ("masquerading as ESM"). The `exports` map now declares `types` per format, pointing CJS at `index.d.cts`.
- An already-aborted `AbortSignal` was ignored and the request was sent anyway — meaning a charge could execute after the caller cancelled.

### Changed

- `timeoutMs` now applies per attempt rather than per call; with retries, total wall time can exceed it.
- `EndpointSpec` / `FieldSpec` are parameterised by the request type, so a field name that does not exist on the params interface is a compile error.

### Removed

- `refund_amount` / `refund_currency` from `WebhookPayload` and `WebhookEvent`. The server never sends them, so they were always `undefined`.

## [0.1.0]

### Added

- Initial release: checkouts, payment operations, VCC charges, card tokenization, recurring mandates, and webhook signature verification.
