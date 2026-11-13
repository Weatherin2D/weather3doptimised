#!/usr/bin/env node
/**
 * Copy Vite dist/ into docs/ for legacy GitHub Pages (source: main /).
 * Root index.html redirects to ./docs/. Keeps README screenshots in docs/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const docs = join(root, 'docs');

const keep = new Set([
  'satellite.png',
  'surface.png',
  'temperature.png',
  'view3d.png',
]);

if (!existsSync(dist) || !existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing — run npm run build first');
  process.exit(1);
}

mkdirSync(docs, { recursive: true });

for (const name of readdirSync(docs)) {
  if (keep.has(name)) continue;
  rmSync(join(docs, name), { recursive: true, force: true });
}

cpSync(dist, docs, { recursive: true });
writeFileSync(join(docs, '.nojekyll'), '');
console.log('Synced dist/ → docs/ (+ .nojekyll)');
