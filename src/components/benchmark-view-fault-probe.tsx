import { useEffect, useState } from 'react'

export const BENCHMARK_VIEW_FAULT_EVENT = 'vincodelab:benchmark-view-fault'

type BenchmarkViewFaultDetail = Readonly<{ viewName: string }>

/**
 * Probe disponibile esclusivamente nel bundle avviato con entrambi i flag di
 * fault injection. Consente allo smoke packaged di attraversare un vero Error
 * Boundary React senza esporre controlli o API nel normale uso dell'app.
 */
export function BenchmarkViewFaultProbe({ viewName }: { viewName: string }) {
  const enabled = Boolean(window.vincodeLab?.benchmark?.injectFault)
  const [faulted, setFaulted] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const handleFault = (event: Event) => {
      const detail = (event as CustomEvent<BenchmarkViewFaultDetail>).detail
      if (detail?.viewName === viewName) setFaulted(true)
    }
    window.addEventListener(BENCHMARK_VIEW_FAULT_EVENT, handleFault)
    return () => window.removeEventListener(BENCHMARK_VIEW_FAULT_EVENT, handleFault)
  }, [enabled, viewName])

  if (faulted) throw new Error('access_token benchmark-react-secret /tmp/vincodelab-private/react-view.sql')
  return null
}
