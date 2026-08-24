import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, FolderOpen } from 'lucide-react'
import { Button, ErrorNotice, Popover } from '@/components/ui'
import { workspaceBridge } from '../api/workspace.bridge'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import { workspaceSwitcherStyles } from '@/theme/styles/home'

type Props = {
  appIconUrl: string
  currentPath: string | null
  recents: RecentWorkspace[]
  onChooseDirectory: () => void
  onOpenHere: (workspacePath: string) => void
  onOpenNew: (workspacePath: string) => Promise<boolean>
}

type WorkspaceSwitcherFailure =
  | { error: UserError; kind: 'status' }
  | { error: UserError; kind: 'open-new'; workspacePath: string }

function workspaceName(workspacePath: string) {
  return workspacePath.split('/').filter(Boolean).at(-1) ?? workspacePath
}

export function WorkspaceSwitcher({ appIconUrl, currentPath, recents, onChooseDirectory, onOpenHere, onOpenNew }: Props) {
  const [open, setOpen] = useState(false)
  const [loadingStatuses, setLoadingStatuses] = useState(false)
  const [openingNewPath, setOpeningNewPath] = useState<string | null>(null)
  const [failure, setFailure] = useState<WorkspaceSwitcherFailure | null>(null)
  const [statuses, setStatuses] = useState<Record<string, WorkspaceInstanceStatus>>({})
  const statusRequest = useRef(0)

  const workspaces = useMemo(() => {
    const byPath = new Map<string, RecentWorkspace>()
    if (currentPath) byPath.set(currentPath, recents.find((recent) => recent.path === currentPath) ?? { path: currentPath, lastOpenedAt: 0 })
    for (const recent of recents) if (!byPath.has(recent.path)) byPath.set(recent.path, recent)
    return [...byPath.values()]
  }, [currentPath, recents])

  const loadStatuses = useCallback(async () => {
    const request = ++statusRequest.current
    setLoadingStatuses(true)
    try {
      const entries = await Promise.all(workspaces.map(async ({ path }) => [path, await workspaceBridge.workspace.instanceStatus(path)] as const))
      if (request !== statusRequest.current) return
      setStatuses(Object.fromEntries(entries))
      setFailure((current) => current?.kind === 'status' ? null : current)
    } catch (cause) {
      if (request !== statusRequest.current) return
      setStatuses({})
      setFailure({
        error: reportUserError(normalizeUserError(cause, {
          category: 'internal',
          component: 'workspace-switcher',
          operation: 'load-instance-statuses',
          severity: 'warning',
          title: 'Stato delle finestre non disponibile',
          description: 'Non è possibile verificare se i workspace possono essere aperti in una nuova finestra. La finestra corrente resta operativa.',
        })),
        kind: 'status',
      })
    } finally {
      if (request === statusRequest.current) setLoadingStatuses(false)
    }
  }, [workspaces])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) void loadStatuses() })
    return () => {
      cancelled = true
      statusRequest.current += 1
    }
  }, [loadStatuses, open])

  const openNew = async (workspacePath: string) => {
    setOpeningNewPath(workspacePath)
    try {
      if (await onOpenNew(workspacePath)) {
        setFailure(null)
        setOpen(false)
      }
    } catch (cause) {
      setFailure({
        error: reportUserError(normalizeUserError(cause, {
          category: 'process',
          component: 'workspace-switcher',
          operation: 'open-workspace-in-new-window',
          title: 'Workspace non aperto in una nuova finestra',
          description: 'Il workspace è rimasto disponibile nella finestra corrente. Puoi riprovare senza interrompere il lavoro.',
        })),
        kind: 'open-new',
        workspacePath,
      })
    } finally {
      setOpeningNewPath(null)
    }
  }

  const recoveryAction = failure?.kind === 'status'
    ? { label: 'Riprova verifica', onClick: loadStatuses, pendingLabel: 'Nuova verifica…' }
    : failure?.kind === 'open-new'
      ? { label: 'Riprova apertura', onClick: () => openNew(failure.workspacePath), pendingLabel: 'Apertura…' }
      : undefined

  return <Popover.Root open={open} positioning={{ placement: 'bottom' }} onOpenChange={({ open: nextOpen }) => {
      setOpen(nextOpen)
    }}><div className={workspaceSwitcherStyles.root}>
    <Popover.Trigger asChild><Button variant="plain" className={workspaceSwitcherStyles.trigger} title={currentPath ?? 'Seleziona workspace'}>
      <img className={workspaceSwitcherStyles.icon} src={appIconUrl} alt="" />
      <span className={workspaceSwitcherStyles.appName}>VincodeLab</span>
      {currentPath && <span className={workspaceSwitcherStyles.projectName}>{workspaceName(currentPath)}</span>}
      <ChevronDown aria-hidden="true" size={14} />
    </Button></Popover.Trigger>

    <Popover.Portal><Popover.Positioner><Popover.Content aria-label="Cambia workspace" className={workspaceSwitcherStyles.panel}>
      <header className={workspaceSwitcherStyles.header}>
        <div className={workspaceSwitcherStyles.headerCopy}><strong className={workspaceSwitcherStyles.headerTitle}>Workspace</strong><span className={workspaceSwitcherStyles.headerCount}>{workspaces.length} recenti</span></div>
        <Button size="sm" variant="outline" onClick={() => { setOpen(false); onChooseDirectory() }}><FolderOpen aria-hidden="true" /> Apri cartella…</Button>
      </header>
      {failure && <div className={workspaceSwitcherStyles.notice}><ErrorNotice action={recoveryAction} error={failure.error} /></div>}
      <div className={workspaceSwitcherStyles.list}>
        {workspaces.map(({ path }) => {
          const status = statuses[path]
          const isCurrent = path === currentPath
          const statusMessage = status?.workspaceOpenElsewhere
            ? "Progetto già aperto in un'altra finestra"
            : status && !status.canOpenNew
              ? 'Limite di due finestre raggiunto'
              : loadingStatuses ? 'Verifica finestre…' : null
          return <article className={workspaceSwitcherStyles.row({ current: isCurrent })} key={path}>
            <span className={workspaceSwitcherStyles.rowIcon}><FolderOpen aria-hidden="true" size={16} /></span>
            <span className={workspaceSwitcherStyles.rowCopy} title={path}><strong className={workspaceSwitcherStyles.rowName}>{workspaceName(path)}</strong><small className={workspaceSwitcherStyles.rowPath}>{path}</small>{statusMessage && <em className={workspaceSwitcherStyles.rowStatus}>{statusMessage}</em>}</span>
            <span className={workspaceSwitcherStyles.rowActions}>
              <Button disabled={isCurrent} size="xs" variant="outline" onClick={() => { setOpen(false); onOpenHere(path) }}>{isCurrent ? 'Aperto qui' : 'Apri qui'}</Button>
              <Button aria-busy={openingNewPath === path} disabled={isCurrent || loadingStatuses || openingNewPath !== null || !status?.canOpenNew || status?.workspaceOpenElsewhere} size="xs" variant="outline" onClick={() => void openNew(path)} title={failure?.kind === 'status' ? 'Verifica finestre non disponibile' : statusMessage ?? 'Apri in una nuova finestra'}><ExternalLink aria-hidden="true" /> Nuova finestra</Button>
            </span>
          </article>
        })}
        {workspaces.length === 0 && <div className={workspaceSwitcherStyles.empty}><FolderOpen aria-hidden="true" /><span>Nessun workspace recente.</span></div>}
      </div>
    </Popover.Content></Popover.Positioner></Popover.Portal>
  </div></Popover.Root>
}
