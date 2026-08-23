import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/app-error-boundary.tsx'
import { BootstrapHydrationNotice } from './components/bootstrap-hydration-notice.tsx'
import { installGlobalErrorHandlers } from './lib/global-error-handlers.ts'
import { normalizeUserError, reportUserError, type UserError } from './lib/user-error.js'
import { hydrateVolatileDrafts, invalidateVolatileDraftHydration } from './lib/volatile-draft-store.ts'

installGlobalErrorHandlers()

function hydrationWithDeadline({ retry = false } = {}) {
  if (retry) invalidateVolatileDraftHydration()
  let timeoutId = 0
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      invalidateVolatileDraftHydration()
      reject(new DOMException('Draft hydration timeout', 'TimeoutError'))
    }, 5_000)
  })
  return Promise.race([hydrateVolatileDrafts(), timeout])
    .finally(() => window.clearTimeout(timeoutId))
}

function hydrationErrorFromResult(result: Awaited<ReturnType<typeof hydrateVolatileDrafts>>) {
  if (!result.invalid) return null
  return reportUserError(normalizeUserError(new Error(`${result.invalid} volatile draft snapshots were invalid`), {
    category: 'persistence',
    component: 'renderer-bootstrap',
    operation: 'hydrate-drafts',
    severity: 'warning',
    title: 'Alcune bozze non sono state ripristinate',
    description: 'Le bozze valide restano disponibili. I file del workspace non sono stati modificati.',
  }))
}

async function runHydration(retry = false): Promise<UserError | null> {
  try {
    return hydrationErrorFromResult(await hydrationWithDeadline({ retry }))
  } catch (cause) {
    return reportUserError(normalizeUserError(cause, {
      category: 'persistence',
      component: 'renderer-bootstrap',
      operation: 'hydrate-drafts',
      severity: 'warning',
      title: 'Bozze temporanee non ripristinate',
      description: 'VincodeLab è stato avviato senza le bozze della sessione interrotta. I file salvati non sono stati modificati.',
    }))
  }
}

void runHydration().then((hydrationError) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
        <BootstrapHydrationNotice error={hydrationError} onRetry={() => runHydration(true)} />
      </>
    </StrictMode>,
  )
})
