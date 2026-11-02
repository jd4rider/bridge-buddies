import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths keep the build working under /play/ on GitHub Pages.
  base: './',
  // Havok loads its own wasm; letting Vite pre-bundle it breaks the locateFile URL.
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4096,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
