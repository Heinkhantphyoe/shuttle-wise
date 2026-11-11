import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig, loadEnv } from 'vite'
import { localAiMiddleware } from './scripts/local-ai.mjs'

export default defineConfig(({ command, mode }) => {
  const browser = loadEnv(mode, process.cwd())
  const local = command === 'serve' && mode !== 'local-check-in' && browser.VITE_USE_FIREBASE_EMULATORS !== 'true'
  const config = JSON.parse(readFileSync(new URL('./worker/wrangler.jsonc', import.meta.url), 'utf8')).vars
  const secretFile = new URL('./worker/.dev.vars', import.meta.url)
  const secrets = existsSync(secretFile) ? parseEnv(readFileSync(secretFile, 'utf8')) : {}
  return {
    define: { 'import.meta.env.VITE_LOCAL_AI': JSON.stringify(local) },
    server: {
      host: 'localhost',
      fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.firebase/**', '**/.dev.vars*'] },
    },
    plugins: local ? [{
      name: 'shuttlewise-local-ai',
      configureServer(server) {
        server.middlewares.use(localAiMiddleware({ ...config,
          FIREBASE_PROJECT_ID: browser.VITE_FIREBASE_PROJECT_ID || config.FIREBASE_PROJECT_ID,
          GEMINI_API_KEY: process.env.GEMINI_API_KEY || secrets.GEMINI_API_KEY,
        }))
      },
    }] : [],
  }
})
