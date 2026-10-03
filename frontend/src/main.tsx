import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'
import './styles.css'

const rootElement = document.getElementById('root')

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function showBootstrapError(error: unknown) {
  if (!rootElement) return
  const message = error instanceof Error ? error.message : String(error)
  rootElement.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#f3f6f8;font-family:Arial,sans-serif;color:#0f172a">
      <section style="max-width:760px;width:100%;background:white;border-radius:16px;padding:28px;box-shadow:0 12px 35px rgba(15,23,42,.12)">
        <h1 style="margin:0 0 12px;font-size:24px">ColdRoute frontend could not start</h1>
        <p style="margin:0 0 14px;color:#475569">A frontend module failed before React could render. The exact browser error is shown below.</p>
        <pre style="white-space:pre-wrap;overflow-wrap:anywhere;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">${escapeHtml(message)}</pre>
        <p style="margin:14px 0 0;color:#64748b">Restart Vite after replacing the updated files. If this message remains, copy the error text shown above.</p>
      </section>
    </main>`
}

async function bootstrap() {
  if (!rootElement) {
    throw new Error('Missing #root element in index.html')
  }

  rootElement.innerHTML = '<div style="padding:24px;font-family:Arial,sans-serif">Loading ColdRoute SG…</div>'

  try {
    const { default: App } = await import('./App')
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  } catch (error) {
    console.error('ColdRoute bootstrap error:', error)
    showBootstrapError(error)
  }
}

void bootstrap()
