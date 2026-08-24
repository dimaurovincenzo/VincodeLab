import { Settings2 } from 'lucide-react'
import { TerminalDiagnostics } from '@/features/ai'
import { Button, ErrorNotice, SegmentGroup, SelectField, Spinner, Tabs } from '@/components/ui'
import { preferenceSectionLabels } from '../model/settings-model'
import type { Appearance, SettingsProps, SettingsSectionFailure } from '../model/settings.types'
import type { SettingsPreferencesController } from '../hooks/use-settings-preferences'
import { settingsStyles } from '@/theme/styles/settings'
import { PreferenceControl } from './preference-control'
import { SettingsSectionError } from './settings-section-error'

export function GeneralSettingsSection({
  appearance,
  controller,
  failure,
  onAppearanceChange,
  onRetrySection,
}: {
  appearance: Appearance
  controller: SettingsPreferencesController
  failure?: SettingsSectionFailure
  onAppearanceChange: SettingsProps['onAppearanceChange']
  onRetrySection: () => void | Promise<void>
}) {
  const {
    preferenceBusy,
    preferenceLoadFailure,
    preferences,
    preferencesLoading,
    preferenceScope,
    requestClearAllWorkspacePreferences,
    retryPreferenceLoad,
    setPreferenceScope,
  } = controller

  return <Tabs.Content asChild value="general">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <Settings2 aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Generali</h2>
          <p className={settingsStyles.panelDescription}>Configura VincodeLab globalmente o personalizza il workspace aperto.</p>
        </div>
      </div>
      <div className={settingsStyles.generalToolbar}>
        <div className={settingsStyles.appearanceControl}>
          <SelectField aria-label="Aspetto dell’applicazione" label="Aspetto dell’applicazione" options={[{ value: 'system', label: 'Sistema' }, { value: 'dark', label: 'Scuro' }, { value: 'light', label: 'Chiaro' }]} value={appearance} onValueChange={(value) => onAppearanceChange(value as Appearance)} />
        </div>
        <SegmentGroup.Root aria-label="Ambito impostazioni" className={settingsStyles.scopeSwitch} orientation="horizontal" value={preferenceScope} onValueChange={({ value }) => { if (value) setPreferenceScope(value as typeof preferenceScope) }}>
          <SegmentGroup.Indicator />
          {([{ value: 'global', label: 'Valori globali' }, { value: 'workspace', label: 'Workspace aperto', disabled: !preferences?.workspaceAvailable }]).map((item) => <SegmentGroup.Item key={item.value} value={item.value} disabled={item.disabled}>
            <SegmentGroup.ItemHiddenInput />
            <SegmentGroup.ItemControl />
            <SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText>
          </SegmentGroup.Item>)}
        </SegmentGroup.Root>
      </div>
      {preferenceLoadFailure
        ? <ErrorNotice action={{ label: 'Riprova preferenze', onClick: retryPreferenceLoad, pendingLabel: 'Nuovo tentativo…' }} error={preferenceLoadFailure} />
        : <SettingsSectionError failure={failure} fallbackRecovery={{ label: 'Riprova', run: onRetrySection, pendingLabel: 'Nuovo tentativo…' }} />}
      {preferences ? <div className={settingsStyles.preferenceGrid}>
        {(['editor', 'terminal', 'git', 'database'] as const).map((section) => <section className={settingsStyles.preferenceSection} key={section}>
          <header className={settingsStyles.preferenceSectionHeader}>
            <h3 className={settingsStyles.preferenceSectionTitle}>{preferenceSectionLabels[section]}</h3>
            <span className={settingsStyles.preferenceSectionSubtitle}>{preferenceScope === 'workspace' ? 'Personalizzazioni del progetto' : 'Default per tutti i progetti'}</span>
          </header>
          {preferences.schema.filter((definition) => definition.section === section).map((definition) => <PreferenceControl controller={controller} definition={definition} key={definition.key} />)}
        </section>)}
      </div> : !preferenceLoadFailure && <p className={settingsStyles.empty}>{preferencesLoading ? 'Caricamento preferenze…' : 'Preparazione preferenze…'}</p>}
      {preferenceScope === 'workspace' && preferences?.workspaceAvailable && <Button size="sm" variant="outline" disabled={Boolean(preferenceBusy)} onClick={requestClearAllWorkspacePreferences}>
        {preferenceBusy === '*' && <Spinner size={14} />}
        {preferenceBusy === '*' ? 'Ripristino…' : 'Rimuovi tutte le personalizzazioni'}
      </Button>}
      <TerminalDiagnostics />
      <p className={settingsStyles.note}>Runtime, pacchetti e skill Pi restano globali e non appartengono al workspace aperto.</p>
    </section>
  </Tabs.Content>
}
