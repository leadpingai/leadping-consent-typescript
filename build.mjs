import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
await rm('dist/browser', { recursive: true, force: true });
// Remove obsolete replay exports when rebuilding an existing checkout.
await Promise.all(['dist/viewer.js', 'dist/viewer.d.ts'].map(path => rm(path, { force: true })));
await build({
  entryPoints: ['src/index.ts'], outdir: 'dist/browser',
  bundle: true, minify: true, sourcemap: true, format: 'esm', target: 'es2022',
  legalComments: 'external',
});
await build({
  entryPoints: { 'leadping-consent': 'src/index.ts' },
  outdir: 'dist/browser', outExtension: { '.js': '.min.js' },
  bundle: true, minify: true, sourcemap: true, format: 'esm', target: 'es2022',
  legalComments: 'external',
});
for (const minify of [false, true]) {
  await build({
    entryPoints: ['src/embed.ts'], outfile: `dist/leadping-consent${minify ? '.min' : ''}.js`,
    bundle: true, minify, sourcemap: true, format: 'iife', globalName: 'LeadpingConsent',
    target: 'es2022', legalComments: 'external',
  });
}
