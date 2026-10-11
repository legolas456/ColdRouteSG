import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Stamps production builds with the commit and build time, so anyone can tell
// which version is live: look for <meta name="coldroute-build"> in the page source.
function buildStamp(): Plugin {
  let sha = process.env.GITHUB_SHA?.slice(0, 7) ?? ''
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      sha = 'unknown'
    }
  }
  const content = `${sha} ${new Date().toISOString()}`
  return {
    name: 'coldroute-build-stamp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'coldroute-build', content }, injectTo: 'head' }],
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildStamp()],
  build: {
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      output: {
        // Some static hosts (Amplify included) serve .mjs with a non-JS MIME
        // type, which breaks MapLibre's module worker. Ship it as .js.
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
  },
})
