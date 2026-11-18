import { coerceToString } from './coerce';
import type { ResolvedConfig } from './config';
import { GetpayinError, GetpayinSignatureError } from './errors';
import { buildSignature, signaturesEqual } from './signature';
import type { WebhookEvent, WebhookPayload } from './types';

/** Always-signed webhook fields, in concatenation order (null renders as ''). */
const ALWAYS_SIGNED = ['success', 'invoice_id', 'invoice_status', 'message'] as const;

/**
 * The fields a recurring mandate adds, in the order the server adds them.
 *
 * ⚠️ Membership here is an EITHER/OR, not an additive safety net. A block is
 * appended only when its leading field is present, and each field inside it is
 * signed only when the payload carries it.
 *
 * The server signs by opt-OUT: `PaymentIntegrationWebhookJob` copies the whole
 * payload and `unset()`s a fixed exclusion list before hashing. So a new webhook
 * field is signed if it is added to `$data` before that `unset()`, and unsigned
 * if it is added after the signature is computed — which is exactly what
 * `auth_code` does, and why `auth_code` is deliberately absent from this list.
 *
 * Therefore, for any new field:
 *   - server signs it          -> it MUST be listed here, in the server's order
 *   - server sends it unsigned -> it MUST NOT be listed here
 *
 * Getting it backwards breaks verification for every webhook carrying the field,
 * in either direction. Fields outside both lists are ignored entirely, so
 * unrelated payload additions are safe.
 */
const MANDATE_SIGNED = ['mandate_id', 'external_reference', 'subscription_status'] as const;

/**
 * The fields a card-token event adds, in the order the server adds them.
 *
 * `card_token.created` and `card_token.failed` are the only events that carry a
 * tokenization, and both are on by default for every integration. The server
 * writes `tokenization_id` and `external_reference` first, then the card's
 * details — and only when the card was actually vaulted, so a failed
 * tokenization signs the first two alone.
 *
 * Order matters because the signature is a separator-less concatenation: on an
 * event with no mandate, `external_reference` is signed AFTER `tokenization_id`,
 * not at the position it holds on a subscription event.
 */
const TOKENIZATION_SIGNED = [
  'tokenization_id',
  'external_reference',
  'card_token',
  'card_brand',
  'card_last4',
  'card_exp_month',
  'card_exp_year',
] as const;

/**
 * Options for {@link Webhooks.verify}. `hashToken` overrides the client's
 * hashToken (e.g. when verifying a webhook for a different integration).
 */
export interface VerifyOptions {
  hashToken?: string;
}

export class Webhooks {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Verify an inbound webhook and return the parsed event. Accepts the parsed
   * JSON body or the raw string. Throws {@link GetpayinSignatureError} if the
   * signature is missing or does not match.
   *
   * Note: GetPayin webhook signatures carry no timestamp, so this does not
   * protect against replay — pair it with your own idempotency on `invoice_id`.
   */
  verify(payload: WebhookPayload | string, options?: VerifyOptions): WebhookEvent {
    const parsed = this.parse(payload);
    const hashToken = options?.hashToken ?? this.config.hashToken;

    const provided = parsed.signature;

    if (typeof provided !== 'string' || provided === '') {
      throw new GetpayinSignatureError('Webhook payload is missing a signature.');
    }

    if (!signaturesEqual(this.computeSignature(parsed, hashToken), provided)) {
      throw new GetpayinSignatureError();
    }

    return this.toEvent(parsed);
  }

  /** Non-throwing variant of {@link verify}. */
  isValid(payload: WebhookPayload | string, options?: VerifyOptions): boolean {
    try {
      this.verify(payload, options);

      return true;
    } catch (error) {
      if (error instanceof GetpayinSignatureError) {
        return false;
      }

      throw error;
    }
  }

  private computeSignature(payload: WebhookPayload, hashToken: string): string {
    return buildSignature(this.signedValues(payload), hashToken);
  }

  /**
   * The signed values in wire order, rebuilt the way the server assembles them.
   *
   * `PaymentIntegrationWebhookJob` appends a whole block at a time — the mandate
   * fields when the invoice belongs to one, the tokenization fields when the
   * event is about a card — and PHP keeps a key at the position it was first
   * written. A block is therefore gated on its own leading field rather than on
   * the individual fields inside it: `external_reference` belongs to whichever
   * block introduced it, and is never signed twice.
   */
  private signedValues(payload: WebhookPayload): string[] {
    const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(payload, key);
    const keys: string[] = [...ALWAYS_SIGNED];

    for (const block of [MANDATE_SIGNED, TOKENIZATION_SIGNED]) {
      if (!has(block[0])) {
        continue;
      }

      for (const key of block) {
        if (has(key) && !keys.includes(key)) {
          keys.push(key);
        }
      }
    }

    return keys.map((key) => coerceToString(payload[key]));
  }

  private parse(payload: WebhookPayload | string): WebhookPayload {
    if (typeof payload !== 'string') {
      return payload;
    }

    try {
      return JSON.parse(payload) as WebhookPayload;
    } catch (error) {
      throw new GetpayinError('Webhook payload is not valid JSON.', { cause: error });
    }
  }

  private toEvent(payload: WebhookPayload): WebhookEvent {
    return {
      event: payload.event,
      eventTriggeredAt: payload.event_triggered_at,
      timezone: payload.timezone,
      success: Number(payload.success) === 1,
      invoiceId: payload.invoice_id,
      invoiceStatus: payload.invoice_status,
      message: payload.message ?? null,
      authCode: payload.auth_code ?? null,
      mandateId: payload.mandate_id,
      externalReference: payload.external_reference,
      subscriptionStatus: payload.subscription_status,
      tokenizationId: payload.tokenization_id,
      cardToken: payload.card_token,
      cardBrand: payload.card_brand,
      cardLast4: payload.card_last4,
      cardExpMonth: payload.card_exp_month,
      cardExpYear: payload.card_exp_year,
      raw: payload,
    };
  }
}
