import { defineConfig } from 'vite';
import { getVersion } from './scripts/version.mjs';

const version = getVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    {
      name: 'app-version-html',
      transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', version),
    },
  ],
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // one clearly named three.js chunk, shared by the main bundle and the lazy chunks
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
  server: { host: false },
  test: {
    include: ['tests/unit/**/*.test.js'],
    environment: 'node',
  },
});
