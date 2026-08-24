import { toast } from '@/components/ui'
import { githubBridge } from '../api/github.bridge'
import { projectFieldDataType } from '../model/github-projects'
import type { GitHubErrors } from './use-github-errors'
import type { GitHubWorkspaceState } from './use-github-workspace-state'

export function useGitHubProjectActions(state: GitHubWorkspaceState, errors: GitHubErrors) {
  const {
    beginBusy,
    board,
    boardRequests,
    data,
    editingProject,
    endBusy,
    getSelectedProject,
    githubDataRequests,
    projectEditDescription,
    projectEditTitle,
    projectFieldDrafts,
    projectFieldRequests,
    projectTitle,
    selectProject,
    setBoard,
    setBoardCache,
    setBoardItemDialogOpen,
    setBoardItemDialogTrigger,
    setData,
    setEditingProject,
    setLoadingBoard,
    setLoadingProjectFields,
    setProjectEditDescription,
    setProjectEditTitle,
    setProjectFieldDrafts,
    setProjectFieldValues,
    setProjectPickerCollapsed,
    setProjectTitle,
    setSelectedBoardItemId,
  } = state
  const { clearSurfaceError, publishSurfaceError } = errors

  const loadBoard = async (projectNumber: number) => {
    const requestId = boardRequests.begin()
    projectFieldRequests.invalidate()
    setLoadingProjectFields(false)
    beginBusy()
    setLoadingBoard(true)
    selectProject(projectNumber)
    setProjectPickerCollapsed(true)
    if (board?.project.number !== projectNumber) setBoard(null)
    try {
      const nextBoard = await githubBridge.projectBoard(projectNumber)
      if (!boardRequests.isCurrent(requestId)) return
      if (getSelectedProject() !== projectNumber) return
      setBoard(nextBoard.data)
      setBoardCache(nextBoard.cache)
      clearSurfaceError('board')
    } catch (nextError) {
      if (boardRequests.isCurrent(requestId) && getSelectedProject() === projectNumber) publishSurfaceError('board', nextError, {
        action: `La lettura del Project #${projectNumber}`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: 'load-github-project-board',
        preserved: board?.project.number === projectNumber ? 'La board precedente resta visibile.' : undefined,
        recovery: 'Riprova a caricare il Project',
        title: 'Board del Project non disponibile',
      })
    } finally {
      if (boardRequests.isCurrent(requestId)) setLoadingBoard(false)
      endBusy()
    }
  }

  const createProject = async () => {
    if (!projectTitle.trim()) return
    beginBusy()
    try {
      const projects = await githubBridge.createProject(projectTitle)
      githubDataRequests.invalidate()
      setData((current) => current ? { ...current, projects } : current)
      setProjectTitle('')
      clearSurfaceError('projects')
      toast.success('Progetto creato e collegato al workspace')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: 'La creazione del Project',
        operation: 'create-github-project',
        preserved: 'Il titolo inserito è stato mantenuto.',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non creato',
      })
    } finally {
      endBusy()
    }
  }

  const startProjectEdit = (project: GitHubProject) => {
    setEditingProject(project)
    setProjectEditTitle(project.title)
    setProjectEditDescription(project.shortDescription)
  }

  const editProjectConfirmed = async (project: GitHubProject) => {
    beginBusy()
    try {
      const projects = await githubBridge.editProject(project.number, projectEditTitle, projectEditDescription)
      githubDataRequests.invalidate()
      setData((current) => current ? { ...current, projects } : current)
      setEditingProject(null)
      clearSurfaceError('projects')
      toast.success('Project aggiornato')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: `L’aggiornamento di “${project.title}”`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: 'edit-github-project',
        preserved: 'Le modifiche al modulo sono state mantenute.',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non aggiornato',
      })
    } finally {
      endBusy()
    }
  }

  const requestProjectEdit = () => {
    if (!editingProject || !projectEditTitle.trim()) return
    state.setConfirmation({ title: 'Aggiorna Project', detail: `Le informazioni di “${editingProject.title}” verranno aggiornate.`, confirmLabel: 'Salva Project', onConfirm: () => void editProjectConfirmed(editingProject) })
  }

  const closeProjectConfirmed = async (project: GitHubProject) => {
    beginBusy()
    try {
      const projects = await githubBridge.closeProject(project.number, !project.closed)
      githubDataRequests.invalidate()
      setData((current) => current ? { ...current, projects } : current)
      clearSurfaceError('projects')
      toast.success(project.closed ? 'Project riaperto' : 'Project chiuso')
    } catch (nextError) {
      publishSurfaceError('projects', nextError, {
        action: project.closed ? `La riapertura di “${project.title}”` : `La chiusura di “${project.title}”`,
        notFoundTitle: 'Project GitHub non disponibile',
        operation: project.closed ? 'reopen-github-project' : 'close-github-project',
        recovery: 'Aggiorna i Projects prima di decidere se riprovare',
        title: 'Project GitHub non aggiornato',
      })
    } finally {
      endBusy()
    }
  }

  const requestProjectClose = (project: GitHubProject) => {
    const reopening = project.closed
    state.setConfirmation({
      title: reopening ? 'Riapri Project' : 'Chiudi Project',
      detail: reopening ? `“${project.title}” tornerà disponibile per le attività del workspace.` : `“${project.title}” verrà chiuso. Le attività resteranno conservate.`,
      confirmLabel: reopening ? 'Riapri Project' : 'Chiudi Project',
      destructive: !reopening,
      onConfirm: () => void closeProjectConfirmed(project),
    })
  }

  const updateBoardStatusConfirmed = async (item: GitHubProjectItem, optionId: string, statusField: GitHubProjectField, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await githubBridge.updateProjectItem(projectNumber, item.id, statusField.id, { type: 'singleSelect', optionId })
      boardRequests.invalidate()
      projectFieldRequests.invalidate()
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      clearSurfaceError('board')
      toast.success('Stato del progetto aggiornato')
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: 'L’aggiornamento dello stato dell’attività',
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'update-github-project-item-status',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: 'Stato dell’attività non aggiornato',
      })
    } finally {
      endBusy()
    }
  }

  const updateBoardStatus = (item: GitHubProjectItem, optionId: string) => {
    const statusField = board?.fields.find((field) => field.name.toLowerCase() === 'status' || field.name.toLowerCase() === 'stato')
    if (!board || !statusField) return
    state.setConfirmation({ title: 'Aggiorna stato', detail: `Lo stato di “${item.content?.title ?? item.title ?? 'elemento'}” verrà aggiornato.`, confirmLabel: 'Aggiorna stato', onConfirm: () => void updateBoardStatusConfirmed(item, optionId, statusField, board.project.number) })
  }

  const updateBoardFieldConfirmed = async (item: GitHubProjectItem, field: GitHubProjectField, update: GitHubProjectItemUpdate, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await githubBridge.updateProjectItem(projectNumber, item.id, field.id, update)
      boardRequests.invalidate()
      projectFieldRequests.invalidate()
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      const value = update.type === 'clear' || update.type === 'singleSelect' ? '' : String(update.value)
      setProjectFieldDrafts((current) => ({ ...current, [field.id]: value }))
      setProjectFieldValues((current) => ({ ...current, [field.id]: value }))
      clearSurfaceError('board')
      toast.success(`Campo “${field.name}” aggiornato`)
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: `L’aggiornamento del campo “${field.name}”`,
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'update-github-project-item-field',
        preserved: 'Il valore inserito è stato mantenuto.',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: `Campo “${field.name}” non aggiornato`,
      })
    } finally {
      endBusy()
    }
  }

  const saveBoardField = (item: GitHubProjectItem, field: GitHubProjectField) => {
    if (!board) return
    const value = projectFieldDrafts[field.id] ?? ''
    const dataType = projectFieldDataType(field)
    const update = dataType === 'text' ? { type: 'text' as const, value }
      : dataType === 'number' ? { type: 'number' as const, value: Number(value) }
        : dataType === 'date' ? { type: 'date' as const, value }
          : null
    if (!update || (update.type === 'number' && !Number.isFinite(update.value)) || (update.type === 'date' && !value)) return
    state.setConfirmation({ title: `Aggiorna ${field.name}`, detail: `Il campo “${field.name}” di “${item.content?.title ?? item.title ?? 'attività'}” verrà aggiornato.`, confirmLabel: 'Salva campo', onConfirm: () => void updateBoardFieldConfirmed(item, field, update, board.project.number) })
  }

  const clearBoardField = (item: GitHubProjectItem, field: GitHubProjectField) => {
    if (!board) return
    state.setConfirmation({ title: `Svuota ${field.name}`, detail: `Il valore di “${field.name}” per “${item.content?.title ?? item.title ?? 'attività'}” verrà rimosso.`, confirmLabel: 'Svuota', destructive: true, onConfirm: () => void updateBoardFieldConfirmed(item, field, { type: 'clear' }, board.project.number) })
  }

  const loadProjectItemFields = async (item: GitHubProjectItem, projectNumber: number) => {
    const request = projectFieldRequests.begin()
    setLoadingProjectFields(true)
    try {
      const fieldValues = await githubBridge.projectItemFields(projectNumber, item.id)
      if (!projectFieldRequests.isCurrent(request)) return
      setProjectFieldValues(fieldValues)
      setProjectFieldDrafts(fieldValues)
      clearSurfaceError('project-fields')
    } catch (nextError) {
      if (!projectFieldRequests.isCurrent(request)) return
      publishSurfaceError('project-fields', nextError, {
        action: 'La lettura dei campi dell’attività',
        notFoundTitle: 'Attività del Project non disponibile',
        operation: 'load-github-project-item-fields',
        preserved: 'La board e il dettaglio dell’attività restano visibili.',
        recovery: 'Riprova a leggere i campi',
        title: 'Campi dell’attività non disponibili',
      })
    } finally {
      if (projectFieldRequests.isCurrent(request)) setLoadingProjectFields(false)
    }
  }

  const selectBoardItem = async (item: GitHubProjectItem, trigger: HTMLButtonElement) => {
    if (!board) return
    setBoardItemDialogTrigger(trigger)
    setSelectedBoardItemId(item.id)
    setBoardItemDialogOpen(true)
    const loadedValues = item.fieldValues ?? {}
    setProjectFieldDrafts(loadedValues)
    setProjectFieldValues(loadedValues)
    setLoadingProjectFields(false)
    clearSurfaceError('project-fields')
    if (item.fieldValues) return
    await loadProjectItemFields(item, board.project.number)
  }

  const changeBoardItemDialogOpen = (open: boolean) => {
    setBoardItemDialogOpen(open)
    if (!open) {
      projectFieldRequests.invalidate()
      setLoadingProjectFields(false)
    }
  }

  const archiveBoardItemConfirmed = async (item: GitHubProjectItem, projectNumber: number) => {
    beginBusy()
    try {
      const nextBoard = await githubBridge.archiveProjectItem(projectNumber, item.id, false)
      boardRequests.invalidate()
      projectFieldRequests.invalidate()
      setLoadingBoard(false)
      setLoadingProjectFields(false)
      setBoard(nextBoard)
      clearSurfaceError('board')
      toast.success('Elemento archiviato')
    } catch (nextError) {
      publishSurfaceError('board', nextError, {
        action: 'L’archiviazione dell’attività',
        notFoundTitle: 'Attività o Project non disponibile',
        operation: 'archive-github-project-item',
        recovery: 'Ricarica la board prima di decidere se riprovare',
        title: 'Attività non archiviata',
      })
    } finally {
      endBusy()
    }
  }

  const archiveBoardItem = (item: GitHubProjectItem) => {
    if (!board) return
    state.setConfirmation({ title: 'Archivia attività', detail: `“${item.content?.title ?? item.title ?? 'Questo elemento'}” verrà rimosso dalla board.`, confirmLabel: 'Archivia', destructive: true, onConfirm: () => void archiveBoardItemConfirmed(item, board.project.number) })
  }

  const requestCreateProject = () => {
    if (!projectTitle.trim()) return
    state.setConfirmation({ title: 'Crea progetto', detail: `“${projectTitle.trim()}” verrà creato e collegato al repository ${data?.repository?.nameWithOwner ?? 'del workspace'}.`, confirmLabel: 'Crea progetto', onConfirm: () => void createProject() })
  }

  return {
    archiveBoardItem,
    changeBoardItemDialogOpen,
    clearBoardField,
    loadBoard,
    loadProjectItemFields,
    requestCreateProject,
    requestProjectClose,
    requestProjectEdit,
    saveBoardField,
    selectBoardItem,
    startProjectEdit,
    updateBoardStatus,
  }
}

export type GitHubProjectActions = ReturnType<typeof useGitHubProjectActions>
