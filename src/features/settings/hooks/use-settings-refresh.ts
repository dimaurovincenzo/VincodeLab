import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ManagedUpdate,
  PiPackageSkill,
  PiRuntimeStatus,
  ProjectSkill,
  RuntimeCapabilitiesSnapshot,
} from '@/bridge'
import { settingsBridge } from '../api/settings.bridge'
import type { SettingsSectionFailure, SettingsTab } from '../model/settings.types'
import { settingsUserError } from '../services/settings-error'

const initialSectionRevisions: Record<SettingsTab, number> = {
  compatibility: 0,
  general: 0,
  packages: 0,
  runtime: 0,
  skills: 0,
  updates: 0,
}

export function useSettingsRefresh() {
  const [status, setStatus] = useState<PiRuntimeStatus | null>(null)
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilitiesSnapshot | null>(null)
  const [skills, setSkills] = useState<ProjectSkill[]>([])
  const [packageSkills, setPackageSkills] = useState<PiPackageSkill[]>([])
  const [packages, setPackages] = useState<string[]>([])
  const [updates, setUpdates] = useState<ManagedUpdate[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [sectionFailures, setSectionFailures] = useState<Partial<Record<SettingsTab, SettingsSectionFailure>>>({})
  const mounted = useRef(true)
  const refreshRequestId = useRef(0)
  const sectionOperationRevision = useRef<Record<SettingsTab, number>>({ ...initialSectionRevisions })

  const clearSectionFailure = useCallback((section: SettingsTab) => {
    setSectionFailures((current) => {
      if (!current[section]) return current
      const next = { ...current }
      delete next[section]
      return next
    })
  }, [])

  const publishSectionFailure = useCallback((section: SettingsTab, failure: SettingsSectionFailure) => {
    setSectionFailures((current) => ({ ...current, [section]: failure }))
  }, [])

  const markSectionOperation = useCallback((section: SettingsTab) => {
    sectionOperationRevision.current[section] += 1
  }, [])
  const isMounted = useCallback(() => mounted.current, [])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current
    const sectionRevisions = { ...sectionOperationRevision.current }
    setRefreshing(true)
    try {
      const [statusResult, skillsResult, updatesResult, capabilitiesResult] = await Promise.allSettled([
        Promise.resolve().then(() => settingsBridge.piSystem.status()),
        Promise.resolve().then(() => settingsBridge.systemSkills.list()),
        Promise.resolve().then(() => settingsBridge.updates.list()),
        Promise.resolve().then(() => settingsBridge.runtime?.capabilities?.() ?? { checkedAt: new Date().toISOString(), items: [] }),
      ])
      const piReady = statusResult.status === 'fulfilled' && statusResult.value.state !== 'missing'
      const [packagesResult, packageSkillsResult] = await Promise.allSettled(piReady
        ? [
            Promise.resolve().then(() => settingsBridge.piSystem.list()),
            Promise.resolve().then(() => settingsBridge.piSystem.listSkills()),
          ]
        : [Promise.resolve<string[]>([]), Promise.resolve<PiPackageSkill[]>([])])
      if (!mounted.current || requestId !== refreshRequestId.current) return
      if (statusResult.status === 'fulfilled') setStatus(statusResult.value.state === 'missing'
        ? statusResult.value
        : { state: 'ready', executable: statusResult.value.executable, version: statusResult.value.version })
      if (skillsResult.status === 'fulfilled') setSkills(skillsResult.value)
      if (packagesResult.status === 'fulfilled') setPackages(packagesResult.value)
      if (packageSkillsResult.status === 'fulfilled') setPackageSkills(packageSkillsResult.value)
      if (updatesResult.status === 'fulfilled') setUpdates(updatesResult.value)
      if (capabilitiesResult.status === 'fulfilled') setRuntimeCapabilities(capabilitiesResult.value)

      const nextFailures: Partial<Record<SettingsTab, SettingsSectionFailure>> = {}
      if (statusResult.status === 'rejected') nextFailures.runtime = {
        error: settingsUserError(statusResult.reason, {
          category: 'process',
          description: 'Non è stato possibile verificare il runtime. Le altre impostazioni restano utilizzabili.',
          operation: 'load-pi-runtime',
          title: 'Runtime Pi non disponibile',
        }),
      }
      if (packagesResult.status === 'rejected') nextFailures.packages = {
        error: settingsUserError(packagesResult.reason, {
          category: 'process',
          description: 'L’elenco precedente è rimasto visibile. Riprova per verificare i pacchetti installati.',
          operation: 'load-pi-packages',
          title: 'Pacchetti Pi non aggiornati',
        }),
      }
      const skillFailure = skillsResult.status === 'rejected'
        ? skillsResult.reason
        : packageSkillsResult.status === 'rejected' ? packageSkillsResult.reason : null
      if (skillFailure) nextFailures.skills = {
        error: settingsUserError(skillFailure, {
          category: 'configuration',
          description: 'Le skill già caricate e le modifiche locali sono rimaste disponibili.',
          operation: 'load-pi-skills',
          title: 'Skill Pi non aggiornate',
        }),
      }
      if (updatesResult.status === 'rejected') nextFailures.updates = {
        error: settingsUserError(updatesResult.reason, {
          category: 'process',
          description: 'Le versioni attive non sono cambiate. Riprova per controllare gli aggiornamenti.',
          operation: 'load-managed-updates',
          title: 'Aggiornamenti non disponibili',
        }),
      }
      if (capabilitiesResult.status === 'rejected') nextFailures.compatibility = {
        error: settingsUserError(capabilitiesResult.reason, {
          category: 'configuration',
          description: 'Le altre impostazioni restano disponibili. Riprova per verificare i componenti installati.',
          operation: 'load-runtime-capabilities',
          title: 'Compatibilità non verificata',
        }),
      }
      setSectionFailures((current) => {
        const next = { ...current }
        for (const section of ['compatibility', 'packages', 'runtime', 'skills', 'updates'] as const) {
          if (sectionOperationRevision.current[section] !== sectionRevisions[section]) continue
          const failure = nextFailures[section]
          if (failure) next[section] = failure
          else delete next[section]
        }
        return next
      })
    } finally {
      if (mounted.current && requestId === refreshRequestId.current) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => void refresh())
    return () => {
      mounted.current = false
      refreshRequestId.current += 1
    }
  }, [refresh])

  return {
    clearSectionFailure,
    isMounted,
    markSectionOperation,
    mounted,
    packageSkills,
    packages,
    publishSectionFailure,
    refresh,
    refreshing,
    replaceUpdates: setUpdates,
    runtimeCapabilities,
    sectionFailures,
    skills,
    status,
    updates,
  }
}

export type SettingsRefreshController = ReturnType<typeof useSettingsRefresh>
