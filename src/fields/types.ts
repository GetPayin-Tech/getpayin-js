/**
 * Types for the hosted card fields, which run in the payer's browser.
 *
 * Nothing here touches the client's credentials. The rest of this package is server-side and
 * holds the `hashToken`; the fields hold a short-lived client token minted per payment by
 * `invoices.create({ mode: 'fields' })`, so a token lifted from one checkout cannot be pointed
 * at another. Keep the two apart — importing this module does not pull the signing code with it.
 */

/** Which of the two hosted inputs an event concerns. */
export type FieldName = 'number' | 'securityCode';

/**
 * Where the attempt has got to. `setup` and `challenge` are the two halves of 3-D Secure — the
 * silent device check, then the bank's own step-up if it asks for one — and `charging` is the
 * authorization itself. Use them to drive a spinner's wording; a payer waiting on an SMS code
 * should not be looking at "Processing payment".
 */
export type FieldsStage = 'setup' | 'challenge';

export interface FieldsReadyEvent {
  amountMinor: number;
  currency: string;
}

export interface FieldsChangeEvent {
  field: FieldName;
  state: unknown;
}

export interface FieldsFocusEvent {
  field: FieldName;
}

export interface FieldsAuthenticatingEvent {
  stage: FieldsStage;
}

/**
 * The events the fields emit, by name. `error` carries whatever the SDK threw; a listener that
 * throws is swallowed, so a broken handler cannot take the payment down with it.
 */
export interface FieldsEventMap {
  ready: FieldsReadyEvent;
  change: FieldsChangeEvent;
  focus: FieldsFocusEvent;
  blur: FieldsFocusEvent;
  authenticating: FieldsAuthenticatingEvent;
  charging: Record<string, never>;
  success: FieldsPayResult;
  declined: FieldsPayResult;
  walletready: FieldsWalletReadyEvent;
  walleterror: unknown;
  error: unknown;
}

export type FieldsEventName = keyof FieldsEventMap;

/**
 * Options for `fields()`.
 *
 * `number` and `securityCode` are CSS selectors for two empty elements you place and size
 * yourself; CyberSource loads an iframe into each, which is why the card never reaches your DOM.
 * Everything around them is yours — labels, layout, the expiry input, the pay button.
 *
 * `styles` is passed to the CyberSource Microform and is what makes the inputs match the rest of
 * your form; it takes CSS-like declarations keyed by state (`input`, `:focus`, `:disabled`,
 * `::placeholder`, `.invalid`). `numberOptions` and `securityCodeOptions` go to the individual
 * fields, for per-field settings such as a placeholder.
 *
 * `apiBase` only needs setting when the page is not served from the same origin as PayLink.
 *
 * `wallets` asks for a wallet widget beside the card inputs, rendered into the container named by
 * `wallet`. The card fields cannot present a wallet themselves, so this is a second widget with
 * its own capture context, offering the wallet alone. Both are needed: naming wallets without a
 * container, or a container without wallets, leaves the card fields on their own.
 *
 * A payer who uses the wallet never touches `pay()`, so its outcome arrives as a `success` or
 * `declined` event rather than a returned promise. Listen for both.
 */
export interface FieldsOptions {
  clientToken: string;
  number: string;
  securityCode: string;
  apiBase?: string;
  styles?: Record<string, Record<string, string>>;
  numberOptions?: Record<string, unknown>;
  securityCodeOptions?: Record<string, unknown>;
  wallets?: WalletMethod[];
  wallet?: string;
}

/**
 * Wallets the fields can put beside the card inputs.
 *
 * Google Pay alone. Apple Pay needs its domain-association file served from the domain showing
 * the button, and that domain is PayLink's rather than yours, so an Apple Pay button on your page
 * would fail Apple's own check — it stays on the hosted `checkoutUrl`.
 */
export type WalletMethod = 'GOOGLEPAY';

/** The wallet widget is up and offering these methods. Nothing has been charged. */
export interface FieldsWalletReadyEvent {
  paymentTypes: WalletMethod[];
}

/** The card's expiry, as the payer typed it. A two-digit year is expanded to four. */
export interface CardExpiry {
  expirationMonth: string | number;
  expirationYear: string | number;
}

/**
 * The outcome of an attempt.
 *
 * A refusal resolves rather than rejects — a declined card is an answer, not an exception — so
 * branch on `success`. Send an approved payer to `returnUrl`. A rejection means the attempt could
 * not be completed at all: invalid input, an abandoned challenge, or a session that is finished.
 */
export interface FieldsPayResult {
  success: boolean;
  message: string | null;
  reasonCode: string | null;
  invoiceId: number | null;
  paidStatus: string | null;
  returnUrl: string | null;
}

/**
 * A mounted set of card fields.
 *
 * `mount()` resolves with the amount actually being charged, in the currency's minor units, which
 * is what to label the pay button with when a currency conversion applied. It refuses a second
 * call: a second set of iframes stacks a dead one over the live one, and the payer's card would
 * be typed into whichever happened to be on top.
 */
export interface FieldsInstance {
  version: string;
  on<E extends FieldsEventName>(
    event: E,
    handler: (payload: FieldsEventMap[E]) => void,
  ): FieldsInstance;
  mount(): Promise<FieldsReadyEvent>;
  pay(expiry: CardExpiry): Promise<FieldsPayResult>;
  destroy(): void;
}

/**
 * Why an attempt could not be completed.
 *
 * `fields_unavailable`, `fields_unsupported`, `session_invalid` and `origin_not_allowed` mean
 * stop and send the payer to the `checkoutUrl` that `invoices.create` returned alongside the
 * token. Every other code concerns this attempt alone and can be retried on the same mounted
 * fields.
 */
export interface FieldsErrorLike extends Error {
  code?: string;
  details?: unknown;
}
