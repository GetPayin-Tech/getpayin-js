# @getpayin/getpayin

[![CI](https://github.com/GetPayin-Tech/getpayin-js/actions/workflows/ci.yml/badge.svg)](https://github.com/GetPayin-Tech/getpayin-js/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getpayin/getpayin.svg)](https://www.npmjs.com/package/@getpayin/getpayin)
[![install size](https://packagephobia.com/badge?p=@getpayin/getpayin)](https://packagephobia.com/result?p=@getpayin/getpayin)

Official **server-side** Node.js/TypeScript SDK for the GetPayin payment
integration API. It wraps every integration endpoint with an idiomatic, typed
API and computes the order-sensitive HMAC-SHA256 signatures for you, so you
never have to build them by hand.

- Checkouts (`invoices.create`)
- Payment operations (`payments.void` / `refund` / `settle` / `reverseAuthorization` / `checkStatus`)
- Server-to-server card charges (`vcc.charge`)
- Card tokenization (`cards.tokenize` / `charge` / `revoke`)
- Recurring mandates (`recurring.create` / `status` / `cancel` / `pause` / `resume`)
- Webhook signature verification (`webhooks.verify`)

> **Server-side only.** Signing uses your secret `hashToken`. Never ship it to a
> browser or mobile client.

## Requirements

- Node.js **18+** (uses the built-in global `fetch` and `node:crypto`).
  Node 18 reached end-of-life in April 2025 — it is still supported and tested
  here, but new projects should be on 20 or 22.
- Zero runtime dependencies
- Ships ESM and CommonJS builds with per-format type declarations

## Install

```bash
npm install @getpayin/getpayin
```

## Quick start

```ts
import { GetpayinClient } from '@getpayin/getpayin';

const getpayin = new GetpayinClient({
  publicToken: process.env.GETPAYIN_PUBLIC_TOKEN!,
  hashToken: process.env.GETPAYIN_HASH_TOKEN!, // secret — server-side only
  // baseUrl defaults to https://pay.getpayin.com
  // timeoutMs defaults to 30000 (per attempt)
  // maxRetries defaults to 2 (set 0 to disable retries)
});

const checkout = await getpayin.invoices.create({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  orderTitle: 'Gold Plan',
  orderAmount: '250.00', // pass amounts as strings to control the exact wire form
  currency: 'USD',
  redirectionUrl: 'https://shop.example.com/return',
  webhookUrl: 'https://shop.example.com/webhooks/getpayin',
});

// Redirect the payer to the hosted checkout:
console.log(checkout.checkoutUrl, checkout.invoiceId, checkout.expiresAt);
```

Pass `iframe: true` to receive a `checkoutUrl` suitable for embedding — for
example rendering the hosted checkout inside an `<iframe>` on your own page
instead of a full-page redirect:

```ts
const embedded = await getpayin.invoices.create({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  orderTitle: 'Gold Plan',
  orderAmount: '250.00',
  currency: 'USD',
  iframe: true, // optional, unsigned passthrough (like paymentMode)
});
```

Then embed the returned checkout URL on your page. The `<iframe>` needs `allow="payment *"` so Apple Pay and Google Pay work inside the frame, and your page must listen for the completion message — in iframe mode the checkout signals the parent via `postMessage` instead of redirecting:

```html
<iframe
  src="CHECKOUT_URL"
  allow="payment *"
  style="width:100%;min-height:640px;border:0"
  title="Secure checkout"
></iframe>
<script>
  addEventListener('message', function (e) {
    if (e.origin !== 'https://pay.getpayin.com') return; // your API base origin
    if (!e.data || e.data.type !== 'getpayin_payment') return;
    window.location.href = e.data.success ? '/thank-you' : '/checkout?failed=1';
  });
</script>
```

> The embedding page's origin must exactly match your integration's registered **Origin**, or the browser blocks framing and the message never arrives.

Both credentials are issued in the GetPayin dashboard under
**Settings → Payment Integrations**. `publicToken` is sent on every request;
`hashToken` is the secret used only to sign — it never leaves your server.

## Payment operations

```ts
await getpayin.payments.void({ invoiceId });
await getpayin.payments.settle({ invoiceId, amount: '50.00' });
await getpayin.payments.reverseAuthorization({ invoiceId });

const status = await getpayin.payments.checkStatus({ invoiceId });
// { invoiceId, paidStatus, authCode }

// Refunds are idempotent when you pass an idempotency key — safe to retry:
const refund = await getpayin.payments.refund(
  { invoiceId, amount: '10.50' },
  { idempotencyKey: 'refund-order-1234' },
);
// { invoiceId, paidStatus, authCode, refundAmount }
```

## Card tokenization

```ts
const { token } = await getpayin.cards.tokenize({
  firstName: 'Jane',
  lastName: 'Doe',
  cardNumber: '4111111111111111',
  cardExpiryMonth: '12',
  cardExpiryYear: '2030',
  cardCvv: '123',
  country: 'EG',
  address: '1 Main St',
  city: 'Cairo',
});

await getpayin.cards.charge({
  cardToken: token,
  initiator: 'merchant',
  firstName: 'Jane',
  lastName: 'Doe',
  currency: 'USD',
  price: '100.00',
  product: 'Monthly rebill',
  country: 'EG',
  address: '1 Main St',
  city: 'Cairo',
});

await getpayin.cards.revoke({ cardToken: token });
```

For `US` and `CA` billing addresses, also pass the state fields the API
requires: `usState` + `postalCode` (US) or `canadaState` + `postalCode` (CA).

### Keeping the card on a payment the payer is already making

When the payer is buying something, you do not need a separate run to store
their card. Pass `tokenize: true` to `invoices.create` and one checkout does
both — one authorization, the sale stands, and the card is vaulted off it.

```ts
const checkout = await getpayin.invoices.create({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  orderTitle: 'Order #4120',
  orderAmount: '250.00',
  currency: 'EGP',
  tokenize: true,
});

// checkout.tokenizationId identifies the run; the card itself arrives on the
// card_token.created webhook, and you charge it later with cards.charge.
```

`tokenize` is **not part of the signature**, so an integration already live can
start sending it without touching its signing code.

The payer ticks a "save my card" consent on the checkout. It governs the card,
not the sale: leaving it unticked still completes the payment and simply keeps
no card. You hear either way — `card_token.created` carries the token, and a run
that ends without one raises `card_token.failed`. Correlate both to the order by
`invoice_id`.

Requires card tokenization to be enabled for your account, and the account to be
on Cybersource Unified Checkout. The call is refused with `403` otherwise, and
with `422` if combined with hosted card fields; no invoice is created when it is
refused.

## Hosted card fields

Collect the card on your own page instead of sending the payer to the hosted
checkout. The card number and security code are rendered by CyberSource inside
iframes, so no card data reaches your DOM, your JavaScript or your servers —
but your page owns the form, which moves you from **PCI SAQ A to SAQ A-EP**.
Confirm that is acceptable to your acquirer before building.

On your server, ask for a fields session:

```ts
const checkout = await getpayin.invoices.create({
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  orderTitle: 'Order #4120',
  orderAmount: '250.00',
  currency: 'EGP',
  mode: 'fields',
});

// Safe to put in the page — it names this one payment and nothing else.
const clientToken = checkout.fields!.clientToken;
```

In the browser, from the separate `/fields` entry point:

```ts
import { loadFields } from '@getpayin/getpayin/fields';

const fields = await loadFields({
  clientToken,
  number: '#card-number',
  securityCode: '#card-cvc',
  styles: { input: { 'font-size': '16px', color: '#111' } },
});

const { amountMinor, currency } = await fields.mount();

const result = await fields.pay({ expirationMonth: '04', expirationYear: '2030' });

if (result.success) {
  window.location.href = result.returnUrl!;
}
```

`pay()` **resolves** for a decline as well as an approval — a refused card is an
answer, not an exception — so branch on `result.success`. It rejects only when
the attempt could not be completed at all.

Every rejection carries a `code`. Treat `fields_unavailable`,
`fields_unsupported`, `session_invalid` and `origin_not_allowed` as "stop and
send the payer to `checkout.checkoutUrl`"; anything else concerns that attempt
alone and can be retried on the same mounted fields.

A few things worth knowing:

- **`@getpayin/getpayin/fields` is a separate entry point on purpose.** The main
  export is server-side and holds your `hashToken`; this one runs in the payer's
  browser and must never see it. Importing one does not pull in the other.
- **The SDK script is fetched from PayLink, not bundled here.** It is versioned
  alongside the API it talks to, and the card iframes have to come from the
  origin your capture context was issued for. Pass `apiBase` when your page is
  not served from the same origin as PayLink.
- **Wallets come from a second widget beside the card fields**, not from the
  fields themselves — they tokenise a card and nothing else. Name the wallets
  and a container and PayLink mounts one for them alone:

  ```ts
  const fields = await loadFields({
    clientToken,
    number: '#card-number',
    securityCode: '#card-cvc',
    wallets: ['GOOGLEPAY'],
    wallet: '#wallet-button',
  });

  fields.on('success', (result) => {
    window.location.href = result.returnUrl!;
  });
  ```

  A payer who uses the wallet never calls `pay()`, so its outcome arrives as a
  `success` or `declined` event rather than a returned promise.

  **Google Pay works on your origin as it stands. Apple Pay needs your domain
  verified first** — Apple fetches an association file from the domain showing
  the button, and that domain is yours, not PayLink's. Ask PayLink for the file,
  serve it at your own `/.well-known/apple-developer-merchantid-domain-association`,
  and `'APPLEPAY'` is accepted once they have confirmed it. Until then it is
  quietly dropped and the card fields are unaffected. `checkoutUrl` remains the
  fallback for any browser that cannot run either.

- Hosted fields need a **registered origin** on your integration and the feature
  enabled for your account.

## Recurring mandates

```ts
const mandate = await getpayin.recurring.create(
  {
    firstName: 'Sam',
    lastName: 'Doe',
    email: 'sam@example.com',
    orderTitle: 'Gold subscription',
    orderAmount: '250.00',
    currency: 'USD',
    cadenceInterval: 'month',
    cadenceCount: 1,
    totalCycles: 12,
    consentText: 'I authorise recurring monthly charges.',
  },
  { idempotencyKey: 'sub-signup-42' },
);

await getpayin.recurring.status(mandate.mandateId);
await getpayin.recurring.pause(mandate.mandateId);
await getpayin.recurring.resume(mandate.mandateId);
await getpayin.recurring.cancel(mandate.mandateId);
```

## Idempotency

Retrying a write after a network error or timeout risks performing it twice. To
make that safe, pass an `idempotencyKey` in the per-call overrides — the SDK
sends it as the `Idempotency-Key` header and the server returns the original
result instead of charging, refunding, or creating a second time. Keys are
scoped per integration and capped at 64 characters.

| Endpoint           | A replay with the same key returns     |
| ------------------ | -------------------------------------- |
| `invoices.create`  | the original invoice and `checkoutUrl` |
| `vcc.charge`       | the original charge                    |
| `cards.charge`     | the original charge                    |
| `payments.refund`  | the original refund                    |
| `recurring.create` | the original mandate                   |

```ts
await getpayin.vcc.charge({/* card + order fields */}, { idempotencyKey: 'vcc-order-1234' });
await getpayin.cards.charge({/* token + order fields */}, { idempotencyKey: 'tok-order-1234' });
await getpayin.invoices.create({/* customer + order fields */}, { idempotencyKey: 'order-1234' });
```

Reusing a key with a _different_ request — for example `recurring.create` with
changed terms, or `payments.refund` for a different amount — is rejected as a
conflict: a `GetpayinApiError` with `isIdempotencyConflict` set (HTTP 409). Only
the endpoints above honor the header.

## Verifying webhooks

Pass the **parsed JSON body** (or the raw string) to `verify`. It recomputes the
signature with your `hashToken` and compares in constant time.

```ts
import express from 'express';
import { GetpayinClient, GetpayinSignatureError } from '@getpayin/getpayin';

const getpayin = new GetpayinClient({ publicToken, hashToken });
const app = express();

app.post('/webhooks/getpayin', express.json(), (req, res) => {
  try {
    const event = getpayin.webhooks.verify(req.body);
    // event.event, event.invoiceId, event.success, event.raw, ...
    res.sendStatus(200);
  } catch (error) {
    if (error instanceof GetpayinSignatureError) {
      return res.sendStatus(400);
    }
    throw error;
  }
});
```

> GetPayin webhook signatures carry no timestamp, so verification does not protect
> against replay. Pair it with your own idempotency keyed on `invoice_id`.

## Error handling

Every failure is a subclass of `GetpayinError`:

| Error                     | When                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GetpayinConfigError`     | Invalid client configuration (missing tokens, no `fetch`).                                                                                                                                                                              |
| `GetpayinApiError`        | The API returned an error. Carries `status`, `errors`, `raw`, `retryAfterMs`, `isIdempotencyConflict` (409), `isRateLimited` (429), and `isForbidden` (403 — e.g. card tokenization or recurring payments not enabled for the account). |
| `GetpayinSignatureError`  | A webhook signature did not verify.                                                                                                                                                                                                     |
| `GetpayinConnectionError` | Network failure or timeout (no HTTP response).                                                                                                                                                                                          |

```ts
import { GetpayinApiError } from '@getpayin/getpayin';

try {
  await getpayin.payments.refund({ invoiceId, amount: '10.00' });
} catch (error) {
  if (error instanceof GetpayinApiError && error.isIdempotencyConflict) {
    // a refund with this idempotency key already exists
  }
}
```

## Retries and rate limiting

Every integration endpoint is rate limited server-side, so 429s are an expected
condition under burst traffic rather than an edge case. The SDK retries
transient failures — **429, 5xx, network errors, and timeouts** — with
exponential backoff and full jitter, honoring the server's `Retry-After` header
when present.

**A request is only ever replayed when replaying it cannot double-charge:**

| Replayed                                 | Not replayed                                        |
| ---------------------------------------- | --------------------------------------------------- |
| All `GET`s (`recurring.status`)          | `vcc.charge`, `cards.charge`, `cards.tokenize`      |
| Any call you pass an `idempotencyKey` to | `invoices.create`, `recurring.create` without a key |
| `payments.checkStatus` (a pure read)     | `recurring.cancel` / `pause` / `resume`             |

So to make a refund safely retryable, pass an idempotency key — otherwise a
failed refund surfaces immediately and is yours to handle:

```ts
await getpayin.payments.refund(
  { invoiceId, amount: '10.50' },
  { idempotencyKey: 'refund-order-1234' }, // now retried on 429/5xx
);
```

Tune or disable retries per client:

```ts
new GetpayinClient({ publicToken, hashToken, maxRetries: 0 }); // off
```

`timeoutMs` applies to **each attempt**, so worst-case wall time is roughly
`(maxRetries + 1) × timeoutMs` plus backoff. For requests the SDK will not
replay, `GetpayinApiError.retryAfterMs` exposes the server's backoff hint so you
can schedule your own retry:

```ts
catch (error) {
  if (error instanceof GetpayinApiError && error.isRateLimited) {
    await enqueueAfter(error.retryAfterMs ?? 1000);
  }
}
```

## Amounts and precision

Signatures are computed over the exact bytes sent on the wire. To avoid any
floating-point ambiguity, **pass monetary amounts as strings** (e.g. `'10.50'`).
Numbers are accepted and stringified, but strings give you full control.

## API reference

The full HTTP API — endpoints, fields, error codes, and test cards — is
documented in the GetPayin API reference:
<https://pay.getpayin.com/docs/payment_integration/index.html>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — in particular the note on signed-field
ordering, which is the one thing that must stay in lockstep with the server.

Security issues: see [SECURITY.md](SECURITY.md). Please do not open a public
issue for a vulnerability.

## License

MIT
