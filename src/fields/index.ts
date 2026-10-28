/// <reference lib="dom" />

/*
 * The DOM lib is pulled in here and nowhere else. The rest of this package is Node-side and
 * holds the hashToken, so `lib` stays ES2022 there on purpose — code that signs a request has no
 * business reaching for `document`, and leaving the lib out is what keeps that a compile error.
 */
import type { FieldsInstance, FieldsOptions } from './types';

export type {
  CardExpiry,
  FieldName,
  FieldsAuthenticatingEvent,
  FieldsChangeEvent,
  FieldsErrorLike,
  FieldsEventMap,
  FieldsEventName,
  FieldsFocusEvent,
  FieldsInstance,
  FieldsOptions,
  FieldsPayResult,
  FieldsReadyEvent,
  FieldsStage,
} from './types';

/** The canonical SDK, served by PayLink itself rather than bundled here — see `loadFields`. */
const SDK_PATH = '/sdk/paylink-fields-v1.js';

interface PayLinkGlobal {
  fields(options: FieldsOptions): FieldsInstance;
  version?: string;
}

declare global {
  interface Window {
    PayLink?: PayLinkGlobal;
  }
}

/** Options for {@link loadFields}; `apiBase` is also where the script itself is fetched from. */
export interface LoadFieldsOptions extends FieldsOptions {
  apiBase?: string;
}

/**
 * Null in a browser, an Error anywhere else.
 *
 * Returned rather than thrown so the caller sees a rejected promise: this function's contract is
 * a promise, and a synchronous throw would slip straight past a `.catch()`.
 */
function browserMissing(): Error | null {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return null;
  }

  return new Error(
    'Hosted card fields run in the browser. Import @getpayin/getpayin/fields from client code, not from your server.',
  );
}

function existingScript(src: string): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
}

/**
 * Fetch the hosted-fields SDK once and hand back the global it defines.
 *
 * The script is loaded from PayLink rather than bundled into this package on purpose. It is
 * versioned and served alongside the API it talks to, so a protocol change ships to every
 * integration at once; a copy vendored into an npm release would drift the moment a caller
 * pinned an old version, and the card iframes it mounts have to come from the origin the capture
 * context was issued for in any case.
 *
 * Concurrent calls share one script tag and one promise, so mounting two forms on a page — or a
 * double-invoked effect in React — does not load it twice.
 */
let loading: Promise<PayLinkGlobal> | null = null;

export function loadFieldsSdk(apiBase?: string): Promise<PayLinkGlobal> {
  const unavailable = browserMissing();

  if (unavailable) {
    return Promise.reject(unavailable);
  }

  if (window.PayLink?.fields) {
    return Promise.resolve(window.PayLink);
  }

  if (loading) {
    return loading;
  }

  const src = `${(apiBase ?? '').replace(/\/+$/, '')}${SDK_PATH}`;

  loading = new Promise<PayLinkGlobal>((resolve, reject) => {
    const settle = (): void => {
      if (window.PayLink?.fields) {
        resolve(window.PayLink);

        return;
      }

      loading = null;
      reject(new Error(`Loaded ${src} but it did not define PayLink.fields.`));
    };

    const tag = existingScript(src) ?? document.createElement('script');

    tag.addEventListener('load', settle, { once: true });
    tag.addEventListener(
      'error',
      () => {
        loading = null;
        reject(new Error(`Could not load the hosted card fields SDK from ${src}.`));
      },
      { once: true },
    );

    if (tag.isConnected) {
      return;
    }

    tag.src = src;
    tag.async = true;
    document.head.appendChild(tag);
  });

  return loading;
}

/**
 * Mount PayLink's hosted card fields in your own page.
 *
 * Pass the `clientToken` from `invoices.create({ mode: 'fields' })`. The card number and security
 * code are rendered by CyberSource inside iframes in the two containers you name, so no card data
 * reaches your DOM, your JavaScript or your servers — but your page owns the form, which moves
 * you from PCI SAQ A to SAQ A-EP. Confirm that is acceptable to your acquirer before building.
 *
 * ```ts
 * const fields = await loadFields({
 *   clientToken,
 *   number: '#card-number',
 *   securityCode: '#card-cvc',
 *   styles: { input: { 'font-size': '16px', color: '#111' } },
 * });
 *
 * const { amountMinor, currency } = await fields.mount();
 * const result = await fields.pay({ expirationMonth: '04', expirationYear: '2030' });
 *
 * if (result.success) {
 *   window.location.href = result.returnUrl!;
 * }
 * ```
 *
 * Wallets are not available here — Apple Pay needs the domain serving the button verified with
 * Apple, which is PayLink's — so keep the `checkoutUrl` that came back beside the token as the
 * route for those and as the fallback whenever this throws a terminal code.
 */
export async function loadFields(options: LoadFieldsOptions): Promise<FieldsInstance> {
  const sdk = await loadFieldsSdk(options.apiBase);

  return sdk.fields(options);
}
