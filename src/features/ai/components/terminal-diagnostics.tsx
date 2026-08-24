import { useState } from 'react'
import { Activity, Download, RefreshCw } from 'lucide-react'
import type { TerminalDiagnosticsReport } from '@/bridge'
import { Button, ErrorNotice, Spinner, toast } from '@/components/ui'
import { aiBridge } from '../api/ai.bridge'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { terminalStyles } from '@/theme/styles/terminal'

function formatBytes(bytes: number) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, style: 'unit', unit: bytes >= 1024 * 1024 ? 'megabyte' : 'kilobyte', unitDisplay: 'short' }).format(bytes / (bytes >= 1024 * 1024 ? 1024 * 1024 : 1024))
}

export function TerminalDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<TerminalDiagnosticsReport | null>(null)
  const [busy, setBusy] = useState<'refresh' | 'export' | null>(null)
  const [failure, setFailure] = useState<{ error: UserError; recovery: 'refresh' | 'export' } | null>(null)

  const refresh = async () => {
    setBusy('refresh')
    setFailure(null)
    try { setDiagnostics(await aiBridge.terminal.diagnostics()) }
    catch (error) {
      setFailure({
        error: reportUserError(normalizeUserError(error, {
          category: 'process',
          component: 'terminal-diagnostics',
          operation: 'read-terminal-diagnostics',
          recoverable: true,
          title: 'Diagnostica del terminale non disponibile',
          description: 'Le sessioni del terminale restano operative. Puoi acquisire nuovamente le metriche.',
        })),
        recovery: 'refresh',
      })
    }
    finally { setBusy(null) }
  }

  const exportReport = async () => {
    setBusy('export')
    setFailure(null)
    try {
      const result = await aiBridge.terminal.exportDiagnostics()
      if (result.exported) toast.success('Report diagnostico esportato.', { description: result.filePath })
    } catch (error) {
      setFailure({
        error: reportUserError(normalizeUserError(error, {
          category: 'filesystem',
          component: 'terminal-diagnostics',
          operation: 'export-terminal-diagnostics',
          recoverable: true,
          title: 'Report diagnostico non esportato',
          description: 'Il report non è stato creato e le sessioni del terminale non sono state modificate. Puoi riprovare.',
        })),
        recovery: 'export',
      })
    } finally { setBusy(null) }
  }

  return <section className={terminalStyles.diagnostics}>
    <header className={terminalStyles.diagnosticsHeader}><div className={terminalStyles.diagnosticsTitle}><Activity aria-hidden="true" size={17} /><div><h3>Diagnostica Terminale AI</h3><span>Metriche tecniche senza contenuti della sessione.</span></div></div><Button disabled={busy !== null} size="sm" variant="outline" onClick={() => void refresh()}>{busy === 'refresh' ? <Spinner size={14} /> : <RefreshCw aria-hidden="true" size={14} />} Aggiorna</Button></header>
    {diagnostics ? <dl className={terminalStyles.diagnosticsGrid}>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>Coda corrente</dt><dd className={terminalStyles.diagnosticsValue}>{formatBytes(diagnostics.pipeline.queuedBytes)}</dd></div>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>Picco coda</dt><dd className={terminalStyles.diagnosticsValue}>{formatBytes(diagnostics.pipeline.peakQueuedBytes)}</dd></div>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>ACK p95</dt><dd className={terminalStyles.diagnosticsValue}>{diagnostics.renderer.ackP95Ms.toFixed(1)} ms</dd></div>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>Pause PTY</dt><dd className={terminalStyles.diagnosticsValue}>{diagnostics.pipeline.pauseCount.toLocaleString('it-IT')}</dd></div>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>Paste completati</dt><dd className={terminalStyles.diagnosticsValue}>{diagnostics.paste.completed.toLocaleString('it-IT')}</dd></div>
      <div className={terminalStyles.diagnosticsMetric}><dt className={terminalStyles.diagnosticsTerm}>Renderer</dt><dd className={terminalStyles.diagnosticsValue}>{diagnostics.renderer.mode === 'webgl' ? 'WebGL' : 'Standard'}</dd></div>
    </dl> : <p className={terminalStyles.diagnosticsDescription}>Premi Aggiorna per acquisire lo stato corrente del Terminale AI.</p>}
    {failure && <ErrorNotice error={failure.error} action={{
      label: failure.recovery === 'refresh' ? 'Acquisisci di nuovo' : 'Esporta di nuovo',
      onClick: failure.recovery === 'refresh' ? refresh : exportReport,
    }} />}
    <Button className={terminalStyles.diagnosticsAction} disabled={busy !== null} size="sm" variant="outline" onClick={() => void exportReport()}><Download aria-hidden="true" size={14} /> {busy === 'export' ? 'Esportazione…' : 'Esporta report'}</Button>
  </section>
}
