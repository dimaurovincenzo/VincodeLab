import { useEffect, useState } from 'react'
import { Bot, Boxes, Cpu, Download, FilePlus2, RefreshCw, Settings2 } from 'lucide-react'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { Button, Spinner, Tabs } from '@/components/ui'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { settingsStyles } from '@/theme/styles/settings'
import { useManagedUpdates } from '../hooks/use-managed-updates'
import { usePiConfig } from '../hooks/use-pi-config'
import { usePiPackages } from '../hooks/use-pi-packages'
import { useSettingsPreferences } from '../hooks/use-settings-preferences'
import { useSettingsRefresh } from '../hooks/use-settings-refresh'
import { useSettingsWorkspaceGuard } from '../hooks/use-settings-workspace-guard'
import { useSystemSkills } from '../hooks/use-system-skills'
import type { SettingsProps, SettingsTab } from '../model/settings.types'
import { CompatibilitySettingsSection } from './compatibility-settings-section'
import { GeneralSettingsSection } from './general-settings-section'
import { PackagesSettingsSection } from './packages-settings-section'
import { RuntimeSettingsSection } from './runtime-settings-section'
import { SkillsSettingsSection } from './skills-settings-section'
import { UpdatesSettingsSection } from './updates-settings-section'

export function Settings({ active = true, appearance, openRuntimeRequest = 0, onAppearanceChange, onWorkspaceGuardChange }: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>('general')
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const refreshController = useSettingsRefresh()
  const configController = usePiConfig(active, refreshController)
  const preferencesController = useSettingsPreferences(refreshController, setConfirmation)
  const packagesController = usePiPackages(refreshController, setConfirmation)
  const updatesController = useManagedUpdates(refreshController)
  const skillsController = useSystemSkills(refreshController, setConfirmation)
  const {
    packageSkills,
    packages,
    refresh,
    refreshing,
    runtimeCapabilities,
    sectionFailures,
    skills,
    status,
    updates,
  } = refreshController
  const { closeConfig } = configController
  const piReady = status?.state === 'ready'

  useSettingsWorkspaceGuard({
    onWorkspaceGuardChange,
    packages: packagesController,
    preferences: preferencesController,
    setConfirmation,
    skills: skillsController,
  })

  useEffect(() => {
    if (openRuntimeRequest <= 0) return
    queueMicrotask(() => {
      if (refreshController.mounted.current) setTab('runtime')
    })
  }, [openRuntimeRequest, refreshController.mounted])

  const selectTab = (next: SettingsTab) => {
    setTab(next)
    if (next !== 'runtime') void closeConfig()
  }

  useApplicationMenuCommand('settings.refresh', () => { void refresh() })
  useApplicationMenuCommand('settings.resetWorkspacePreferences', preferencesController.requestClearAllWorkspacePreferences)

  return <Tabs.Root asChild value={tab} onValueChange={({ value }) => selectTab(value as SettingsTab)}>
    <section className={settingsStyles.page} aria-label="Impostazioni">
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />

      <header className={settingsStyles.header}>
        <div className={settingsStyles.headerCopy}>
          <p className={settingsStyles.eyebrow}>Preferenze</p>
          <h1 className={settingsStyles.pageTitle}>Impostazioni</h1>
          <span className={settingsStyles.headerDescription}>Workspace, runtime Pi e risorse condivise.</span>
        </div>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? <Spinner size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
          {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
        </Button>
      </header>

      <Tabs.List className={settingsStyles.tabs} aria-label="Sezioni Impostazioni">
        <Tabs.Trigger value="general"><Settings2 aria-hidden="true" size={15} /> Generali</Tabs.Trigger>
        <Tabs.Trigger value="compatibility"><Cpu aria-hidden="true" size={15} /> Compatibilità</Tabs.Trigger>
        <Tabs.Trigger value="updates"><Download aria-hidden="true" size={15} /> Aggiornamenti{updatesController.readyUpdates > 0 && <span className={settingsStyles.updateCount}>{updatesController.readyUpdates}</span>}</Tabs.Trigger>
        <Tabs.Trigger value="runtime"><Bot aria-hidden="true" size={15} /> Runtime Pi</Tabs.Trigger>
        <Tabs.Trigger value="packages"><Boxes aria-hidden="true" size={15} /> Pacchetti Pi</Tabs.Trigger>
        <Tabs.Trigger value="skills"><FilePlus2 aria-hidden="true" size={15} /> Skill Pi</Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>

      <main className={settingsStyles.main}>
        <GeneralSettingsSection appearance={appearance} controller={preferencesController} failure={sectionFailures.general} onAppearanceChange={onAppearanceChange} onRetrySection={refresh} />
        <CompatibilitySettingsSection failure={sectionFailures.compatibility} onRetry={refresh} refreshing={refreshing} runtimeCapabilities={runtimeCapabilities} />
        <UpdatesSettingsSection controller={updatesController} failure={sectionFailures.updates} onRetry={refresh} setConfirmation={setConfirmation} updates={updates} />
        <RuntimeSettingsSection controller={configController} failure={sectionFailures.runtime} onRetry={refresh} piReady={piReady} refreshing={refreshing} status={status} />
        <PackagesSettingsSection controller={packagesController} failure={sectionFailures.packages} onRetry={refresh} packages={packages} piReady={piReady} />
        <SkillsSettingsSection controller={skillsController} failure={sectionFailures.skills} onRetry={refresh} packageSkills={packageSkills} skills={skills} />
      </main>
    </section>
  </Tabs.Root>
}
