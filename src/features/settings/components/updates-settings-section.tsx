import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import type { ManagedUpdate } from '@/bridge'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { Button, Checkbox, ErrorNotice, SegmentGroup, Tabs } from '@/components/ui'
import { settingsStyles } from '@/theme/styles/settings'
import { managedUpdateKindLabel, type ManagedUpdatesController } from '../hooks/use-managed-updates'
import type { SettingsSectionFailure } from '../model/settings.types'
import { SettingsSectionError } from './settings-section-error'

export function UpdatesSettingsSection({
  controller,
  failure,
  onRetry,
  setConfirmation,
  updates,
}: {
  controller: ManagedUpdatesController
  failure?: SettingsSectionFailure
  onRetry: () => void | Promise<void>
  setConfirmation: (request: ConfirmationRequest | null) => void
  updates: ManagedUpdate[]
}) {
  const {
    checkAll,
    checkUpdate,
    downloadAll,
    downloadUpdate,
    managedUpdateFailures,
    readyUpdates,
    rollbackUpdate,
    setPolicy,
    setUpdateFilter,
    updateBusy,
    updateFilter,
    visibleUpdates,
  } = controller

  return <Tabs.Content asChild value="updates">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <Download aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Aggiornamenti</h2>
          <p className={settingsStyles.panelDescription}>Controllo verificato delle risorse Pi gestite da VincodeLab.</p>
        </div>
      </div>
      <SettingsSectionError failure={failure} fallbackRecovery={{ label: 'Riprova', run: onRetry, pendingLabel: 'Nuovo tentativo…' }} />
      {readyUpdates > 0 && <div className={settingsStyles.updateBanner} role="status"><strong>Aggiornamenti pronti — riavvia per attivarli.</strong><span>La sessione corrente non viene interrotta.</span></div>}
      <div className={settingsStyles.updateToolbar}>
        <SegmentGroup.Root aria-label="Filtra aggiornamenti" className={settingsStyles.updateFilters} orientation="horizontal" value={updateFilter} onValueChange={({ value }) => { if (value) setUpdateFilter(value as typeof updateFilter) }}>
          <SegmentGroup.Indicator />
          {([['all', 'Tutti'], ['skill', 'Skill'], ['pi-extension', 'Estensioni Pi'], ['pi-runtime', 'Runtime Pi']] as const).map(([value, label]) => <SegmentGroup.Item key={value} value={value}>
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemControl />
            <SegmentGroup.ItemText>{label}</SegmentGroup.ItemText>
          </SegmentGroup.Item>)}
        </SegmentGroup.Root>
        <span className={settingsStyles.updateToolbarActions}>
          <Button size="sm" variant="outline" disabled={Boolean(updateBusy)} onClick={() => void checkAll()}><RefreshCw aria-hidden="true" size={14} /> Verifica ora</Button>
          <Button size="sm" disabled={Boolean(updateBusy) || !updates.some((update) => update.availableVersion && !update.restartRequired)} onClick={() => void downloadAll()}><Download aria-hidden="true" size={14} /> Scarica tutti</Button>
        </span>
      </div>
      {visibleUpdates.length ? <div className={settingsStyles.updateList}>
        {visibleUpdates.map((update) => <article aria-busy={updateBusy === update.id} className={settingsStyles.updateCard} key={update.id}>
          <div className={settingsStyles.updateMain}>
            <span className={settingsStyles.updateKind}>{managedUpdateKindLabel(update.kind)}</span>
            <h3 className={settingsStyles.updateTitle}>{update.name}</h3>
            <p className={settingsStyles.updateVersions}>Attiva <code>{update.activeVersion}</code>{update.availableVersion && <> · Disponibile <code>{update.availableVersion}</code></>}</p>
            <small className={settingsStyles.updateMeta}>{update.owner && update.repository ? `${update.owner}/${update.repository} · ${update.ref}` : update.channel}{update.lastCheckedAt ? ` · verificato ${new Date(update.lastCheckedAt).toLocaleString('it-IT')}` : ' · mai verificato'}</small>
            {!failure && managedUpdateFailures.get(update.id) && <ErrorNotice
              action={{ label: 'Verifica di nuovo', onClick: () => checkUpdate(update.id), pendingLabel: 'Verifica in corso…' }}
              error={managedUpdateFailures.get(update.id)!}
            />}
          </div>
          <div className={settingsStyles.updateActions}>
            <Checkbox checked={update.policy === 'automatic'} disabled={updateBusy === update.id} label="Automatico" onCheckedChange={(checked) => void setPolicy(update.id, checked ? 'automatic' : 'manual')} />
            <Button size="sm" variant="outline" disabled={Boolean(updateBusy)} onClick={() => void checkUpdate(update.id)}><RefreshCw aria-hidden="true" size={14} /> Verifica</Button>
            <Button size="sm" disabled={Boolean(updateBusy) || !update.availableVersion || update.restartRequired} title={!update.availableVersion ? 'Nessuna versione disponibile' : update.restartRequired ? 'Aggiornamento già pronto' : 'Scarica in staging'} onClick={() => void downloadUpdate(update.id)}><Download aria-hidden="true" size={14} /> Scarica</Button>
            <Button size="sm" variant="outline" disabled={Boolean(updateBusy) || !update.rollbackVersion} onClick={() => setConfirmation({ title: 'Ripristina versione precedente', detail: `Verrà ripristinata ${update.rollbackVersion} per ${update.name}.`, confirmLabel: 'Ripristina', destructive: true, onConfirm: () => { void rollbackUpdate(update.id) } })}><RotateCcw aria-hidden="true" size={14} /> Ripristina</Button>
          </div>
        </article>)}
      </div> : <p className={settingsStyles.empty}>Nessuna risorsa con aggiornamenti gestiti per questo filtro.</p>}
    </section>
  </Tabs.Content>
}
