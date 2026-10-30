import type { ResolvedConfig } from '../config';
import { execute } from '../http';
import { VCC_CHARGE } from '../internal/fieldOrders';
import { buildSignedBody } from '../internal/sign-request';
import type { RequestOverrides, VccChargeParams, VccChargeResult } from '../types';

interface RawVccCharge {
  invoice_id: number;
  invoice_number: string;
  amount: number;
  currency: string;
  paid_status: string;
}

export class Vcc {
  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Server-to-server card charge with raw card data
   * (`POST /api/v2/integration/vcc/charge`). Requires PCI scope to send PAN/CVV.
   *
   * A United States or Canadian billing address must carry its state and postal code; the SDK
   * throws {@link GetpayinValidationError} rather than send a charge the issuer cannot verify.
   *
   * A declined card throws {@link GetpayinApiError} carrying the gateway's reason. Treat a
   * decline as an answer, not a failed attempt: many are final — a card the issuer does not allow
   * for this kind of payment, or one its own rules refuse — and retrying under a fresh
   * `idempotencyKey` simply asks the issuer the same question again and opens another invoice.
   * Resend only what you genuinely believe could succeed, and re-use the same `idempotencyKey` to
   * replay an earlier outcome rather than charge twice.
   */
  async charge(params: VccChargeParams, overrides?: RequestOverrides): Promise<VccChargeResult> {
    const body = buildSignedBody(
      VCC_CHARGE,
      params,
      this.config.publicToken,
      this.config.hashToken,
    );

    const data = await execute<RawVccCharge>(this.config, {
      method: 'POST',
      path: VCC_CHARGE.path,
      body,
      idempotencyKey: overrides?.idempotencyKey,
      signal: overrides?.signal,
    });

    return {
      invoiceId: data.invoice_id,
      invoiceNumber: data.invoice_number,
      amount: data.amount,
      currency: data.currency,
      paidStatus: data.paid_status,
    };
  }
}
