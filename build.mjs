import { build } from 'esbuild';
import { copyFile, rm } from 'node:fs/promises';
await rm('dist/browser', { recursive: true, force: true });
// Remove the former hosted viewer page from existing build directories.
await rm('dist/viewer', { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts', 'src/viewer.ts'], outdir: 'dist/browser',
  bundle: true, minify: true, sourcemap: true, format: 'esm', target: 'es2022',
  legalComments: 'external',
});
await build({
  entryPoints: { 'leadping-consent': 'src/index.ts', 'leadping-consent-viewer': 'src/viewer.ts' },
  outdir: 'dist/browser', outExtension: { '.js': '.min.js' },
  bundle: true, minify: true, sourcemap: true, format: 'esm', target: 'es2022',
  legalComments: 'external',
});
await copyFile('node_modules/rrweb/dist/style.css', 'dist/browser/replay.css');
await build({
  entryPoints: ['src/embed.ts'], outfile: 'dist/leadping-consent.min.js',
  bundle: true, minify: true, sourcemap: true, format: 'iife', globalName: 'LeadpingConsent',
  target: 'es2022', legalComments: 'external',
});
