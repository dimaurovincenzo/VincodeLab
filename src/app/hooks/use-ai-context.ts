import { useCallback, useMemo } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import { toast } from '@/components/ui'
import type { TerminalContextAction } from '@/features/ai'
import { reportTransientFailure } from '@/lib/renderer-error'
import type { AiInputFailureContext, AppSection, WorkbenchCommandContext } from '../model/app-controller.types'

type UseAiContextOptions = {
  databaseContext: WorkbenchCommandContext['database']
  editorContext: WorkbenchCommandContext['editor']
  githubContext: WorkbenchCommandContext['github']
  navigateToAppSection: (section: AppSection, focusPrimary?: boolean) => void
  sendAiInput: (data: string) => Promise<boolean>
}

function compactContextText(value: string, maxLength = 1_600) {
  const compact = value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact
}

export function useAiContext({ databaseContext, editorContext, githubContext, navigateToAppSection, sendAiInput }: UseAiContextOptions) {
  const writeAiInput = useCallback(async function writeAiInputAction(data: string, context: AiInputFailureContext) {
    try {
      return await sendAiInput(data)
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'process',
        component: 'ai-context',
        operation: context.operation,
        title: context.title,
        description: context.description,
      }, {
        label: 'Riprova',
        onClick: () => { void writeAiInputAction(data, context) },
      })
      return false
    }
  }, [sendAiInput])

  const insertEditorContextIntoAi = useCallback(async function insertEditorContextIntoAiAction(includeSelection: boolean) {
    if (!editorContext.activeFileId || editorContext.source !== 'workspace') return
    if (includeSelection && editorContext.dirty) {
      toast.info('Salva il file prima di inviare la selezione a Pi.', { description: 'Il riferimento deve corrispondere al contenuto disponibile nel workspace.' })
      return
    }
    try {
      const attachment = await appBridge.files.prepareAttachment(editorContext.activeFileId)
      const lineRange = includeSelection && editorContext.selection
        ? ` righe ${editorContext.selection.fromLine}–${editorContext.selection.toLine}`
        : ''
      const inserted = await writeAiInput(`@${attachment.absolutePath}${lineRange} `, {
        description: 'Il riferimento preparato è rimasto disponibile, ma non è stato aggiunto al prompt. La sessione AI non è stata modificata.',
        operation: includeSelection ? 'insert-editor-selection-context' : 'insert-editor-file-context',
        title: includeSelection ? 'Selezione non aggiunta al contesto AI' : 'File non aggiunto al contesto AI',
      })
      if (!inserted) return
      toast.success(includeSelection ? 'Selezione aggiunta al contesto AI.' : 'File aggiunto al contesto AI.', { description: editorContext.activeFileId })
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'filesystem',
        component: 'ai-context',
        operation: 'prepare-file-context',
        title: 'File non aggiunto al contesto AI',
        description: 'Il file e la sessione AI sono rimasti invariati. Puoi riprovare dopo aver verificato che il file sia ancora accessibile.',
      }, { label: 'Riprova', onClick: () => { void insertEditorContextIntoAiAction(includeSelection) } })
    }
  }, [editorContext, writeAiInput])

  const sendEditorContextToAi = useCallback((includeSelection: boolean) => {
    navigateToAppSection('ai', true)
    window.setTimeout(() => { void insertEditorContextIntoAi(includeSelection) }, 0)
  }, [insertEditorContextIntoAi, navigateToAppSection])

  const aiContextActions = useMemo<TerminalContextAction[]>(() => [
    ...(editorContext.activeFileId && editorContext.source === 'workspace' ? [{
      id: 'editor-file',
      label: editorContext.activeFileName ?? 'File corrente',
      description: `Inserisci ${editorContext.activeFileId} nel prompt`,
      onSelect: () => { void insertEditorContextIntoAi(false) },
    }] : []),
    ...(editorContext.selection && editorContext.activeFileId && editorContext.source === 'workspace' ? [{
      id: 'editor-selection',
      label: `Righe ${editorContext.selection.fromLine}–${editorContext.selection.toLine}`,
      description: editorContext.dirty ? 'Salva il file per usare questa selezione' : 'Inserisci il file e l’intervallo selezionato nel prompt',
      disabled: editorContext.dirty,
      onSelect: () => { void insertEditorContextIntoAi(true) },
    }] : []),
    ...(githubContext.selectedDiffPath ? [{
      id: 'git-diff',
      label: `Diff · ${githubContext.selectedDiffPath.split('/').at(-1)}`,
      description: `Chiedi a Pi di analizzare il diff Git di ${githubContext.selectedDiffPath}`,
      onSelect: () => {
        void writeAiInput(`Analizza il diff Git di ${githubContext.selectedDiffPath} `, {
          description: 'Il riferimento al diff non è stato aggiunto al prompt. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-git-diff-context',
          title: 'Diff non aggiunto al contesto AI',
        })
      },
    }] : githubContext.changedFiles.length > 0 ? [{
      id: 'git-changes',
      label: `${githubContext.changedFiles.length} modifiche Git`,
      description: 'Chiedi a Pi di analizzare le modifiche Git correnti',
      onSelect: () => {
        void writeAiInput('Analizza le modifiche Git correnti del workspace ', {
          description: 'Il riferimento alle modifiche Git non è stato aggiunto al prompt. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-git-changes-context',
          title: 'Modifiche Git non aggiunte al contesto AI',
        })
      },
    }] : []),
    ...(databaseContext.connectionId && databaseContext.sql.trim() ? [{
      id: 'database-query',
      label: `SQL · ${databaseContext.connectionName ?? 'connessione attiva'}`,
      description: 'Inserisci la query SQL corrente nel prompt senza eseguirla',
      onSelect: () => {
        void writeAiInput(`Contesto SQL (${databaseContext.connectionName ?? 'connessione attiva'}): ${compactContextText(databaseContext.sql)} `, {
          description: 'La query non è stata aggiunta al prompt e non è stata eseguita. Il contenuto della sessione AI è rimasto invariato.',
          operation: 'insert-database-query-context',
          title: 'Query non aggiunta al contesto AI',
        })
      },
    }] : []),
  ], [databaseContext, editorContext, githubContext, insertEditorContextIntoAi, writeAiInput])

  return { aiContextActions, sendEditorContextToAi }
}
