import { useCallback, useRef, useState, type RefObject } from 'react'
import { toast } from '@/components/ui'
import { databaseBridge } from '../api/database.bridge'
import type { DatabaseToolbarAction } from '../model/database.types'
import { reportDatabaseFailure, showDatabaseErrorToast } from '../services/database-error'
import type { DatabaseTableDraftGuard } from '../components/database-table-grid'

type UseDatabaseTransactionsOptions = {
  onTransactionFinished: () => void
  selected: DatabaseConnection | null
  selectedConnectionId: RefObject<string | null>
  tableDraftGuard: RefObject<DatabaseTableDraftGuard | null>
}

export function useDatabaseTransactions({ onTransactionFinished, selected, selectedConnectionId, tableDraftGuard }: UseDatabaseTransactionsOptions) {
  const [transactionActive, setTransactionActive] = useState(false)
  const [toolbarAction, setToolbarAction] = useState<DatabaseToolbarAction>(null)
  const transactionActiveRef = useRef(transactionActive)
  const transactionConnectionId = useRef<string | null>(null)
  const toolbarActionRef = useRef(toolbarAction)

  const publishTransactionActive = useCallback((active: boolean, connectionId: string | null = selectedConnectionId.current) => {
    transactionActiveRef.current = active
    transactionConnectionId.current = active ? connectionId : null
    setTransactionActive(active)
  }, [selectedConnectionId])

  const publishToolbarAction = useCallback((action: DatabaseToolbarAction) => {
    toolbarActionRef.current = action
    setToolbarAction(action)
  }, [])

  async function begin() {
    if (!selected || toolbarActionRef.current) return
    const connectionId = selected.id
    publishToolbarAction('begin')
    try {
      const outcome = await databaseBridge.database.begin(connectionId)
      if (selectedConnectionId.current === connectionId) publishTransactionActive(outcome.active, connectionId)
      toast.success('Transazione avviata.', { description: 'Le modifiche restano temporanee finché non scegli Commit.' })
    } catch (error) {
      const incident = reportDatabaseFailure(error, 'begin-transaction', 'Transazione non avviata', 'Nessuna modifica è stata applicata. Controlla la connessione e riprova.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void begin() } })
    } finally {
      publishToolbarAction(null)
    }
  }

  const finishTransactionCore = async (action: 'commit' | 'rollback') => {
    const connectionId = transactionConnectionId.current ?? selectedConnectionId.current
    if (!connectionId) throw new Error('La connessione della transazione non è più disponibile.')
    if (toolbarActionRef.current) throw new Error('Attendi il completamento dell’operazione Database in corso e riprova.')
    publishToolbarAction(action)
    try {
      const outcome = await databaseBridge.database[action](connectionId)
      if (outcome.active) throw new Error('Il database segnala che la transazione è ancora attiva.')
      publishTransactionActive(false)
      if (selectedConnectionId.current === connectionId) onTransactionFinished()
    } finally {
      publishToolbarAction(null)
    }
  }

  async function finishTransaction(action: 'commit' | 'rollback') {
    if (!transactionActiveRef.current) return
    if (action === 'commit' && tableDraftGuard.current?.hasChanges()) {
      toast.warning('Commit non eseguito.', { description: 'Salva o annulla prima le modifiche locali della griglia.' })
      return
    }
    try {
      await finishTransactionCore(action)
      toast.success(action === 'commit' ? 'Transazione confermata.' : 'Transazione annullata.')
    } catch (error) {
      const incident = reportDatabaseFailure(error, `${action}-transaction`, action === 'commit' ? 'Commit non completato' : 'Rollback non completato', 'La transazione resta attiva. Verifica lo stato della connessione e riprova la stessa azione.')
      showDatabaseErrorToast(incident, { label: 'Riprova', onClick: () => { void finishTransaction(action) } })
    }
  }

  return {
    begin,
    finishTransaction,
    finishTransactionCore,
    publishToolbarAction,
    publishTransactionActive,
    toolbarAction,
    toolbarActionRef,
    transactionActive,
    transactionActiveRef,
  }
}
