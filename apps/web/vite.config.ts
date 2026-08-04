import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const certDir = resolve(here, '../../certs')
const keyPath = resolve(certDir, 'dev-key.pem')
const certPath = resolve(certDir, 'dev.pem')

/*
 * Kamera und Beschleunigungssensor gibt es nur über HTTPS — auf einem echten iPhone
 * verweigert Safari beides über http, selbst im lokalen Netz. Liegen die von mkcert
 * erzeugten Zertifikate in certs/, startet Vite automatisch mit TLS. Siehe README.
 */
const https =
  existsSync(keyPath) && existsSync(certPath)
    ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    : undefined

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Auf 0.0.0.0 lauschen, damit Handys im selben WLAN die App erreichen.
    host: true,
    ...(https ? { https } : {}),
  },
  preview: { port: 5173 },
  build: { sourcemap: true },
})
