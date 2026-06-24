import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Vite skips dot-directories in public/, so copy the x402 publisher-discovery
// file (public/.well-known/) into the build output ourselves.
function copyWellKnown(): Plugin {
  return {
    name: 'copy-well-known',
    closeBundle() {
      const src = resolve(__dirname, 'public/.well-known')
      const dest = resolve(__dirname, 'dist/.well-known')
      if (existsSync(src)) cpSync(src, dest, { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), copyWellKnown()],
})
