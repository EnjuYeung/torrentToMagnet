import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'bundled-font-licenses',
    generateBundle() {
      for (const name of ['space-grotesk', 'ibm-plex-mono']) {
        this.emitFile({
          type: 'asset',
          fileName: `licenses/${name}.txt`,
          source: readFileSync(new URL(`./src/assets/${name}-LICENSE.txt`, import.meta.url), 'utf8'),
        });
      }
    },
  }],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
