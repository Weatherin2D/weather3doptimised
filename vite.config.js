import { resolve } from 'node:path';
import { renameSync, existsSync } from 'node:fs';

// base './' – relative paths so the built page works from a subdirectory
// (GitHub Pages: /weather3doptimised/ or /weather3doptimised/docs/).
// Height tiles, WorldCover, climate normals are fetched by the browser from
// providers (geo.js); the static host is not involved.
export default {
  base: './',
  server: {
    open: '/index.vite.html',
  },
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, 'index.vite.html'),
    },
  },
  plugins: [
    {
      name: 'html-entry-as-index',
      closeBundle() {
        const from = resolve(import.meta.dirname, 'dist/index.vite.html');
        const to = resolve(import.meta.dirname, 'dist/index.html');
        if (existsSync(from)) renameSync(from, to);
      },
    },
  ],
};
