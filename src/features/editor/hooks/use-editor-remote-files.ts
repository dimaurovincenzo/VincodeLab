import { useCallback } from 'react'
import type { RemoteTrackedFile } from '@/bridge'
import { toast } from '@/components/ui'
import { editorBridge } from '../api/editor.bridge'
import { reportEditorFailure } from '../services/editor-error'
import type { EditorTabStore } from './use-editor-tab-store'

export function useEditorRemoteFiles(store: EditorTabStore) {
  const {
    activeIdRef,
    remoteDiffFile,
    setConfirmation,
    setDocumentFailure,
    setRemoteComparison,
    setRemoteDiffFile,
    setTabs,
    setUploadingRemote,
    tabsRef,
    uploadingRemote,
  } = store

  const updateRemoteTab = useCallback((file: RemoteTrackedFile) => {
    setTabs((current) => {
      const next = current.map((entry) => entry.source === 'remote' && entry.remote?.file.id === file.id
        ? { ...entry, remote: { ...entry.remote, file } }
        : entry)
      tabsRef.current = next
      return next
    })
  }, [setTabs, tabsRef])

  const compareRemoteFile = useCallback(async () => {
    const tab = tabsRef.current.find((entry) => entry.id === activeIdRef.current)
    if (!tab?.remote) return
    if (tab.content !== tab.savedContent) {
      toast.info('Salva prima la copia locale per confrontarla con il server.')
      return
    }
    try {
      const comparison = await editorBridge.remoteFiles.compare(tab.remote.file.id)
      const tracked = (await editorBridge.remoteFiles.listTracked()).find((entry) => entry.id === tab.remote?.file.id) ?? tab.remote.file
      updateRemoteTab(tracked)
      setRemoteDiffFile(tracked)
      setRemoteComparison(comparison)
      setDocumentFailure((current) => current?.fileId === tab.id ? null : current)
    } catch (error) {
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'remote',
          operation: 'compare-remote-file',
          title: 'Confronto remoto non disponibile',
          fallbackDescription: 'La copia locale è rimasta invariata. Riconnetti il server e riprova il confronto.',
        }),
        fileId: tab.id,
        recovery: { kind: 'compare-remote' },
      })
    }
  }, [activeIdRef, setDocumentFailure, setRemoteComparison, setRemoteDiffFile, tabsRef, updateRemoteTab])

  const uploadRemoteFile = useCallback(async (force: boolean) => {
    const file = remoteDiffFile
    if (!file || uploadingRemote) return
    setUploadingRemote(true)
    try {
      const result = await editorBridge.remoteFiles.upload(file.id, { force })
      if (result.status === 'conflict') {
        const comparison = await editorBridge.remoteFiles.compare(file.id)
        const tracked = (await editorBridge.remoteFiles.listTracked()).find((entry) => entry.id === file.id) ?? { ...file, localState: 'conflict' as const }
        updateRemoteTab(tracked)
        setRemoteDiffFile(tracked)
        setRemoteComparison(comparison)
        toast.warning('Il file sul server è cambiato. Verifica il conflitto prima di forzare la sostituzione.')
        return
      }
      if (result.file) updateRemoteTab(result.file)
      setRemoteComparison(null)
      setRemoteDiffFile(null)
      setDocumentFailure((current) => current?.fileId === `remote:${file.id}` ? null : current)
      toast.success('File caricato sul server.', { description: file.remotePath })
    } catch (error) {
      setDocumentFailure({
        error: reportEditorFailure(error, {
          category: 'remote',
          operation: 'upload-remote-file',
          title: 'File non caricato sul server',
          fallbackDescription: 'La copia locale è rimasta al sicuro. Riconnetti il server e riprova; il file remoto non è stato sostituito.',
        }),
        fileId: `remote:${file.id}`,
        recovery: { kind: 'upload-remote', force },
      })
    } finally {
      setUploadingRemote(false)
    }
  }, [remoteDiffFile, setDocumentFailure, setRemoteComparison, setRemoteDiffFile, setUploadingRemote, updateRemoteTab, uploadingRemote])

  const requestRemoteUpload = useCallback((force: boolean) => {
    if (!remoteDiffFile) return
    setConfirmation({
      title: force ? 'Forza sostituzione sul server' : 'Carica il file sul server',
      detail: force
        ? `La versione remota di “${remoteDiffFile.name}” è cambiata. Forzando il caricamento sostituirai comunque il contenuto sul server.`
        : `La copia locale di “${remoteDiffFile.name}” sostituirà il file remoto. Il salvataggio nell’Editor resta separato da questa operazione.`,
      confirmLabel: force ? 'Forza sostituzione' : 'Carica sul server',
      destructive: force,
      onConfirm: () => void uploadRemoteFile(force),
    })
  }, [remoteDiffFile, setConfirmation, uploadRemoteFile])

  return { compareRemoteFile, requestRemoteUpload, uploadRemoteFile }
}
