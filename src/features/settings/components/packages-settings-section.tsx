import { Boxes, CircleAlert } from 'lucide-react'
import { Button, Field, SelectField, Spinner, Tabs } from '@/components/ui'
import { settingsStyles } from '@/theme/styles/settings'
import type { PiPackagesController } from '../hooks/use-pi-packages'
import { packageSourceCopy } from '../model/settings-model'
import type { PackageSource, SettingsSectionFailure } from '../model/settings.types'
import { SettingsSectionError } from './settings-section-error'

export function PackagesSettingsSection({
  controller,
  failure,
  onRetry,
  packages,
  piReady,
}: {
  controller: PiPackagesController
  failure?: SettingsSectionFailure
  onRetry: () => void | Promise<void>
  packages: string[]
  piReady: boolean
}) {
  const {
    changePackageSource,
    changeSource,
    mutatePackage,
    normalizedSource,
    packageBusy,
    packageSource,
    source,
  } = controller

  return <Tabs.Content asChild value="packages">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <Boxes aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Pacchetti Pi</h2>
          <p className={settingsStyles.panelDescription}>Un pacchetto può includere skill, estensioni, prompt e temi.</p>
        </div>
      </div>
      <SettingsSectionError failure={failure} fallbackRecovery={{ label: 'Riprova', run: onRetry, pendingLabel: 'Nuovo tentativo…' }} />
      {!piReady && <div className={settingsStyles.runtimeMissing} role="status"><CircleAlert aria-hidden="true" size={18} /><span>Installa Pi Coding Agent prima di gestirne i pacchetti. Node e npm non sono necessari per avviare VincodeLab.</span></div>}
      <div className={settingsStyles.form}>
        <div className={settingsStyles.packageSource}>
          <SelectField aria-label="Tipo sorgente pacchetto Pi" disabled={Boolean(packageBusy) || !piReady} options={[{ value: 'npm', label: 'Catalogo Pi (npm)' }, { value: 'git', label: 'Git' }, { value: 'local', label: 'Locale' }]} value={packageSource} onValueChange={(value) => changePackageSource(value as PackageSource)} />
        </div>
        <Field.Root><Field.Input aria-label="Sorgente pacchetto Pi" disabled={Boolean(packageBusy) || !piReady} value={source} onChange={(event) => changeSource(event.target.value)} placeholder={packageSourceCopy[packageSource].placeholder} /></Field.Root>
        <Button size="sm" disabled={Boolean(packageBusy) || !piReady || !source.trim()} onClick={() => mutatePackage('install', normalizedSource)}>
          {packageBusy?.startsWith('install:') && <Spinner size={14} />}
          {packageBusy?.startsWith('install:') ? 'Installazione…' : 'Installa'}
        </Button>
      </div>
      <p className={settingsStyles.formHelp}>{packageSourceCopy[packageSource].help} Verifica sempre la sorgente: i pacchetti possono eseguire codice.</p>
      {packages.length ? <ul className={settingsStyles.list}>
        {packages.map((item) => <li className={settingsStyles.listItem} key={item}>
          <code className={settingsStyles.listCode} title={item}>{item}</code>
          <span className={settingsStyles.listActions}>
            <Button size="xs" variant="outline" disabled={Boolean(packageBusy)} onClick={() => mutatePackage('update', item)}>Aggiorna</Button>
            <Button size="xs" variant="subtle" tone="danger" disabled={Boolean(packageBusy)} onClick={() => mutatePackage('remove', item)}>Rimuovi</Button>
          </span>
        </li>)}
      </ul> : <p className={settingsStyles.empty}>Nessun pacchetto Pi installato.</p>}
    </section>
  </Tabs.Content>
}
