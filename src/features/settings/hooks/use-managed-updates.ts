import { useEffect, useMemo, useState } from 'react'
import type { ManagedUpdate } from '@/bridge'
import { toast } from '@/components/ui'
import { normalizeUserError, reportUserError } from '@/lib/user-error'
import { settingsBridge } from '../api/settings.bridge'
import { settingsUserError } from '../services/settings-error'
import type { SettingsRefreshController } from './use-settings-refresh'

export type ManagedUpdateFilter = 'all' | ManagedUpdate['kind']

export function managedUpdateKindLabel(kind: ManagedUpdate['kind']) {
  return kind === 'skill' ? 'Skill' : kind === 'pi-extension' ? 'Estensioni Pi' : 'Runtime Pi'
}

export function useManagedUpdates(refreshController: SettingsRefreshController) {
  const {
    clearSectionFailure,
    markSectionOperation,
    mounted,
    publishSectionFailure,
    replaceUpdates,
    updates,
  } = refreshController
  const [updateFilter, setUpdateFilter] = useState<ManagedUpdateFilter>('all')
  const [updateBusy, setUpdateBusy] = useState<string | null>(null)
  const managedUpdateFailures = useMemo(() => new Map(updates.flatMap((update) => update.lastError
    ? [[update.id, normalizeUserError(update.lastError, {
        category: 'process',
        component: 'settings',
        description: `L’ultimo tentativo per “${update.name}” non è stato completato. La versione attiva non è cambiata.`,
        operation: 'managed-update',
        title: 'Aggiornamento non completato',
      })] as const]
    : [])), [updates])

  useEffect(() => {
    for (const failure of managedUpdateFailures.values()) reportUserError(failure)
  }, [managedUpdateFailures])

  async function runUpdateAction(busyId: string, action: () => Promise<unknown>, success: string): Promise<void> {
    markSectionOperation('updates')
    setUpdateBusy(busyId)
    clearSectionFailure('updates')
    try {
      await action()
      const nextUpdates = await settingsBridge.updates.list()
      if (!mounted.current) return
      replaceUpdates(nextUpdates)
      clearSectionFailure('updates')
      toast.success(success)
    } catch (cause) {
      if (mounted.current) publishSectionFailure('updates', {
        error: settingsUserError(cause, {
          category: 'process',
          description: 'La versione attiva non è cambiata. Puoi riprovare senza riavviare l’app.',
          operation: 'managed-update-action',
          title: 'Aggiornamento non modificato',
        }),
        recovery: { label: 'Riprova', run: () => runUpdateAction(busyId, action, success) },
      })
    } finally {
      if (mounted.current) setUpdateBusy(null)
    }
  }

  return {
    checkAll: () => runUpdateAction('check-all', () => settingsBridge.updates.check(), 'Controllo completato.'),
    checkUpdate: (id: string) => runUpdateAction(id, () => settingsBridge.updates.check(id), 'Controllo completato.'),
    downloadAll: () => runUpdateAction('download-all', () => settingsBridge.updates.downloadAll(), 'Aggiornamenti scaricati.'),
    downloadUpdate: (id: string) => runUpdateAction(id, () => settingsBridge.updates.download(id), 'Aggiornamento pronto.'),
    managedUpdateFailures,
    readyUpdates: updates.filter((update) => update.restartRequired).length,
    rollbackUpdate: (id: string) => runUpdateAction(id, () => settingsBridge.updates.rollback(id), 'Versione precedente ripristinata.'),
    setPolicy: (id: string, policy: ManagedUpdate['policy']) => runUpdateAction(id, () => settingsBridge.updates.setPolicy(id, policy), 'Policy aggiornata.'),
    setUpdateFilter,
    updateBusy,
    updateFilter,
    visibleUpdates: updates.filter((update) => updateFilter === 'all' || update.kind === updateFilter),
  }
}

export type ManagedUpdatesController = ReturnType<typeof useManagedUpdates>
