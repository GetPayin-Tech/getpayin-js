import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FieldsModule from '../src/fields/index';

/**
 * The hosted card fields entry point.
 *
 * It deliberately loads the canonical SDK from PayLink rather than bundling a copy: the script is
 * versioned alongside the API it talks to, and the card iframes it mounts have to come from the
 * origin the capture context was issued for. So what is worth testing here is the loading
 * contract — that it runs only in a browser, injects once, and hands the options through
 * untouched.
 */

interface FakeScript {
  src: string;
  async: boolean;
  isConnected: boolean;
  listeners: Record<string, Array<() => void>>;
  addEventListener(event: string, handler: () => void, options?: unknown): void;
}

function fakeScript(): FakeScript {
  return {
    src: '',
    async: false,
    isConnected: false,
    listeners: {},
    addEventListener(event, handler) {
      this.listeners[event] = (this.listeners[event] ?? []).concat(handler);
    },
  };
}

function installDom(existing: FakeScript | null = null): {
  created: FakeScript[];
  appended: FakeScript[];
} {
  const created: FakeScript[] = [];
  const appended: FakeScript[] = [];

  (globalThis as Record<string, unknown>).window = {};
  (globalThis as Record<string, unknown>).document = {
    querySelector: () => existing,
    createElement: () => {
      const tag = fakeScript();
      created.push(tag);

      return tag;
    },
    head: {
      appendChild: (tag: FakeScript) => {
        tag.isConnected = true;
        appended.push(tag);
      },
    },
  };

  return { created, appended };
}

function clearDom(): void {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
}

/** Fresh module each time: the loader memoises its in-flight promise at module scope. */
async function freshModule(): Promise<typeof FieldsModule> {
  vi.resetModules();

  return import('../src/fields/index');
}

afterEach(() => {
  clearDom();
});

describe('loadFieldsSdk', () => {
  /**
   * Importing this from a server is a mistake worth naming, not a stack trace about `document`.
   * The rest of the package runs there and holds the hashToken, so the two are easy to confuse.
   */
  it('refuses to run outside a browser', async () => {
    clearDom();
    const { loadFieldsSdk } = await freshModule();

    await expect(loadFieldsSdk()).rejects.toThrow(/browser/i);
  });

  it('injects the SDK once and resolves the global it defines', async () => {
    const dom = installDom();
    const { loadFieldsSdk } = await freshModule();

    const pending = loadFieldsSdk('https://pay.getpayin.com');
    const tag = dom.created[0]!;

    expect(tag.src).toBe('https://pay.getpayin.com/sdk/paylink-fields-v1.js');
    expect(tag.async).toBe(true);
    expect(dom.appended).toHaveLength(1);

    const fields = vi.fn();
    (globalThis as Record<string, unknown>).window = { PayLink: { fields } };
    tag.listeners.load!.forEach((handler) => handler());

    await expect(pending).resolves.toMatchObject({ fields });
  });

  /** A double-invoked effect, or two forms on one page, must not load the script twice. */
  it('shares one script tag between concurrent callers', async () => {
    const dom = installDom();
    const { loadFieldsSdk } = await freshModule();

    const first = loadFieldsSdk();
    const second = loadFieldsSdk();

    expect(dom.created).toHaveLength(1);

    const fields = vi.fn();
    (globalThis as Record<string, unknown>).window = { PayLink: { fields } };
    dom.created[0]!.listeners.load!.forEach((handler) => handler());

    await Promise.all([first, second]);
    expect(dom.appended).toHaveLength(1);
  });

  it('injects nothing when the SDK is already on the page', async () => {
    const fields = vi.fn();
    const dom = installDom();
    (globalThis as Record<string, unknown>).window = { PayLink: { fields } };

    const { loadFieldsSdk } = await freshModule();

    await expect(loadFieldsSdk()).resolves.toMatchObject({ fields });
    expect(dom.created).toHaveLength(0);
  });

  /** A script that 404s to an HTML error page loads fine and defines nothing. Say which URL. */
  it('rejects when the script loads but defines no factory', async () => {
    const dom = installDom();
    const { loadFieldsSdk } = await freshModule();

    const pending = loadFieldsSdk('https://pay.getpayin.com');
    dom.created[0]!.listeners.load!.forEach((handler) => handler());

    await expect(pending).rejects.toThrow(/did not define PayLink\.fields/);
  });

  it('rejects when the script cannot be fetched', async () => {
    const dom = installDom();
    const { loadFieldsSdk } = await freshModule();

    const pending = loadFieldsSdk();
    dom.created[0]!.listeners.error!.forEach((handler) => handler());

    await expect(pending).rejects.toThrow(/Could not load/);
  });

  /** A tag already in the document is waited on, not duplicated beside itself. */
  it('waits on a script another caller already appended', async () => {
    const existing = fakeScript();
    existing.isConnected = true;
    const dom = installDom(existing);
    const { loadFieldsSdk } = await freshModule();

    const pending = loadFieldsSdk();

    expect(dom.created).toHaveLength(0);
    expect(dom.appended).toHaveLength(0);

    const fields = vi.fn();
    (globalThis as Record<string, unknown>).window = { PayLink: { fields } };
    existing.listeners.load!.forEach((handler) => handler());

    await expect(pending).resolves.toMatchObject({ fields });
  });
});

describe('loadFields', () => {
  it('hands the options straight to the SDK factory', async () => {
    const instance = { version: '1.0.0' };
    const fields = vi.fn().mockReturnValue(instance);
    installDom();
    (globalThis as Record<string, unknown>).window = { PayLink: { fields } };

    const { loadFields } = await freshModule();

    const options = {
      clientToken: 'ct_abc',
      number: '#card-number',
      securityCode: '#card-cvc',
      styles: { input: { color: '#111' } },
    };

    await expect(loadFields(options)).resolves.toBe(instance);
    expect(fields).toHaveBeenCalledWith(options);
  });
});
