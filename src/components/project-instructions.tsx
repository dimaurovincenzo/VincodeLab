import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw, Save, ScrollText } from 'lucide-react'
import { Button, ErrorNotice, Field, toast } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { commitVolatileDraft, discardVolatileDraft, restoreVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import { normalizeUserError, reportUserError, type NormalizeUserErrorOptions, type UserError } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { aiStyles } from '@/theme/styles/ai'

type Props = {
  workspace?: string
  onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void
}

type InstructionsRecovery = 'clear' | 'discard' | 'reload' | 'save'
type InstructionsFailure = { error: UserError; recovery: InstructionsRecovery }

function projectInstructionsError(error: unknown, options: NormalizeUserErrorOptions) {
  return reportUserError(normalizeUserError(error, {
    component: 'project-instructions',
    recoverable: true,
    ...options,
  }))
}

function instructionsDraftIdentity(workspace: string): VolatileDraftIdentity {
  return { scope: 'project-instructions', workspace, resource: '.pi/APPEND_SYSTEM.md' }
}

export function ProjectInstructions({ workspace, onWorkspaceGuardChange }: Props) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [exists, setExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<UserError | null>(null)
  const [operationFailure, setOperationFailure] = useState<InstructionsFailure | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const loadRequestId = useRef(0)
  const workspaceRef = useRef<string | null>(workspace ?? null)
  const contentRef = useRef('')
  const savedContentRef = useRef('')
  const savingRef = useRef(false)
  const existsRef = useRef(false)
  const saveJobRef = useRef<Promise<boolean> | null>(null)

  const loadInstructions = useCallback(async () => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setLoadError(null)
    try {
      const activeWorkspace = workspace ? { path: workspace } : await window.vincodeLab.workspace.getActive()
      if (!activeWorkspace?.path) throw new Error('Nessun workspace attivo per le istruzioni progetto.')
      const result = await window.vincodeLab.instructions.get()
      if (requestId !== loadRequestId.current) return
      const nextContent = restoreVolatileDraft(instructionsDraftIdentity(activeWorkspace.path), result.content)
      workspaceRef.current = activeWorkspace.path
      contentRef.current = nextContent
      savedContentRef.current = result.content
      existsRef.current = result.exists
      setContent(nextContent)
      setSavedContent(result.content)
      setExists(result.exists)
    } catch (error) {
      if (requestId !== loadRequestId.current) return
      setLoadError(projectInstructionsError(error, {
        category: 'filesystem',
        operation: 'load-project-instructions',
        title: 'Istruzioni progetto non disponibili',
        description: 'Il file delle istruzioni non è stato letto. Le eventuali modifiche locali restano conservate.',
      }))
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [workspace])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void loadInstructions() })
    return () => {
      active = false
      loadRequestId.current += 1
    }
  }, [loadInstructions])

  const persistInstructions = useCallback(() => {
    if (saveJobRef.current) return saveJobRef.current
    const nextContent = contentRef.current
    const requestWorkspace = workspaceRef.current
    if (nextContent === savedContentRef.current) return Promise.resolve(false)

    savingRef.current = true
    setSaving(true)
    const job = (async () => {
      try {
        await window.vincodeLab.instructions.save(nextContent)
        if (requestWorkspace) commitVolatileDraft(instructionsDraftIdentity(requestWorkspace), nextContent)
        savedContentRef.current = nextContent
        existsRef.current = true
        setExists(true)
        setSavedContent(nextContent)
        return true
      } finally {
        saveJobRef.current = null
        savingRef.current = false
        setSaving(false)
      }
    })()
    saveJobRef.current = job
    return job
  }, [])

  const save = async () => {
    setOperationFailure(null)
    try {
      if (await persistInstructions()) toast.success('Istruzioni progetto salvate.', { description: '.pi/APPEND_SYSTEM.md' })
    } catch (error) {
      setOperationFailure({
        error: projectInstructionsError(error, {
          category: 'filesystem',
          operation: 'save-project-instructions',
          title: 'Istruzioni progetto non salvate',
          description: 'Le modifiche sono rimaste nell’editor e possono essere salvate di nuovo.',
        }),
        recovery: 'save',
      })
    }
  }

  const clearConfirmed = async () => {
    setSaving(true)
    setOperationFailure(null)
    try {
      await window.vincodeLab.instructions.clear()
      if (workspaceRef.current) discardVolatileDraft(instructionsDraftIdentity(workspaceRef.current))
      contentRef.current = ''
      savedContentRef.current = ''
      existsRef.current = false
      setContent('')
      setSavedContent('')
      setExists(false)
      toast.success('Istruzioni del workspace rimosse.')
    } catch (error) {
      setOperationFailure({
        error: projectInstructionsError(error, {
          category: 'filesystem',
          operation: 'clear-project-instructions',
          title: 'Istruzioni progetto non rimosse',
          description: 'Il file è rimasto invariato. Puoi riprovare senza perdere il contenuto corrente.',
        }),
        recovery: 'clear',
      })
    } finally {
      setSaving(false)
    }
  }

  const clear = () => {
    const unsavedWarning = content !== savedContent
      ? ' Le modifiche non salvate verranno scartate.'
      : ''
    setConfirmation({ title: 'Ripristina istruzioni progetto', detail: `Il file .pi/APPEND_SYSTEM.md verrà rimosso. Il prompt generale di Pi resterà invariato.${unsavedWarning}`, confirmLabel: 'Ripristina', destructive: true, onConfirm: () => void clearConfirmed() })
  }

  const reloadPi = async () => {
    setOperationFailure(null)
    try {
      await window.vincodeLab.pi.reload()
      toast.success('Pi sta ricaricando le istruzioni progetto.')
    } catch (error) {
      setOperationFailure({
        error: projectInstructionsError(error, {
          category: 'process',
          operation: 'reload-pi-project-instructions',
          title: 'Pi non ha ricaricato le istruzioni',
          description: 'Le istruzioni salvate restano disponibili. Riprova quando la sessione AI è pronta.',
        }),
        recovery: 'reload',
      })
    }
  }

  const hasUnsavedChanges = content !== savedContent

  const discardAll = useCallback(async () => {
    const baseline = savedContentRef.current
    const baselineExists = existsRef.current
    const pendingSave = saveJobRef.current
    try {
      if (pendingSave) {
        await pendingSave.catch(() => {
          // La recovery seguente riscrive esplicitamente la baseline; il failure della
          // write concorrente è già stato presentato dal salvataggio che l'ha avviata.
        })
        if (baselineExists) await window.vincodeLab.instructions.save(baseline)
        else await window.vincodeLab.instructions.clear()
      }
      contentRef.current = baseline
      savedContentRef.current = baseline
      existsRef.current = baselineExists
      setContent(baseline)
      setSavedContent(baseline)
      setExists(baselineExists)
      if (workspaceRef.current) discardVolatileDraft(instructionsDraftIdentity(workspaceRef.current))
    } catch (error) {
      setOperationFailure({
        error: projectInstructionsError(error, {
          category: 'persistence',
          operation: 'discard-project-instruction-changes',
          title: 'Modifiche alle istruzioni non annullate',
          description: 'Le modifiche sono state mantenute per evitare perdite. Puoi riprovare.',
        }),
        recovery: 'discard',
      })
      throw error
    }
  }, [])

  const discardChanges = () => {
    void discardAll().then(() => toast.info('Modifiche non salvate annullate.')).catch(() => {
      // discardAll mantiene il draft e possiede già il feedback locale del failure.
    })
  }

  const saveAll = useCallback(async () => {
    try {
      while (contentRef.current !== savedContentRef.current) await persistInstructions()
    } catch (error) {
      setOperationFailure({
        error: projectInstructionsError(error, {
          category: 'persistence',
          operation: 'save-project-instructions-before-workspace-change',
          title: 'Cambio workspace sospeso',
          description: 'Le istruzioni non sono state salvate. Le modifiche restano nel workspace corrente e puoi riprovare.',
        }),
        recovery: 'save',
      })
      throw error
    }
  }, [persistInstructions])

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => contentRef.current !== savedContentRef.current,
      saveAll,
      discardAll,
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [discardAll, onWorkspaceGuardChange, saveAll])

  const retryOperation = () => {
    if (!operationFailure) return
    if (operationFailure.recovery === 'clear') return void clearConfirmed()
    if (operationFailure.recovery === 'discard') {
      void discardAll().then(() => {
        setOperationFailure(null)
        toast.info('Modifiche non salvate annullate.')
      }).catch(() => {
        // discardAll ha mantenuto la bozza e aggiornato il feedback contestuale.
      })
      return
    }
    if (operationFailure.recovery === 'reload') return void reloadPi()
    void save()
  }

  return (
    <section className={aiStyles.instructionsPage} aria-label="Istruzioni progetto">
      <div className={aiStyles.paneHeader}>
        <div className={aiStyles.paneHeaderCopy}>
          <h1 className={aiStyles.instructionsTitle}><ScrollText aria-hidden="true" size={17} /> Istruzioni progetto</h1>
          <p><code>.pi/APPEND_SYSTEM.md</code> {loadError ? 'lettura non disponibile' : loading ? 'lettura in corso' : hasUnsavedChanges ? 'modificato, non salvato' : exists ? 'attivo' : 'non presente'}</p>
        </div>
        <div className={aiStyles.editorActions}>
          <Button variant="outline" size="sm" onClick={() => void reloadPi()}><RefreshCw aria-hidden="true" /> Ricarica Pi</Button>
          {hasUnsavedChanges && <Button variant="outline" size="sm" onClick={discardChanges} disabled={saving}>Annulla modifiche</Button>}
          {exists && <Button tone="danger" variant="outline" size="sm" onClick={clear} disabled={saving}><RotateCcw aria-hidden="true" /> Ripristina</Button>}
          <Button size="sm" onClick={() => void save()} disabled={saving || loading || !hasUnsavedChanges}><Save aria-hidden="true" /> Salva modifiche</Button>
        </div>
      </div>
      <div className={aiStyles.advisory}><AlertTriangle aria-hidden="true" size={15} /> Questo file aggiunge istruzioni al prompt generale Pi solo per il workspace aperto. Dopo il salvataggio usa “Ricarica Pi”.</div>
      {loadError && <ErrorNotice error={loadError} action={{ label: 'Riprova', onClick: loadInstructions }} />}
      {operationFailure && <ErrorNotice error={operationFailure.error} action={{ label: 'Riprova', onClick: retryOperation }} />}
      <Field.Root className={aiStyles.editorField}><Field.Textarea className={aiStyles.editorTextarea} disabled={loading || Boolean(loadError)} value={content} onChange={(event) => {
        const nextContent = event.target.value
        contentRef.current = nextContent
        setContent(nextContent)
        if (workspaceRef.current) writeVolatileDraft(instructionsDraftIdentity(workspaceRef.current), nextContent, savedContentRef.current)
      }} placeholder={'# Istruzioni progetto\n\nDefinisci qui le regole aggiuntive per Pi in questo workspace.'} spellCheck={false} aria-label="Istruzioni progetto" aria-describedby="instructions-context" /></Field.Root>
      <p className={aiStyles.instructionsContext} id="instructions-context">Le istruzioni si applicano solo al workspace aperto.</p>
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />
    </section>
  )
}
