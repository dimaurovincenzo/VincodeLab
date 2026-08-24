import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitFileStatus } from '@/bridge'
import { toast } from '@/components/ui'
import { editorBridge } from '../api/editor.bridge'
import { gitStatusMap } from '../model/editor-git'
import { gitStatusWarningToastId, showGitStatusWarning } from '../services/editor-error'

export function useEditorGitStatus() {
  const [statusByPath, setStatusByPath] = useState<Map<string, GitFileStatus>>(new Map())

  const refresh = useCallback(async () => {
    const result = await editorBridge.github.gitStatus({ force: true })
    setStatusByPath(gitStatusMap(result.data))
    toast.remove(gitStatusWarningToastId)
  }, [])

  const refreshFromWarning = useCallback(() => {
    const retry = () => {
      void refresh().then(() => {
        toast.success('Stato Git aggiornato.')
      }).catch((error) => {
        showGitStatusWarning(error, {
          operation: 'refresh-git-status',
          title: 'Stato Git non aggiornato',
          fallbackDescription: 'L’Explorer resta operativo. Verifica il repository e riprova ad aggiornare gli indicatori Git.',
        }, retry)
      })
    }
    retry()
  }, [refresh])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(refresh).catch((error) => {
      if (!active) return
      showGitStatusWarning(error, {
        operation: 'load-git-status',
        title: 'Stato Git non disponibile',
        fallbackDescription: 'L’Explorer resta operativo senza indicatori Git.',
      }, refreshFromWarning)
    })
    return () => { active = false }
  }, [refresh, refreshFromWarning])

  const statusByDirectory = useMemo(() => {
    const directories = new Map<string, number>()
    for (const [filePath, file] of statusByPath) {
      if (file.previousPath === filePath) continue
      const segments = filePath.split('/').filter(Boolean)
      for (let index = 1; index < segments.length; index += 1) {
        const directoryId = segments.slice(0, index).join('/')
        directories.set(directoryId, (directories.get(directoryId) ?? 0) + 1)
      }
    }
    return directories
  }, [statusByPath])

  return { refresh, refreshFromWarning, statusByDirectory, statusByPath }
}
