import { ChevronRight, FolderOpen, LayoutGrid, List, Search } from 'lucide-react'
import { Button, ErrorNotice, Field, SegmentGroup, Tabs, WorkbenchPresence } from '@/components/ui'
import { homeStyles } from '@/theme/styles/home'
import type { AppController } from '../hooks/use-app-controller'

function workspaceName(workspacePath: string) {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}

function formatLastOpened(timestamp: number) {
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function HomeView({ controller }: { controller: AppController }) {
  const {
    filteredRecents,
    homeFailure,
    openRecentWorkspace,
    openingWorkspacePath,
    openWorkspace,
    recents,
    refreshRecents,
    search,
    setSearch,
    setView,
    status,
    view,
  } = controller

  return (
    <Tabs.Content asChild value="home">
      <section className={homeStyles.root} aria-label="Workspace recenti">
        <div className={homeStyles.content}>
          <div className={homeStyles.toolbar}>
            <SegmentGroup.Root className={homeStyles.viewControls} aria-label="Modalità di visualizzazione" orientation="horizontal" value={view} onValueChange={({ value }) => { if (value) setView(value as typeof view) }}>
              <SegmentGroup.Indicator />
              <SegmentGroup.Item aria-label="Vista griglia" title="Vista griglia" value="grid"><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText><LayoutGrid aria-hidden="true" size={16} /></SegmentGroup.ItemText></SegmentGroup.Item>
              <SegmentGroup.Item aria-label="Vista elenco" title="Vista elenco" value="list"><SegmentGroup.ItemHiddenInput /><SegmentGroup.ItemControl /><SegmentGroup.ItemText><List aria-hidden="true" size={16} /></SegmentGroup.ItemText></SegmentGroup.Item>
            </SegmentGroup.Root>
            <h1 className={homeStyles.title}>Recenti <span className={homeStyles.count}>{recents.length}</span></h1>
            <Field.Root className={homeStyles.search}>
              <Search aria-hidden="true" size={14} />
              <Field.Input className={homeStyles.searchInput} aria-label="Cerca workspace" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca workspace…" type="search" />
            </Field.Root>
            <Button variant="outline" size="sm" onClick={openWorkspace} disabled={status === 'launching'}>
              <FolderOpen aria-hidden="true" /> Apri cartella…
            </Button>
          </div>

          <div className={homeStyles.body}>
            <div className={homeStyles.bodyHeader}>
              <div className={homeStyles.bodyHeadingCopy}>
                <h2 className={homeStyles.bodyTitle}>Workspace recenti</h2>
                <p className={homeStyles.bodyDescription}>Cartelle locali ordinate per ultimo utilizzo.</p>
              </div>
              <span className={homeStyles.bodyMeta}>{filteredRecents.length} workspace</span>
            </div>
            <WorkbenchPresence
              className={homeStyles.results}
              presenceKey={filteredRecents.length > 0 ? `recents-${view}` : search ? 'search-empty' : 'empty'}
            >
              {filteredRecents.length > 0 ? (
                <div className={view === 'grid' ? homeStyles.grid : homeStyles.list}>
                  {filteredRecents.map((recent) => (
                    <Button aria-busy={openingWorkspacePath === recent.path} className={homeStyles.card({ layout: view })} data-context-menu-id={recent.path} data-context-menu-kind="recent-workspace" key={recent.path} onClick={() => openRecentWorkspace(recent.path)} disabled={status === 'launching'} variant="plain">
                      <span className={homeStyles.cardIcon}><FolderOpen aria-hidden="true" size={20} /></span>
                      <span className={homeStyles.cardDetails}>
                        <strong className={homeStyles.cardName}>{workspaceName(recent.path)}</strong>
                        <small className={homeStyles.cardPath}>{recent.path}</small>
                      </span>
                      <time className={homeStyles.cardTime({ layout: view })} dateTime={new Date(recent.lastOpenedAt).toISOString()}>{openingWorkspacePath === recent.path ? 'Apertura…' : `Aperto ${formatLastOpened(recent.lastOpenedAt)}`}</time>
                      <ChevronRight className={homeStyles.cardChevron} aria-hidden="true" size={14} />
                    </Button>
                  ))}
                </div>
              ) : (
                <div className={homeStyles.empty}>
                  <div className={homeStyles.emptyIcon}><FolderOpen aria-hidden="true" size={32} /></div>
                  <h2 className={homeStyles.emptyTitle}>{search ? 'Nessun workspace trovato' : 'Nessun progetto recente'}</h2>
                  <p className={homeStyles.emptyDescription}>{search ? `Nessun risultato per “${search}”. Prova un percorso o un nome diverso.` : 'Non hai ancora aperto alcuna cartella in VincodeLab. Scegli una cartella per iniziare.'}</p>
                  {!search && <Button onClick={openWorkspace} disabled={status === 'launching'}><FolderOpen aria-hidden="true" /> Scegli cartella</Button>}
                </div>
              )}
            </WorkbenchPresence>
            {homeFailure && <ErrorNotice
              action={homeFailure.recovery === 'refresh-recents'
                ? { label: 'Aggiorna recenti', pendingLabel: 'Aggiornamento…', onClick: refreshRecents }
                : { label: 'Scegli cartella', onClick: openWorkspace }}
              error={homeFailure.error}
            />}
          </div>
        </div>
      </section>
    </Tabs.Content>
  )
}
