import { Bot, CircleAlert } from 'lucide-react'
import type { PiRuntimeStatus } from '@/bridge'
import { Button, Field, Spinner, Tabs } from '@/components/ui'
import { settingsStyles } from '@/theme/styles/settings'
import type { PiConfigController } from '../hooks/use-pi-config'
import type { SettingsSectionFailure } from '../model/settings.types'
import { SettingsSectionError } from './settings-section-error'

const piConfigKeys: Record<string, string> = {
  ArrowDown: '\x1b[B',
  ArrowLeft: '\x1b[D',
  ArrowRight: '\x1b[C',
  ArrowUp: '\x1b[A',
  Backspace: '\x7f',
  Enter: '\r',
  Escape: '\x1b',
  Tab: '\t',
}

export function RuntimeSettingsSection({
  controller,
  failure,
  onRetry,
  piReady,
  refreshing,
  status,
}: {
  controller: PiConfigController
  failure?: SettingsSectionFailure
  onRetry: () => void | Promise<void>
  piReady: boolean
  refreshing: boolean
  status: PiRuntimeStatus | null
}) {
  const { closeConfig, configBusy, configOpen, configOutput, startConfig, writeConfigInput } = controller

  return <Tabs.Content asChild value="runtime">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <Bot aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Runtime Pi</h2>
          <p className={settingsStyles.runtime}>{status
            ? status.state === 'ready' ? `${status.version} · ${status.executable}` : 'Pi Coding Agent non rilevato.'
            : failure ? 'Runtime Pi non verificato.' : refreshing ? 'Verifica Pi in corso…' : 'Runtime Pi non ancora verificato.'}</p>
        </div>
      </div>
      <SettingsSectionError
        failure={failure}
        fallbackRecovery={{ label: 'Riprova', run: onRetry, pendingLabel: 'Nuovo tentativo…' }}
        fallbackSecondaryRecovery={{ label: 'Apri configurazione', run: startConfig }}
      />
      {status?.state === 'missing' && <div className={settingsStyles.runtimeMissing} role="status">
        <CircleAlert aria-hidden="true" size={18} />
        <span><strong>Pi Coding Agent non è installato o non è rilevabile.</strong> Il Terminale AI, la configurazione e i pacchetti Pi restano disattivati. Installa Pi, poi seleziona “Aggiorna”.</span>
      </div>}
      <Button className={settingsStyles.primaryPanelAction} size="sm" variant="outline" disabled={configBusy || !piReady} title={!piReady ? 'Installa Pi e aggiorna la verifica prima di configurarlo' : undefined} onClick={() => void startConfig()}>
        {configBusy && <Spinner size={14} />}
        {configBusy ? 'Apertura configurazione…' : 'Configura Pi'}
      </Button>
      {configOpen && <article className={settingsStyles.config}>
        <div className={settingsStyles.configHeader}>
          <h2 className={settingsStyles.configTitle}>Configurazione nativa Pi</h2>
          <Button size="sm" variant="outline" disabled={configBusy} onClick={() => void closeConfig()}>
            {configBusy && <Spinner size={14} />}
            {configBusy ? 'Chiusura…' : 'Chiudi'}
          </Button>
        </div>
        <pre className={settingsStyles.configTerminal} aria-label="Terminale configurazione Pi">{configOutput || 'Avvio configurazione Pi…'}</pre>
        <Field.Root>
          <Field.Input aria-label="Input configurazione Pi" onKeyDown={(event) => {
            const value = piConfigKeys[event.key] ?? (event.key.length === 1 ? event.key : '')
            if (!value || event.metaKey || event.ctrlKey) return
            event.preventDefault()
            writeConfigInput(value)
          }} placeholder="Usa tastiera: Invio, frecce, Tab ed Esc sono inviati a Pi" />
        </Field.Root>
      </article>}
    </section>
  </Tabs.Content>
}
