import type { GetpayinClientConfig } from './config';
import { resolveConfig } from './config';
import { Cards } from './resources/cards';
import { Invoices } from './resources/invoices';
import { Payments } from './resources/payments';
import { Recurring } from './resources/recurring';
import { Vcc } from './resources/vcc';
import { Webhooks } from './webhooks';

/**
 * The GetPayin integration client. Construct once with your integration's
 * `publicToken` and secret `hashToken`, then call the resource namespaces:
 *
 * - `invoices` — create checkouts.
 * - `payments` — void, refund, settle, reverse authorization, and check status.
 * - `vcc` — server-to-server raw-card charges.
 * - `cards` — tokenize, charge, and revoke stored cards.
 * - `recurring` — create and manage recurring mandates.
 * - `webhooks` — verify inbound webhook signatures.
 *
 * @example
 * const getpayin = new GetpayinClient({ publicToken, hashToken });
 * const { checkoutUrl } = await getpayin.invoices.create({ ... });
 */
export class GetpayinClient {
  readonly invoices: Invoices;

  readonly payments: Payments;

  readonly vcc: Vcc;

  readonly cards: Cards;

  readonly recurring: Recurring;

  readonly webhooks: Webhooks;

  constructor(config: GetpayinClientConfig) {
    const resolved = resolveConfig(config);

    this.invoices = new Invoices(resolved);
    this.payments = new Payments(resolved);
    this.vcc = new Vcc(resolved);
    this.cards = new Cards(resolved);
    this.recurring = new Recurring(resolved);
    this.webhooks = new Webhooks(resolved);
  }
}
