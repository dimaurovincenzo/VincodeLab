import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfirmationRequest } from '@/components/confirmation-dialog'
import { toast } from '@/components/ui'
import { settingsBridge } from '../api/settings.bridge'
import {
  isPackageSource,
  normalizePackageSource,
  packageSourceDraftIdentity,
} from '../model/settings-model'
import type { PackageSource } from '../model/settings.types'
import { settingsUserError } from '../services/settings-error'
import { discardVolatileDraft, latestVolatileDraft, writeVolatileDraft } from '@/lib/volatile-draft-store'
import type { SettingsRefreshController } from './use-settings-refresh'

function discardPackageSourceDrafts() {
  for (const source of ['npm', 'git', 'local'] as const) discardVolatileDraft(packageSourceDraftIdentity(source))
}

export function usePiPackages(
  refreshController: SettingsRefreshController,
  setConfirmation: (request: ConfirmationRequest | null) => void,
) {
  const {
    clearSectionFailure,
    markSectionOperation,
    mounted,
    publishSectionFailure,
    refresh,
  } = refreshController
  const restoredPackageDraft = useMemo(() => latestVolatileDraft('settings-package-source', 'global'), [])
  const [source, setSource] = useState(() => restoredPackageDraft?.content ?? '')
  const [packageSource, setPackageSource] = useState<PackageSource>(() => isPackageSource(restoredPackageDraft?.resource) ? restoredPackageDraft.resource : 'npm')
  const [packageBusy, setPackageBusy] = useState<string | null>(null)
  const sourceRef = useRef(source)
  const packageSourceRef = useRef(packageSource)

  useEffect(() => { sourceRef.current = source }, [source])

  function mutatePackage(action: 'install' | 'update' | 'remove', value: string): void {
    const installDraft = action === 'install'
      ? { content: sourceRef.current, source: packageSourceRef.current }
      : null
    setConfirmation({
      title: action === 'remove' ? 'Rimuovi pacchetto Pi' : action === 'install' ? 'Installa pacchetto Pi' : 'Aggiorna pacchetto Pi',
      detail: `L’azione verrà eseguita globalmente per Pi: ${value}`,
      confirmLabel: action === 'remove' ? 'Rimuovi' : action === 'install' ? 'Installa' : 'Aggiorna',
      destructive: action === 'remove',
      onConfirm: () => {
        void (async () => {
          markSectionOperation('packages')
          setPackageBusy(`${action}:${value}`)
          clearSectionFailure('packages')
          try {
            await settingsBridge.piSystem[action](value)
            if (!mounted.current) return
            toast.success('Operazione Pi completata.')
            if (
              installDraft
              && sourceRef.current === installDraft.content
              && packageSourceRef.current === installDraft.source
            ) {
              discardVolatileDraft(packageSourceDraftIdentity(installDraft.source))
              sourceRef.current = ''
              setSource('')
            }
            await refresh()
          } catch (cause) {
            if (!mounted.current) return
            const operationLabel = action === 'install' ? 'installato' : action === 'update' ? 'aggiornato' : 'rimosso'
            publishSectionFailure('packages', {
              error: settingsUserError(cause, {
                category: 'process',
                description: `Il pacchetto non è stato ${operationLabel}. La sorgente e l’elenco precedente sono rimasti disponibili.`,
                operation: `${action}-pi-package`,
                title: 'Pacchetto Pi non modificato',
              }),
              recovery: { label: 'Riprova', run: () => mutatePackage(action, value) },
            })
          } finally {
            if (mounted.current) setPackageBusy(null)
          }
        })()
      },
    })
  }

  const changePackageSource = useCallback((nextSource: PackageSource) => {
    discardVolatileDraft(packageSourceDraftIdentity(packageSourceRef.current))
    packageSourceRef.current = nextSource
    setPackageSource(nextSource)
    writeVolatileDraft(packageSourceDraftIdentity(nextSource), sourceRef.current, '')
  }, [])

  const changeSource = useCallback((value: string) => {
    sourceRef.current = value
    setSource(value)
    writeVolatileDraft(packageSourceDraftIdentity(packageSourceRef.current), value, '')
  }, [])

  const discardDrafts = useCallback(() => {
    discardPackageSourceDrafts()
    sourceRef.current = ''
    setSource('')
  }, [])

  const hasDraft = useCallback(() => Boolean(sourceRef.current.trim()), [])

  return {
    changePackageSource,
    changeSource,
    discardDrafts,
    hasDraft,
    mutatePackage,
    normalizedSource: normalizePackageSource(packageSource, source),
    packageBusy,
    packageSource,
    source,
  }
}

export type PiPackagesController = ReturnType<typeof usePiPackages>
