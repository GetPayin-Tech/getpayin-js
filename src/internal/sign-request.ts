import { coerceToString } from '../coerce';
import { GetpayinValidationError } from '../errors';
import { buildSignature } from '../signature';
import type { BillingAddress } from '../types';
import type { EndpointSpec } from './fieldOrders';

type Append = (value: unknown, wireKey: string, signed: boolean) => void;

/**
 * Turn a camelCase SDK request object into the signed wire body for an
 * {@link EndpointSpec}. The returned object is ready to POST as JSON: it
 * contains the endpoint's fields (snake_case), the public `token`, and the
 * computed `signature`.
 *
 * The signature is built from the same coerced strings that go into the body,
 * in the spec's order, skipping fields the caller did not provide — exactly how
 * the server reconstructs it from `Arr::except($request->validated(), ...)`.
 */
export function buildSignedBody<P extends object>(
  spec: EndpointSpec<P>,
  input: P,
  publicToken: string,
  hashToken: string,
): Record<string, string> {
  const signedValues: string[] = [];
  const body: Record<string, string> = {};

  const append: Append = (value, wireKey, signed) => {
    if (value === undefined || value === null) {
      return;
    }

    const stringValue = coerceToString(value);
    body[wireKey] = stringValue;

    if (signed) {
      signedValues.push(stringValue);
    }
  };

  const params = spec.countryStateBlock ? withNormalizedCountry(input) : input;

  for (const field of spec.fields) {
    append(params[field.sdk], field.wire, field.signed !== false);
  }

  if (spec.countryStateBlock) {
    const address = params as Partial<BillingAddress>;

    assertCountryStateBlock(address);
    appendCountryStateBlock(address, append);
  }

  const signature = buildSignature(signedValues, hashToken);

  return { ...body, token: publicToken, signature };
}

/**
 * Upper-case the billing country so the United States and Canada are recognised however the
 * caller spelled them.
 *
 * The country is matched exactly here and again on the server, so `us` used to satisfy neither:
 * the state and postal code were quietly left out of the request, and the charge reached the
 * gateway with no address for the issuer to verify. The two spellings now mean the same country,
 * and the upper-cased value is the one signed and sent, so the server rebuilds the same signature.
 */
function withNormalizedCountry<P extends object>(input: P): P {
  const country = (input as Partial<BillingAddress>).country;

  if (typeof country !== 'string') {
    return input;
  }

  const normalized = country.trim().toUpperCase();

  return normalized === country ? input : { ...input, country: normalized };
}

/**
 * Refuse a United States or Canadian billing address that is missing the state or postal code the
 * gateway checks against the card, naming the field that is absent.
 *
 * Failing here rather than at the server turns a 422 about a field the caller did not know was
 * conditional into a message that names it, and it is the only guard that holds: the types cannot
 * express "required when country is US", because a country typed as `string` satisfies every arm
 * of a union.
 */
function assertCountryStateBlock(input: Partial<BillingAddress>): void {
  if (input.country === 'US') {
    requirePresent(input.usState, 'usState', 'United States');
    requirePresent(input.postalCode, 'postalCode', 'United States');

    return;
  }

  if (input.country === 'CA') {
    requirePresent(input.canadaState, 'canadaState', 'Canadian');
    requirePresent(input.postalCode, 'postalCode', 'Canadian');
  }
}

function requirePresent(value: string | undefined, field: string, country: string): void {
  if (typeof value === 'string' && value.trim() !== '') {
    return;
  }

  throw new GetpayinValidationError(
    `A ${country} billing address requires \`${field}\`; the card issuer checks it against the card.`,
    field,
  );
}

function appendCountryStateBlock(input: Partial<BillingAddress>, append: Append): void {
  if (input.country === 'US') {
    append(input.usState, 'us_state', true);
    append(input.postalCode, 'postal_code', true);

    return;
  }

  if (input.country === 'CA') {
    append(input.canadaState, 'canada_state', true);
    append(input.postalCode, 'postal_code', true);
  }
}
