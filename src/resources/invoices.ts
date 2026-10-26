import type { ResolvedConfig } from '../config';
import { execute } from '../http';
import { INVOICE_CREATE } from '../internal/fieldOrders';
import { buildSignedBody } from '../internal/sign-request';
import type { CreateInvoiceParams, CreateInvoiceResult, RequestOverrides } from '../types';

interface RawCheckout {
  checkout_url: string;
  invoice_id: number;
  expires_at: string;
  tokenization_id?: string;
}

export class Invoices {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Create an invoice and return a temporary signed checkout URL
   * (`POST /api/v2/integration/init`). Redirect the payer to `checkoutUrl`.
   *
   * Pass `tokenize: true` to keep the payer's card as well as charging it; the
   * result then carries a `tokenizationId` and the card arrives on the
   * `card_token.created` webhook. Refused with 403 when the account is not
   * allowed to store cards, and with 422 when combined with hosted fields.
   */
  async create(
    params: CreateInvoiceParams,
    overrides?: RequestOverrides,
  ): Promise<CreateInvoiceResult> {
    const body = buildSignedBody(
      INVOICE_CREATE,
      params,
      this.config.publicToken,
      this.config.hashToken,
    );

    const data = await execute<RawCheckout>(this.config, {
      method: 'POST',
      path: INVOICE_CREATE.path,
      body,
      idempotencyKey: overrides?.idempotencyKey,
      signal: overrides?.signal,
    });

    const result: CreateInvoiceResult = {
      checkoutUrl: data.checkout_url,
      invoiceId: data.invoice_id,
      expiresAt: String(data.expires_at),
    };

    if (data.tokenization_id !== undefined && data.tokenization_id !== null) {
      result.tokenizationId = String(data.tokenization_id);
    }

    return result;
  }
}
