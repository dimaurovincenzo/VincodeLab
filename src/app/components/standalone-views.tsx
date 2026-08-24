import { Suspense } from 'react'
import { Tabs } from '@/components/ui'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { shouldMountPersistentView } from '@/lib/persistent-view-state'
import { shellStyles } from '@/theme/styles/shell'
import { terminalStyles } from '@/theme/styles/terminal'
import type { AppController } from '../hooks/use-app-controller'
import { AppSettings } from './lazy-workbench-views'
import { HomeView } from './home-view'

export function StandaloneViews({ controller }: { controller: AppController }) {
  const {
    appSection,
    appearance,
    changeAppearance,
    handleSettingsWorkspaceGuardChange,
    loadedSections,
    settingsRuntimeRequest,
  } = controller

  return (
    <>
      {shouldMountPersistentView(loadedSections, 'settings', appSection === 'settings') && (
        <Tabs.Content asChild value="settings">
          <section className={shellStyles.standalonePage}>
            <ViewErrorBoundary viewName="Impostazioni">
              <Suspense fallback={<div className={terminalStyles.loading}>Caricamento impostazioni…</div>}>
                <AppSettings active={appSection === 'settings'} appearance={appearance} openRuntimeRequest={settingsRuntimeRequest} onAppearanceChange={changeAppearance} onWorkspaceGuardChange={handleSettingsWorkspaceGuardChange} />
              </Suspense>
            </ViewErrorBoundary>
          </section>
        </Tabs.Content>
      )}
      <HomeView controller={controller} />
    </>
  )
}
