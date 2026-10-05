import { build } from 'esbuild';
import { copyFile, cp, rm } from 'node:fs/promises';
await rm('dist/browser', { recursive: true, force: true });
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
await cp('viewer', 'dist/viewer', { recursive: true });
