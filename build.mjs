import { build } from 'esbuild';
import { rm, writeFile } from 'node:fs/promises';
await writeFile('dist/esm/package.json', '{"type":"module"}\n');
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
await writeFile('dist/browser/package.json', '{"type":"module"}\n');
for (const minify of [false, true]) {
  await build({
    entryPoints: ['src/embed.ts'], outfile: `dist/leadping-consent${minify ? '.min' : ''}.js`,
    bundle: true, minify, sourcemap: true, format: 'iife', globalName: 'LeadpingConsent',
    target: 'es2022', legalComments: 'external',
  });
}
