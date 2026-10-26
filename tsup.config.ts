import { defineConfig } from 'tsup';

/*
 * Two entry points, built for different places.
 *
 * `index` is the server-side client and holds the hashToken. `fields` runs in the payer's
 * browser and must never pull that in, which is why it is a separate entry rather than a named
 * export of the first — a bundler following one import must not drag the signing code into a
 * page. Its own target is a browser one for the same reason.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/fields/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: ['node18', 'es2020'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
