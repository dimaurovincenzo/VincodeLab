import { BookOpen, Boxes, Database, FileCode2, GitFork, LayoutGrid, Settings, TerminalSquare } from 'lucide-react'
import { CommandPalette } from '@/components/command-palette'
import { WorkspaceChangeDialog } from '@/components/workspace-change-dialog'
import { ErrorNotice, Tabs, Toaster } from '@/components/ui'
import { WorkspaceSwitcher } from '@/features/workspace'
import { shellStyles } from '@/theme/styles/shell'
import type { AppController } from '../hooks/use-app-controller'
import { reportTransientFailure } from '../services/app-controller-errors'
import { StandaloneViews } from './standalone-views'
import { WorkspaceViews } from './workspace-views'

// In sviluppo la pagina è servita da Vite; nella build Electron è un file locale.
// Risolvendo dall'URL della pagina l'icona rimane disponibile in entrambi i contesti.
const appIconUrl = new URL('vincodelab-icon.png', window.location.href).toString()

export function AppShell({ controller }: { controller: AppController }) {
  const {
    appSection,
    cancelLifecycleClose,
    completeLifecycleClose,
    discardAndChangeWorkspace,
    indexingFiles,
    lifecycleCloseRequest,
    openRecentWorkspace,
    openWorkspace,
    openWorkspaceInNewInstance,
    paletteItems,
    paletteMode,
    paletteOpen,
    recents,
    recoverWorkspaceSession,
    requestWorkspaceChange,
    saveAndChangeWorkspace,
    savingBeforeLifecycleClose,
    savingBeforeWorkspaceChange,
    selectAppSection,
    selectPaletteItem,
    setPaletteOpen,
    setWorkspaceChangeRequest,
    workspace,
    workspaceChangeRequest,
    workspaceOpenFailure,
    workspaceSessionRecovery,
  } = controller

  return (
    <Tabs.Root asChild value={workspace ? appSection : appSection === 'settings' ? 'settings' : 'home'} onValueChange={({ value }) => selectAppSection(value === 'home' ? 'ai' : value as typeof appSection)}>
      <main className={shellStyles.root}>
        <Toaster closeButton />
        <CommandPalette
          open={paletteOpen}
          mode={paletteMode}
          items={paletteItems}
          emptyLabel={paletteMode === 'files' && indexingFiles ? 'Indicizzazione dei file in corso…' : undefined}
          onOpenChange={setPaletteOpen}
          onSelect={selectPaletteItem}
          onSelectionError={(nextError, item) => reportTransientFailure(nextError, {
            component: 'command-palette',
            operation: 'apply-selection',
            title: `Selezione “${item.label}” non applicata`,
            description: 'La palette è stata chiusa senza modificare lo stato corrente. Puoi riaprirla e riprovare.',
          }, { label: 'Riapri palette', onClick: () => setPaletteOpen(true) })}
        />
        <WorkspaceChangeDialog
          intent={lifecycleCloseRequest?.reason ?? 'workspace'}
          open={lifecycleCloseRequest !== null || workspaceChangeRequest !== null}
          saving={lifecycleCloseRequest ? savingBeforeLifecycleClose : savingBeforeWorkspaceChange}
          onCancel={lifecycleCloseRequest ? cancelLifecycleClose : () => setWorkspaceChangeRequest(null)}
          onDiscard={lifecycleCloseRequest ? () => void completeLifecycleClose('discard') : () => void discardAndChangeWorkspace()}
          onSave={lifecycleCloseRequest ? () => void completeLifecycleClose('save') : () => void saveAndChangeWorkspace()}
        />
        <header className={`window-toolbar ${shellStyles.toolbar}`}>
          <WorkspaceSwitcher appIconUrl={appIconUrl} currentPath={workspace} recents={recents} onChooseDirectory={openWorkspace} onOpenHere={openRecentWorkspace} onOpenNew={openWorkspaceInNewInstance} />
          <Tabs.List className={shellStyles.navigation} aria-label="Sezioni applicazione">
            {workspace && <>
              <Tabs.Trigger value="ai"><BookOpen aria-hidden="true" size={14} /> AI</Tabs.Trigger>
              <Tabs.Trigger value="editor"><FileCode2 aria-hidden="true" size={14} /> Editor</Tabs.Trigger>
              <Tabs.Trigger value="terminal"><TerminalSquare aria-hidden="true" size={14} /> Terminale</Tabs.Trigger>
              <Tabs.Trigger value="github"><GitFork aria-hidden="true" size={14} /> GitHub</Tabs.Trigger>
              <Tabs.Trigger value="database"><Database aria-hidden="true" size={14} /> Database</Tabs.Trigger>
              <Tabs.Trigger value="redis"><Boxes aria-hidden="true" size={14} /> Redis</Tabs.Trigger>
            </>}
            {!workspace && <Tabs.Trigger value="home"><LayoutGrid aria-hidden="true" size={14} /> Recenti</Tabs.Trigger>}
            <Tabs.Trigger value="settings"><Settings aria-hidden="true" size={14} /> Impostazioni</Tabs.Trigger>
            <Tabs.Indicator />
          </Tabs.List>
        </header>

        {workspaceOpenFailure && <ErrorNotice
          action={{ label: 'Riprova apertura', pendingLabel: 'Apertura…', onClick: () => requestWorkspaceChange(workspaceOpenFailure.request) }}
          className={shellStyles.statusNotice}
          error={workspaceOpenFailure.error}
        />}

        {workspace && workspaceSessionRecovery && <ErrorNotice
          action={{
            label: workspaceSessionRecovery.kind === 'corrupt' ? 'Continua' : 'Salva di nuovo',
            pendingLabel: workspaceSessionRecovery.kind === 'corrupt' ? 'Ripristino…' : 'Salvataggio…',
            onClick: recoverWorkspaceSession,
          }}
          className={shellStyles.statusNotice}
          error={workspaceSessionRecovery.error}
        />}

        {workspace ? <WorkspaceViews controller={controller} /> : <StandaloneViews controller={controller} />}
      </main>
    </Tabs.Root>
  )
}
