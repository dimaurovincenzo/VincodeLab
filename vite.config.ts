import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { contentSecurityPolicy } from './scripts/csp-policy.mjs'

export default defineConfig(({ command }) => ({
  // Electron apre la build con file://: gli asset assoluti (/assets/…) puntano alla radice del disco.
  // La base relativa mantiene validi anche lazy chunk e stylesheet nel pacchetto macOS.
  base: './',
  plugins: [
    {
      name: 'vincodelab-content-security-policy',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [{
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: contentSecurityPolicy({ development: command === 'serve' }),
          },
          injectTo: 'head-prepend',
        }],
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // CodeMirror resta lazy con l'editor, ma in un chunk cacheabile separato dalle UI locali.
        manualChunks: (id) => {
          if (id.includes('/node_modules/@replit/codemirror-minimap/')) return 'editor-minimap'
          if (id.includes('/node_modules/@codemirror/search/')) return 'editor-search'
          if (id.includes('/node_modules/@codemirror/lang-') || id.includes('/node_modules/@lezer/')) return 'codemirror-languages'
          if (id.includes('/node_modules/@codemirror/')) return 'codemirror'
          return undefined
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}))
