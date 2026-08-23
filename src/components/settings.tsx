import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Boxes, Check, CircleAlert, CircleCheck, Cpu, Download, FilePlus2, RefreshCw, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import { Button, Checkbox, createListCollection, ErrorNotice, Field, IconButton, Listbox, SegmentGroup, SelectField, Spinner, Tabs, toast } from '@/components/ui'
import { ConfirmationDialog, type ConfirmationRequest } from '@/components/confirmation-dialog'
import { TerminalDiagnostics } from '@/components/terminal-diagnostics'
import { useApplicationMenuCommand } from '@/lib/app-menu-command'
import { useAppPreferences } from '@/lib/app-preferences'
import { normalizeUserError, reportUserError, type UserError, type UserErrorCategory } from '@/lib/user-error'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'
import { commitVolatileDraft, discardVolatileDraft, latestVolatileDraft, restoreVolatileDraft, writeVolatileDraft, type VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import { preferenceOriginStyle, settingsStyles } from '@/theme/styles/settings'

type SettingsTab = 'general' | 'compatibility' | 'updates' | 'runtime' | 'packages' | 'skills'
type PackageSource = 'npm' | 'git' | 'local'
type Appearance = 'system' | 'light' | 'dark'
type PreferenceScope = 'global' | 'workspace'
type SettingsRecovery = { label: string; run: () => void | Promise<void>; pendingLabel?: string }
type SettingsSectionFailure = { error: UserError; recovery?: SettingsRecovery; secondaryRecovery?: SettingsRecovery }
type PreferenceFailure = {
  definition: AppPreferenceDefinition
  error: UserError
  kind: 'reset' | 'save'
  scope: PreferenceScope
  value?: AppPreferenceValue
}

const defaultPiConfigDimensions = Object.freeze({ cols: 120, rows: 34 })

function settingsUserError(cause: unknown, {
  category,
  code,
  correlationId,
  description,
  operation,
  severity,
  title,
}: {
  category?: UserErrorCategory
  code?: string
  correlationId?: string
  description: string
  operation: string
  severity?: UserError['severity']
  title: string
}) {
  return reportUserError(normalizeUserError(cause, {
    category,
    code,
    component: 'settings',
    correlationId,
    description,
    operation,
    severity,
    title,
  }))
}

const preferenceSectionLabels: Record<AppPreferenceDefinition['section'], string> = { editor: 'Editor', terminal: 'Terminale', git: 'Git', database: 'Database' }
const preferenceEnumLabels: Record<string, string> = { 'system-mono': 'Monospace di sistema', menlo: 'Menlo', monaco: 'Monaco', bar: 'Barra', block: 'Blocco', underline: 'Sottolineato' }

const packageSourceCopy: Record<PackageSource, { placeholder: string; help: string }> = {
  npm: { placeholder: '@autore/pacchetto oppure pacchetto', help: 'Installazione dal catalogo npm di Pi.' },
  git: { placeholder: 'git:github.com/autore/repository oppure URL Git', help: 'Repository Git, con ref opzionale.' },
  local: { placeholder: '/percorso/al/pacchetto', help: 'Pacchetto gia presente sul computer.' },
}

function normalizePackageSource(kind: PackageSource, value: string) {
  const source = value.trim()
  return kind === 'npm' && !source.startsWith('npm:') ? `npm:${source}` : source
}

function systemSkillDraftIdentity(skillId: string): VolatileDraftIdentity {
  return { scope: 'settings-system-skill', workspace: 'global', resource: skillId }
}

function packageSourceDraftIdentity(source: PackageSource): VolatileDraftIdentity {
  return { scope: 'settings-package-source', workspace: 'global', resource: source }
}

const newSystemSkillDraftIdentity: VolatileDraftIdentity = {
  scope: 'settings-new-skill',
  workspace: 'global',
  resource: 'name',
}

function isPackageSource(value: string | undefined): value is PackageSource {
  return value === 'npm' || value === 'git' || value === 'local'
}

function discardPackageSourceDrafts() {
  for (const source of ['npm', 'git', 'local'] as const) discardVolatileDraft(packageSourceDraftIdentity(source))
}

export function NumberPreferenceInput({
  definition,
  disabled,
  initialDraft,
  value,
  onCommit,
  onDraftChange,
}: {
  definition: AppPreferenceDefinition
  disabled: boolean
  initialDraft?: string
  value: number
  onCommit: (value: number) => Promise<boolean>
  onDraftChange?: (draft: string | null) => void
}) {
  const [draft, setDraft] = useState(initialDraft ?? String(value))
  const [committing, setCommitting] = useState(false)
  const commitGeneration = useRef(0)
  const inputMounted = useRef(true)
  useEffect(() => () => {
    inputMounted.current = false
    commitGeneration.current += 1
  }, [])
  const parsed = Number(draft)
  const valid = draft.trim() !== ''
    && Number.isFinite(parsed)
    && (definition.min === undefined || parsed >= definition.min)
    && (definition.max === undefined || parsed <= definition.max)

  const commit = async () => {
    if (!valid) {
      setDraft(String(value))
      onDraftChange?.(null)
      return
    }
    if (Object.is(parsed, value)) {
      setDraft(String(value))
      onDraftChange?.(null)
      return
    }
    const generation = ++commitGeneration.current
    setCommitting(true)
    const saved = await onCommit(parsed).catch(() => false)
    if (!inputMounted.current || generation !== commitGeneration.current) return
    setCommitting(false)
    if (saved) onDraftChange?.(null)
  }

  return <Field.Root invalid={!valid}>
    <Field.Input
      aria-label={definition.label}
      disabled={disabled || committing}
      max={definition.max}
      min={definition.min}
      step={definition.step}
      type="number"
      value={draft}
      onBlur={() => { void commit() }}
      onChange={(event) => {
        setDraft(event.target.value)
        onDraftChange?.(event.target.value === String(value) ? null : event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          commitGeneration.current += 1
          setCommitting(false)
          setDraft(String(value))
          onDraftChange?.(null)
          event.currentTarget.blur()
        }
      }}
    />
    <Field.ErrorText>
      Inserisci un numero{definition.min === undefined ? '' : ` da ${definition.min}`}{definition.max === undefined ? '' : ` a ${definition.max}`}.
    </Field.ErrorText>
  </Field.Root>
}

export function Settings({ active = true, appearance, openRuntimeRequest = 0, onAppearanceChange, onWorkspaceGuardChange }: { active?: boolean; appearance: Appearance; openRuntimeRequest?: number; onAppearanceChange: (appearance: Appearance) => void; onWorkspaceGuardChange?: (guard: WorkspaceChangeGuard | null) => void }) {
  const restoredPackageDraft = useMemo(() => latestVolatileDraft('settings-package-source', 'global'), [])
  const [tab, setTab] = useState<SettingsTab>('general')
  const [status, setStatus] = useState<PiRuntimeStatus | null>(null)
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilitiesSnapshot | null>(null)
  const [skills, setSkills] = useState<ProjectSkill[]>([])
  const [packageSkills, setPackageSkills] = useState<PiPackageSkill[]>([])
  const [packages, setPackages] = useState<string[]>([])
  const [source, setSource] = useState(() => restoredPackageDraft?.content ?? '')
  const [packageSource, setPackageSource] = useState<PackageSource>(() => isPackageSource(restoredPackageDraft?.resource) ? restoredPackageDraft.resource : 'npm')
  const [skillName, setSkillName] = useState(() => restoreVolatileDraft(newSystemSkillDraftIdentity, ''))
  const [selectedSkill, setSelectedSkill] = useState<ProjectSkill | null>(null)
  const [savedSystemSkillContent, setSavedSystemSkillContent] = useState('')
  const [systemSkillSaving, setSystemSkillSaving] = useState(false)
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null)
  const [configOutput, setConfigOutput] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const configOpenRef = useRef(false)
  const configStartGeneration = useRef(0)
  const mounted = useRef(true)
  const activeRef = useRef(active)
  const [refreshing, setRefreshing] = useState(false)
  const [preferenceScope, setPreferenceScope] = useState<PreferenceScope>('global')
  const [preferenceBusy, setPreferenceBusy] = useState<string | null>(null)
  const [preferenceFailures, setPreferenceFailures] = useState<Record<string, PreferenceFailure>>({})
  const [sectionFailures, setSectionFailures] = useState<Partial<Record<SettingsTab, SettingsSectionFailure>>>({})
  const [updates, setUpdates] = useState<ManagedUpdate[]>([])
  const [updateFilter, setUpdateFilter] = useState<'all' | ManagedUpdate['kind']>('all')
  const [updateBusy, setUpdateBusy] = useState<string | null>(null)
  const [packageBusy, setPackageBusy] = useState<string | null>(null)
  const [skillNameFailure, setSkillNameFailure] = useState<UserError | null>(null)
  const [skillEditorFailure, setSkillEditorFailure] = useState<UserError | null>(null)
  const [systemSkillBusy, setSystemSkillBusy] = useState<string | null>(null)
  const [preferenceDraftValues, setPreferenceDraftValues] = useState<Record<string, string>>({})
  const [preferenceDraftResetRevision, setPreferenceDraftResetRevision] = useState(0)
  const refreshRequestId = useRef(0)
  const sectionOperationRevision = useRef<Record<SettingsTab, number>>({ compatibility: 0, general: 0, packages: 0, runtime: 0, skills: 0, updates: 0 })
  const preferenceMutationGeneration = useRef(new Map<string, number>())
  const preferenceDrafts = useRef(new Map<string, { definition: AppPreferenceDefinition; draft: string; scope: PreferenceScope; baseline: number }>())
  const sourceRef = useRef(source)
  const packageSourceRef = useRef(packageSource)
  const skillNameRef = useRef(skillName)
  const systemSkillSelectionRequestId = useRef(0)
  const systemSkillSelectionGeneration = useRef(0)
  const systemSkillSaveRequestId = useRef(0)
  const selectedSystemSkillRef = useRef<ProjectSkill | null>(null)
  const savedSystemSkillContentRef = useRef('')
  const {
    preferences,
    preferencesError,
    preferencesLoading,
    publishPreferences,
    retryPreferences,
  } = useAppPreferences()
  const systemSkillCollection = useMemo(() => createListCollection({
    items: skills,
    itemToString: (skill) => skill.name,
    itemToValue: (skill) => skill.id,
  }), [skills])
  const preferenceLoadFailure = useMemo(() => preferencesError ? normalizeUserError(preferencesError, {
    category: 'persistence',
    component: 'settings',
    description: preferences
      ? 'I valori già caricati restano utilizzabili. Riprova senza ricaricare l’app.'
      : 'Non è stato possibile leggere i valori. Riprova senza ricaricare l’app.',
    operation: 'load-preferences',
    title: preferences ? 'Preferenze non aggiornate' : 'Preferenze non disponibili',
  }) : null, [preferences, preferencesError])
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
    if (preferenceLoadFailure) reportUserError(preferenceLoadFailure)
  }, [preferenceLoadFailure])

  useEffect(() => {
    for (const failure of managedUpdateFailures.values()) reportUserError(failure)
  }, [managedUpdateFailures])

  const clearSectionFailure = useCallback((section: SettingsTab) => {
    setSectionFailures((current) => {
      if (!current[section]) return current
      const next = { ...current }
      delete next[section]
      return next
    })
  }, [])

  const markSectionOperation = useCallback((section: SettingsTab) => {
    sectionOperationRevision.current[section] += 1
  }, [])

  useEffect(() => { sourceRef.current = source }, [source])
  useEffect(() => { skillNameRef.current = skillName }, [skillName])

  const publishSystemSkillSelection = useCallback((skill: ProjectSkill | null) => {
    const persistedContent = skill?.content ?? ''
    const nextContent = skill ? restoreVolatileDraft(systemSkillDraftIdentity(skill.id), persistedContent) : ''
    const nextSkill = skill && nextContent !== persistedContent ? { ...skill, content: nextContent } : skill
    systemSkillSelectionGeneration.current += 1
    selectedSystemSkillRef.current = nextSkill
    savedSystemSkillContentRef.current = persistedContent
    setSelectedSkill(nextSkill)
    setSavedSystemSkillContent(persistedContent)
  }, [])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestId.current
    const sectionRevisions = { ...sectionOperationRevision.current }
    setRefreshing(true)
    try {
      const [statusResult, skillsResult, updatesResult, capabilitiesResult] = await Promise.allSettled([
        Promise.resolve().then(() => window.vincodeLab.piSystem.status()),
        Promise.resolve().then(() => window.vincodeLab.systemSkills.list()),
        Promise.resolve().then(() => window.vincodeLab.updates.list()),
        Promise.resolve().then(() => window.vincodeLab.runtime?.capabilities?.() ?? { checkedAt: new Date().toISOString(), items: [] }),
      ])
      const piReady = statusResult.status === 'fulfilled' && statusResult.value.state !== 'missing'
      const [packagesResult, packageSkillsResult] = await Promise.allSettled(piReady
        ? [
            Promise.resolve().then(() => window.vincodeLab.piSystem.list()),
            Promise.resolve().then(() => window.vincodeLab.piSystem.listSkills()),
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

  const closeConfig = useCallback(async () => {
    configStartGeneration.current += 1
    if (configOpenRef.current) markSectionOperation('runtime')
    if (mounted.current) setConfigBusy(configOpenRef.current)
    if (!configOpenRef.current) {
      queueMicrotask(() => {
        if (!mounted.current) return
        setConfigOpen(false)
        setConfigOutput('')
      })
      return
    }
    configOpenRef.current = false
    try {
      await window.vincodeLab.piConfig.close()
      clearSectionFailure('runtime')
    } catch (cause) {
      if (mounted.current) {
        setSectionFailures((current) => ({ ...current, runtime: {
          error: settingsUserError(cause, {
            category: 'process',
            description: 'La configurazione è stata chiusa nella pagina, ma Pi potrebbe essere ancora in arresto.',
            operation: 'close-pi-config',
            title: 'Configurazione Pi non chiusa completamente',
          }),
          recovery: {
            label: 'Riprova chiusura',
            run: async () => {
              await window.vincodeLab.piConfig.close()
              clearSectionFailure('runtime')
            },
          },
        } }))
      }
    } finally {
      if (mounted.current) {
        setConfigBusy(false)
        setConfigOpen(false)
        setConfigOutput('')
      }
    }
  }, [clearSectionFailure, markSectionOperation])

  const startConfig = useCallback(async function openConfig(): Promise<void> {
    markSectionOperation('runtime')
    const generation = ++configStartGeneration.current
    setConfigBusy(true)
    try {
      await window.vincodeLab.piConfig.start()
      if (!mounted.current || !activeRef.current || generation !== configStartGeneration.current) {
        await window.vincodeLab.piConfig.close()
        return
      }
      configOpenRef.current = true
      setConfigOpen(true)
      clearSectionFailure('runtime')
    } catch (cause) {
      if (mounted.current && generation === configStartGeneration.current) {
        setSectionFailures((current) => ({ ...current, runtime: {
          error: settingsUserError(cause, {
            category: 'configuration',
            description: 'La configurazione Pi non è stata aperta. Le altre impostazioni restano disponibili.',
            operation: 'open-pi-config',
            title: 'Configurazione Pi non disponibile',
          }),
          recovery: { label: 'Apri configurazione', run: openConfig },
        } }))
      }
    } finally {
      if (mounted.current && generation === configStartGeneration.current) setConfigBusy(false)
    }
  }, [clearSectionFailure, markSectionOperation])

  const writeConfigInput = (value: string): void => {
    try {
      window.vincodeLab.piConfig.write(value)
    } catch (cause) {
      markSectionOperation('runtime')
      setSectionFailures((current) => ({ ...current, runtime: {
        error: settingsUserError(cause, {
          category: 'process',
          description: 'L’input non è stato inviato. La configurazione resta visibile; riaprila prima di continuare.',
          operation: 'write-pi-config',
          title: 'Configurazione Pi non raggiungibile',
        }),
        recovery: {
          label: 'Riapri configurazione',
          run: async () => {
            await closeConfig()
            await startConfig()
          },
        },
      } }))
    }
  }

  const retryConfigResize = useCallback(() => {
    window.vincodeLab.piConfig.resize(defaultPiConfigDimensions)
    clearSectionFailure('runtime')
  }, [clearSectionFailure])

  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => void refresh())
    const offData = window.vincodeLab.piConfig.onData((data) => queueMicrotask(() => {
      if (mounted.current) setConfigOutput((value) => (value + data).slice(-200000))
    }))
    const offExit = window.vincodeLab.piConfig.onExit((exitStatus) => queueMicrotask(() => {
      if (!mounted.current) return
      const endedUnexpectedly = configOpenRef.current && (exitStatus.exitCode !== 0 || exitStatus.signal !== 0)
      configOpenRef.current = false
      setConfigOpen(false)
      setConfigBusy(false)
      if (endedUnexpectedly) {
        markSectionOperation('runtime')
        setSectionFailures((current) => ({ ...current, runtime: {
          error: settingsUserError(new Error(`Pi config exit ${exitStatus.exitCode}, signal ${exitStatus.signal}`), {
            category: 'process',
            description: 'La sessione di configurazione si è interrotta. Le altre impostazioni e l’output già ricevuto non sono cambiati.',
            operation: 'pi-config-exit',
            title: 'Configurazione Pi interrotta',
          }),
          recovery: { label: 'Riapri configurazione', run: startConfig },
        } }))
      }
    }))
    const offError = window.vincodeLab.piConfig.onError?.((event) => queueMicrotask(() => {
      if (!mounted.current) return
      const inputFailure = event.operation === 'input'
      markSectionOperation('runtime')
      setSectionFailures((current) => ({ ...current, runtime: {
        error: settingsUserError(event.error, {
          category: event.error.category,
          code: event.error.code,
          correlationId: event.error.correlationId,
          description: inputFailure
            ? 'Il testo non è stato inviato. L’output già ricevuto è rimasto disponibile; riavvia la configurazione prima di continuare.'
            : 'Il terminale di configurazione non è stato ridimensionato. La sessione resta utilizzabile e puoi riprovare.',
          operation: `pi-config-${event.operation}`,
          severity: event.error.severity,
          title: inputFailure ? 'Input configurazione Pi non inviato' : 'Terminale configurazione non ridimensionato',
        }),
        recovery: event.recovery === 'resize'
          ? { label: 'Riprova ridimensionamento', run: retryConfigResize }
          : {
              label: 'Riavvia configurazione',
              run: async () => {
                await closeConfig()
                await startConfig()
              },
            },
      } }))
    })) ?? (() => undefined)
    return () => {
      mounted.current = false
      configStartGeneration.current += 1
      systemSkillSelectionRequestId.current += 1
      systemSkillSaveRequestId.current += 1
      offData()
      offExit()
      offError()
      if (configOpenRef.current) {
        configOpenRef.current = false
        void window.vincodeLab.piConfig.close().catch((cause) => {
          // La pagina è già stata smontata: registriamo il cleanup qui per evitare
          // una rejection globale con una recovery non più contestuale.
          settingsUserError(cause, {
            category: 'process',
            operation: 'close-pi-config-on-unmount',
            title: 'Chiusura configurazione Pi non confermata',
            description: 'La pagina Impostazioni è stata chiusa. La sessione di configurazione verrà verificata al prossimo accesso.',
          })
        })
      }
    }
  }, [closeConfig, markSectionOperation, refresh, retryConfigResize, startConfig])

  useEffect(() => {
    activeRef.current = active
    if (!active) void closeConfig()
  }, [active, closeConfig])

  useEffect(() => {
    if (openRuntimeRequest <= 0) return
    queueMicrotask(() => {
      if (mounted.current) setTab('runtime')
    })
  }, [openRuntimeRequest])

  const mutatePackage = (action: 'install' | 'update' | 'remove', value: string): void => {
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
            await window.vincodeLab.piSystem[action](value)
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
            setSectionFailures((current) => ({ ...current, packages: {
              error: settingsUserError(cause, {
                category: 'process',
                description: `Il pacchetto non è stato ${operationLabel}. La sorgente e l’elenco precedente sono rimasti disponibili.`,
                operation: `${action}-pi-package`,
                title: 'Pacchetto Pi non modificato',
              }),
              recovery: { label: 'Riprova', run: () => mutatePackage(action, value) },
            } }))
          } finally {
            if (mounted.current) setPackageBusy(null)
          }
        })()
      },
    })
  }

  const selectTab = (next: SettingsTab) => { setTab(next); if (next !== 'runtime') void closeConfig() }
  const piReady = status?.state === 'ready'
  const normalizedSource = normalizePackageSource(packageSource, source)
  const visibleUpdates = updates.filter((update) => updateFilter === 'all' || update.kind === updateFilter)
  const readyUpdates = updates.filter((update) => update.restartRequired).length
  const updateKindLabel = (kind: ManagedUpdate['kind']) => kind === 'skill' ? 'Skill' : kind === 'pi-extension' ? 'Estensioni Pi' : 'Runtime Pi'
  const runUpdateAction = async (busyId: string, action: () => Promise<unknown>, success: string): Promise<void> => {
    markSectionOperation('updates')
    setUpdateBusy(busyId)
    clearSectionFailure('updates')
    try {
      await action()
      const nextUpdates = await window.vincodeLab.updates.list()
      if (!mounted.current) return
      setUpdates(nextUpdates)
      clearSectionFailure('updates')
      toast.success(success)
    } catch (cause) {
      if (mounted.current) setSectionFailures((current) => ({ ...current, updates: {
        error: settingsUserError(cause, {
          category: 'process',
          description: 'La versione attiva non è cambiata. Puoi riprovare senza riavviare l’app.',
          operation: 'managed-update-action',
          title: 'Aggiornamento non modificato',
        }),
        recovery: { label: 'Riprova', run: () => runUpdateAction(busyId, action, success) },
      } }))
    } finally {
      if (mounted.current) setUpdateBusy(null)
    }
  }

  const savePreference = useCallback(async (definition: AppPreferenceDefinition, value: AppPreferenceValue, requestedScope: PreferenceScope) => {
    const scope = requestedScope
    const mutationKey = `${scope}:${definition.key}`
    const generation = (preferenceMutationGeneration.current.get(mutationKey) ?? 0) + 1
    preferenceMutationGeneration.current.set(mutationKey, generation)
    setPreferenceBusy(definition.key)
    try {
      const next = scope === 'workspace'
        ? await window.vincodeLab.preferences.setWorkspace(definition.key, value)
        : await window.vincodeLab.preferences.setGlobal(definition.key, value)
      if (preferenceMutationGeneration.current.get(mutationKey) !== generation) return false
      publishPreferences(next)
      setPreferenceFailures((current) => {
        if (!current[mutationKey]) return current
        const nextFailures = { ...current }
        delete nextFailures[mutationKey]
        return nextFailures
      })
      toast.success('Impostazione salvata.')
      return true
    } catch (cause) {
      if (mounted.current && preferenceMutationGeneration.current.get(mutationKey) === generation) {
        setPreferenceFailures((current) => ({ ...current, [mutationKey]: {
          definition,
          error: settingsUserError(cause, {
            category: 'persistence',
            description: `“${definition.label}” non è stata salvata. Il valore precedente è rimasto attivo e l’eventuale bozza è stata mantenuta.`,
            operation: 'save-preference',
            title: 'Impostazione non salvata',
          }),
          kind: 'save',
          scope,
          value,
        } }))
      }
      return false
    } finally {
      if (mounted.current && preferenceMutationGeneration.current.get(mutationKey) === generation) setPreferenceBusy(null)
    }
  }, [publishPreferences])

  const resetWorkspacePreference = async (definition: AppPreferenceDefinition) => {
    const mutationKey = `workspace:${definition.key}`
    setPreferenceBusy(definition.key)
    try {
      publishPreferences(await window.vincodeLab.preferences.clearWorkspace(definition.key))
      setPreferenceFailures((current) => {
        if (!current[mutationKey]) return current
        const nextFailures = { ...current }
        delete nextFailures[mutationKey]
        return nextFailures
      })
      toast.success('Personalizzazione rimossa.')
    } catch (cause) {
      if (mounted.current) setPreferenceFailures((current) => ({ ...current, [mutationKey]: {
        definition,
        error: settingsUserError(cause, {
          category: 'persistence',
          description: `La personalizzazione di “${definition.label}” è rimasta attiva. Puoi riprovare o mantenere il valore corrente.`,
          operation: 'reset-workspace-preference',
          title: 'Personalizzazione non rimossa',
        }),
        kind: 'reset',
        scope: 'workspace',
      } }))
    } finally {
      if (mounted.current) setPreferenceBusy(null)
    }
  }

  async function clearAllWorkspacePreferences() {
    setPreferenceBusy('*')
    clearSectionFailure('general')
    try {
      publishPreferences(await window.vincodeLab.preferences.clearAllWorkspace())
      setPreferenceFailures({})
      toast.success('Personalizzazioni rimosse.')
    } catch (cause) {
      if (mounted.current) setSectionFailures((current) => ({ ...current, general: {
        error: settingsUserError(cause, {
          category: 'persistence',
          description: 'Le personalizzazioni del workspace sono rimaste attive. Nessun valore è stato scartato.',
          operation: 'reset-all-workspace-preferences',
          title: 'Personalizzazioni non rimosse',
        }),
        recovery: { label: 'Ripristina', run: requestClearAllWorkspacePreferences },
      } }))
    } finally {
      if (mounted.current) setPreferenceBusy(null)
    }
  }

  function requestClearAllWorkspacePreferences() {
    setConfirmation({
      title: 'Rimuovere tutte le personalizzazioni?',
      detail: 'Il workspace tornerà a usare tutti i valori globali.',
      confirmLabel: 'Rimuovi personalizzazioni',
      destructive: true,
      onConfirm: () => { void clearAllWorkspacePreferences() },
    })
  }

  const updateNumberPreferenceDraft = (
    definition: AppPreferenceDefinition,
    scope: PreferenceScope,
    baseline: number,
    draft: string | null,
  ) => {
    const key = `${scope}:${definition.key}`
    if (draft === null) {
      preferenceDrafts.current.delete(key)
      setPreferenceDraftValues((current) => {
        if (!(key in current)) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    } else {
      preferenceDrafts.current.set(key, { definition, draft, scope, baseline })
      setPreferenceDraftValues((current) => ({ ...current, [key]: draft }))
    }
  }

  const selectSystemSkill = async (skillId: string, discardPreviousSkillId?: string): Promise<void> => {
    if (selectedSystemSkillRef.current?.id === skillId) return
    const requestId = ++systemSkillSelectionRequestId.current
    const previousSkillId = selectedSystemSkillRef.current?.id ?? null
    const previousContent = selectedSystemSkillRef.current?.content ?? ''
    markSectionOperation('skills')
    setSystemSkillBusy(`load:${skillId}`)
    clearSectionFailure('skills')
    try {
      const skill = await window.vincodeLab.systemSkills.get(skillId)
      if (!mounted.current || requestId !== systemSkillSelectionRequestId.current) return
      if (skill.id !== skillId) throw new Error('La skill caricata non corrisponde alla selezione richiesta.')
      if ((selectedSystemSkillRef.current?.id ?? null) !== previousSkillId || (selectedSystemSkillRef.current?.content ?? '') !== previousContent) {
        toast.info('Selezione annullata per conservare le modifiche più recenti.')
        return
      }
      if (discardPreviousSkillId) discardVolatileDraft(systemSkillDraftIdentity(discardPreviousSkillId))
      publishSystemSkillSelection(skill)
    } catch (cause) {
      if (mounted.current && requestId === systemSkillSelectionRequestId.current) {
        setSectionFailures((current) => ({ ...current, skills: {
          error: settingsUserError(cause, {
            category: 'configuration',
            description: 'La selezione precedente e le modifiche locali sono rimaste disponibili.',
            operation: 'open-system-skill',
            title: 'Skill Pi non aperta',
          }),
          recovery: { label: 'Riprova apertura', run: () => selectSystemSkill(skillId, discardPreviousSkillId) },
        } }))
      }
    } finally {
      if (mounted.current && requestId === systemSkillSelectionRequestId.current) setSystemSkillBusy(null)
    }
  }

  const requestSelectSystemSkill = (skillId: string) => {
    const current = selectedSystemSkillRef.current
    if (current?.id === skillId) return
    const hasUnsavedChanges = Boolean(current) && (current?.content ?? '') !== savedSystemSkillContentRef.current
    if (!hasUnsavedChanges) {
      void selectSystemSkill(skillId)
      return
    }
    setConfirmation({
      title: 'Modifiche non salvate',
      detail: `Le modifiche a “${current?.name ?? 'questa skill'}” verranno scartate prima di aprire un’altra skill.`,
      confirmLabel: 'Scarta e apri',
      destructive: true,
      onConfirm: () => {
        void selectSystemSkill(skillId, current?.id)
      },
    })
  }

  const saveSystemSkill = useCallback(async (): Promise<boolean> => {
    const current = selectedSystemSkillRef.current
    if (!current) return true
    const content = current.content ?? ''
    if (content === savedSystemSkillContentRef.current) return true
    const requestId = ++systemSkillSaveRequestId.current
    const selectionVersion = systemSkillSelectionGeneration.current
    setSystemSkillSaving(true)
    setSkillEditorFailure(null)
    try {
      const savedSkill = await window.vincodeLab.systemSkills.update(current.id, content)
      if (!mounted.current || requestId !== systemSkillSaveRequestId.current) return false
      if (systemSkillSelectionGeneration.current === selectionVersion && selectedSystemSkillRef.current?.id === current.id) {
        commitVolatileDraft(systemSkillDraftIdentity(current.id), content)
        savedSystemSkillContentRef.current = content
        setSavedSystemSkillContent(content)
        const nextSkill = { ...savedSkill, content: selectedSystemSkillRef.current.content ?? '' }
        selectedSystemSkillRef.current = nextSkill
        setSelectedSkill(nextSkill)
      }
      toast.success('Skill Pi salvata.')
      await refresh()
      return true
    } catch (cause) {
      if (mounted.current && requestId === systemSkillSaveRequestId.current) {
        setSkillEditorFailure(settingsUserError(cause, {
          category: 'configuration',
          description: 'Il contenuto non è stato salvato. La bozza locale è rimasta nell’editor.',
          operation: 'save-system-skill',
          title: 'Skill Pi non salvata',
        }))
      }
      return false
    } finally {
      if (mounted.current && requestId === systemSkillSaveRequestId.current) setSystemSkillSaving(false)
    }
  }, [refresh])

  const createSystemSkill = async () => {
    const draft = skillName
    const name = draft.trim()
    if (!name) return
    markSectionOperation('skills')
    setSystemSkillBusy('create')
    setSkillNameFailure(null)
    try {
      const skill = await window.vincodeLab.systemSkills.create(name)
      if (!mounted.current) return
      if (skillNameRef.current === draft) {
        discardVolatileDraft(newSystemSkillDraftIdentity)
        skillNameRef.current = ''
        setSkillName('')
      }
      const current = selectedSystemSkillRef.current
      const hasUnsavedChanges = Boolean(current) && (current?.content ?? '') !== savedSystemSkillContentRef.current
      if (!hasUnsavedChanges) {
        systemSkillSelectionRequestId.current += 1
        publishSystemSkillSelection(skill)
      } else {
        toast.info('Skill Pi creata senza sostituire la modifica in corso.', { description: skill.name })
      }
      await refresh()
    } catch (cause) {
      if (mounted.current) setSkillNameFailure(settingsUserError(cause, {
        category: 'configuration',
        description: 'La nuova skill non è stata creata. Il nome inserito è rimasto disponibile.',
        operation: 'create-system-skill',
        title: 'Skill Pi non creata',
      }))
    } finally {
      if (mounted.current) setSystemSkillBusy(null)
    }
  }

  const requestDeleteSystemSkill = (skill: ProjectSkill): void => {
    setConfirmation({
      title: 'Elimina skill Pi',
      detail: `La skill ${skill.name} verrà rimossa per tutti i workspace.`,
      confirmLabel: 'Elimina',
      destructive: true,
      onConfirm: () => {
        void (async () => {
          markSectionOperation('skills')
          setSystemSkillBusy(`delete:${skill.id}`)
          clearSectionFailure('skills')
          try {
            await window.vincodeLab.systemSkills.delete(skill.id)
            if (!mounted.current) return
            if (selectedSystemSkillRef.current?.id === skill.id) {
              discardVolatileDraft(systemSkillDraftIdentity(skill.id))
              systemSkillSelectionRequestId.current += 1
              publishSystemSkillSelection(null)
            }
            await refresh()
          } catch (cause) {
            if (mounted.current) setSectionFailures((current) => ({ ...current, skills: {
              error: settingsUserError(cause, {
                category: 'configuration',
                description: `“${skill.name}” è rimasta disponibile. Puoi riprovare la rimozione.`,
                operation: 'delete-system-skill',
                title: 'Skill Pi non eliminata',
              }),
              recovery: { label: 'Riprova eliminazione', run: () => requestDeleteSystemSkill(skill) },
            } }))
          } finally {
            if (mounted.current) setSystemSkillBusy(null)
          }
        })()
      },
    })
  }

  useEffect(() => {
    if (!onWorkspaceGuardChange) return
    const guard: WorkspaceChangeGuard = {
      hasUnsavedChanges: () => {
        const selectedSkill = selectedSystemSkillRef.current
        return preferenceDrafts.current.size > 0
          || Boolean(sourceRef.current.trim())
          || Boolean(skillNameRef.current.trim())
          || Boolean(selectedSkill && (selectedSkill.content ?? '') !== savedSystemSkillContentRef.current)
      },
      saveAll: async () => {
        if (sourceRef.current.trim() || skillNameRef.current.trim()) {
          throw new Error('Completa oppure scarta la sorgente pacchetto o il nome della nuova Skill Pi prima di continuare.')
        }
        for (const [key, draft] of [...preferenceDrafts.current]) {
          const parsed = Number(draft.draft)
          const valid = draft.draft.trim() !== ''
            && Number.isFinite(parsed)
            && (draft.definition.min === undefined || parsed >= draft.definition.min)
            && (draft.definition.max === undefined || parsed <= draft.definition.max)
          if (!valid) throw new Error(`Il valore “${draft.definition.label}” non è valido.`)
          if (!Object.is(parsed, draft.baseline)) {
            const saved = await savePreference(draft.definition, parsed, draft.scope)
            if (!saved) throw new Error(`Non è stato possibile salvare “${draft.definition.label}”.`)
          }
          if (preferenceDrafts.current.get(key)?.draft === draft.draft) {
            preferenceDrafts.current.delete(key)
            setPreferenceDraftValues((current) => {
              if (current[key] !== draft.draft) return current
              const next = { ...current }
              delete next[key]
              return next
            })
          }
        }
        const savedSkill = await saveSystemSkill()
        if (!savedSkill) throw new Error('Non è stato possibile salvare la Skill Pi corrente.')
        const currentSkill = selectedSystemSkillRef.current
        if (currentSkill && (currentSkill.content ?? '') !== savedSystemSkillContentRef.current) {
          throw new Error('La Skill Pi è stata modificata di nuovo durante il salvataggio. Controlla il contenuto e riprova.')
        }
      },
      discardAll: async () => {
        preferenceDrafts.current.clear()
        setPreferenceDraftValues({})
        setPreferenceDraftResetRevision((current) => current + 1)
        discardPackageSourceDrafts()
        discardVolatileDraft(newSystemSkillDraftIdentity)
        sourceRef.current = ''
        skillNameRef.current = ''
        setSource('')
        setSkillName('')
        setConfirmation(null)
        systemSkillSelectionRequestId.current += 1
        systemSkillSaveRequestId.current += 1
        setSystemSkillSaving(false)
        setSystemSkillBusy(null)
        setSkillEditorFailure(null)
        setSkillNameFailure(null)
        setPreferenceFailures({})
        const currentSkill = selectedSystemSkillRef.current
        if (currentSkill) {
          discardVolatileDraft(systemSkillDraftIdentity(currentSkill.id))
          const restored = { ...currentSkill, content: savedSystemSkillContentRef.current }
          selectedSystemSkillRef.current = restored
          setSelectedSkill(restored)
        }
      },
    }
    onWorkspaceGuardChange(guard)
    return () => onWorkspaceGuardChange(null)
  }, [onWorkspaceGuardChange, savePreference, saveSystemSkill])

  const renderSectionFailure = (section: SettingsTab) => {
    const failure = sectionFailures[section]
    if (!failure) return null
    const recovery = failure.recovery ?? { label: 'Riprova', run: refresh, pendingLabel: 'Nuovo tentativo…' }
    const secondaryRecovery = failure.secondaryRecovery ?? (section === 'runtime' && !failure.recovery
      ? { label: 'Apri configurazione', run: startConfig }
      : undefined)
    return <ErrorNotice
      action={{ label: recovery.label, onClick: recovery.run, pendingLabel: recovery.pendingLabel }}
      error={failure.error}
      secondaryAction={secondaryRecovery ? {
        label: secondaryRecovery.label,
        onClick: secondaryRecovery.run,
        pendingLabel: secondaryRecovery.pendingLabel,
      } : undefined}
    />
  }

  const retryPreferenceFailure = async (failure: PreferenceFailure) => {
    if (failure.kind === 'reset') await resetWorkspacePreference(failure.definition)
    else if (failure.value !== undefined) await savePreference(failure.definition, failure.value, failure.scope)
  }

  const retryPreferenceLoad = async (): Promise<void> => {
    try {
      await retryPreferences()
    } catch {
      // useAppPreferences pubblica già il nuovo errore nella stessa superficie locale.
    }
  }

  const restorePreferenceDraft = (failure: PreferenceFailure) => {
    const key = `${failure.scope}:${failure.definition.key}`
    preferenceDrafts.current.delete(key)
    setPreferenceDraftValues((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setPreferenceFailures((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setPreferenceDraftResetRevision((current) => current + 1)
  }

  const renderPreferenceControl = (definition: AppPreferenceDefinition) => {
    if (!preferences) return null
    const value = preferenceScope === 'workspace' ? preferences.effective[definition.key] : preferences.global[definition.key]
    const overridden = Object.hasOwn(preferences.overrides, definition.key)
    const explicitGlobal = Object.hasOwn(preferences.explicitGlobal, definition.key)
    const failure = preferenceFailures[`${preferenceScope}:${definition.key}`]
    const displayedValue = failure?.kind === 'save' && failure.value !== undefined ? failure.value : value
    const disabled = preferenceBusy === '*' || preferenceBusy === definition.key || (preferenceScope === 'workspace' && !preferences.workspaceAvailable)
    return <Field.Root className={settingsStyles.preferenceRow} invalid={Boolean(failure)} key={definition.key}>
      <span className={settingsStyles.preferenceCopy}>
        <strong className={settingsStyles.preferenceLabel}>{definition.label}</strong>
        <small className={preferenceOriginStyle({ customized: overridden && preferenceScope === 'workspace' })}>{preferenceScope === 'workspace' ? overridden ? 'Personalizzato' : 'Ereditato dal valore globale' : explicitGlobal ? 'Valore globale' : 'Default applicativo'}</small>
      </span>
      <span className={settingsStyles.preferenceControl}>
        {definition.type === 'boolean' && <Checkbox aria-label={definition.label} checked={Boolean(displayedValue)} disabled={disabled} label="" onCheckedChange={(checked) => void savePreference(definition, checked, preferenceScope)} />}
        {definition.type === 'enum' && <SelectField aria-label={definition.label} disabled={disabled} options={(definition.values ?? []).map((option) => ({ value: option, label: preferenceEnumLabels[option] ?? option }))} value={String(displayedValue)} onValueChange={(next) => void savePreference(definition, next, preferenceScope)} />}
        {definition.type === 'number' && <NumberPreferenceInput
          key={`${preferenceScope}:${definition.key}:${String(value)}:${preferenceDraftResetRevision}`}
          definition={definition}
          disabled={disabled}
          initialDraft={preferenceDraftValues[`${preferenceScope}:${definition.key}`]}
          value={Number(displayedValue)}
          onCommit={(next) => savePreference(definition, next, preferenceScope)}
          onDraftChange={(draft) => updateNumberPreferenceDraft(definition, preferenceScope, Number(value), draft)}
        />}
        {preferenceScope === 'workspace' && overridden && <Button disabled={disabled} size="xs" variant="plain" type="button" onClick={() => void resetWorkspacePreference(definition)}>Usa globale</Button>}
        {failure && <Button disabled={disabled} size="xs" variant="outline" type="button" onClick={() => void retryPreferenceFailure(failure)}>Riprova</Button>}
        {failure?.kind === 'save' && <Button disabled={disabled} size="xs" variant="plain" type="button" onClick={() => restorePreferenceDraft(failure)}>Ripristina</Button>}
      </span>
      {failure && <Field.ErrorText>{failure.error.title}. {failure.error.description} Riferimento {failure.error.correlationId}.</Field.ErrorText>}
    </Field.Root>
  }

  const systemSkillHasUnsavedChanges = Boolean(selectedSkill)
    && (selectedSkill?.content ?? '') !== savedSystemSkillContent
  const includedCapabilities = runtimeCapabilities?.items.filter((item) => item.kind === 'included') ?? []
  const optionalCapabilities = runtimeCapabilities?.items.filter((item) => item.kind === 'optional') ?? []
  const renderCapability = (capability: RuntimeCapability) => {
    const StateIcon = capability.state === 'ready' ? CircleCheck : CircleAlert
    const stateLabel = capability.state === 'ready' ? 'Disponibile' : capability.state === 'missing' ? 'Non installato' : 'Da riparare'
    const stateClass = capability.state === 'ready'
      ? settingsStyles.capabilityStateReady
      : capability.state === 'missing' ? settingsStyles.capabilityStateMissing : settingsStyles.capabilityStateBroken
    const badgeClass = capability.state === 'ready'
      ? settingsStyles.capabilityBadgeReady
      : capability.state === 'missing' ? settingsStyles.capabilityBadgeMissing : settingsStyles.capabilityBadgeBroken
    return <li className={settingsStyles.capabilityItem} key={capability.id}>
      <StateIcon aria-hidden="true" className={stateClass} size={17} />
      <span className={settingsStyles.capabilityCopy}>
        <span className={settingsStyles.capabilityTitle}>{capability.label}</span>
        <span className={settingsStyles.capabilityDetail}>{capability.detail}</span>
      </span>
      <span className={`${settingsStyles.capabilityState} ${badgeClass}`}>{stateLabel}</span>
    </li>
  }

  useApplicationMenuCommand('settings.refresh', () => { void refresh() })
  useApplicationMenuCommand('settings.resetWorkspacePreferences', requestClearAllWorkspacePreferences)

  return <Tabs.Root asChild value={tab} onValueChange={({ value }) => selectTab(value as SettingsTab)}>
    <section className={settingsStyles.page} aria-label="Impostazioni">
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} />

      <header className={settingsStyles.header}>
        <div className={settingsStyles.headerCopy}>
          <p className={settingsStyles.eyebrow}>Preferenze</p>
          <h1 className={settingsStyles.pageTitle}>Impostazioni</h1>
          <span className={settingsStyles.headerDescription}>Workspace, runtime Pi e risorse condivise.</span>
        </div>
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? <Spinner size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
          {refreshing ? 'Aggiornamento…' : 'Aggiorna'}
        </Button>
      </header>

      <Tabs.List className={settingsStyles.tabs} aria-label="Sezioni Impostazioni">
        <Tabs.Trigger value="general"><Settings2 aria-hidden="true" size={15} /> Generali</Tabs.Trigger>
        <Tabs.Trigger value="compatibility"><Cpu aria-hidden="true" size={15} /> Compatibilità</Tabs.Trigger>
        <Tabs.Trigger value="updates"><Download aria-hidden="true" size={15} /> Aggiornamenti{readyUpdates > 0 && <span className={settingsStyles.updateCount}>{readyUpdates}</span>}</Tabs.Trigger>
        <Tabs.Trigger value="runtime"><Bot aria-hidden="true" size={15} /> Runtime Pi</Tabs.Trigger>
        <Tabs.Trigger value="packages"><Boxes aria-hidden="true" size={15} /> Pacchetti Pi</Tabs.Trigger>
        <Tabs.Trigger value="skills"><FilePlus2 aria-hidden="true" size={15} /> Skill Pi</Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>

      <main className={settingsStyles.main}>
        <Tabs.Content asChild value="general">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <Settings2 aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Generali</h2>
                <p className={settingsStyles.panelDescription}>Configura VincodeLab globalmente o personalizza il workspace aperto.</p>
              </div>
            </div>
            <div className={settingsStyles.generalToolbar}>
              <div className={settingsStyles.appearanceControl}>
                <SelectField aria-label="Aspetto dell’applicazione" label="Aspetto dell’applicazione" options={[{ value: 'system', label: 'Sistema' }, { value: 'dark', label: 'Scuro' }, { value: 'light', label: 'Chiaro' }]} value={appearance} onValueChange={(value) => onAppearanceChange(value as Appearance)} />
              </div>
              <SegmentGroup.Root aria-label="Ambito impostazioni" className={settingsStyles.scopeSwitch} orientation="horizontal" value={preferenceScope} onValueChange={({ value }) => { if (value) setPreferenceScope(value as PreferenceScope) }}>
                <SegmentGroup.Indicator />
                {([{ value: 'global', label: 'Valori globali' }, { value: 'workspace', label: 'Workspace aperto', disabled: !preferences?.workspaceAvailable }]).map((item) => <SegmentGroup.Item key={item.value} value={item.value} disabled={item.disabled}>
                  <SegmentGroup.ItemHiddenInput />
                  <SegmentGroup.ItemControl />
                  <SegmentGroup.ItemText>{item.label}</SegmentGroup.ItemText>
                </SegmentGroup.Item>)}
              </SegmentGroup.Root>
            </div>
            {preferenceLoadFailure
              ? <ErrorNotice
                  action={{ label: 'Riprova preferenze', onClick: retryPreferenceLoad, pendingLabel: 'Nuovo tentativo…' }}
                  error={preferenceLoadFailure}
                />
              : renderSectionFailure('general')}
            {preferences ? <div className={settingsStyles.preferenceGrid}>
              {(['editor', 'terminal', 'git', 'database'] as const).map((section) => <section className={settingsStyles.preferenceSection} key={section}>
                <header className={settingsStyles.preferenceSectionHeader}>
                  <h3 className={settingsStyles.preferenceSectionTitle}>{preferenceSectionLabels[section]}</h3>
                  <span className={settingsStyles.preferenceSectionSubtitle}>{preferenceScope === 'workspace' ? 'Personalizzazioni del progetto' : 'Default per tutti i progetti'}</span>
                </header>
                {preferences.schema.filter((definition) => definition.section === section).map(renderPreferenceControl)}
              </section>)}
            </div> : !preferenceLoadFailure && <p className={settingsStyles.empty}>{preferencesLoading ? 'Caricamento preferenze…' : 'Preparazione preferenze…'}</p>}
            {preferenceScope === 'workspace' && preferences?.workspaceAvailable && <Button size="sm" variant="outline" disabled={Boolean(preferenceBusy)} onClick={requestClearAllWorkspacePreferences}>
              {preferenceBusy === '*' && <Spinner size={14} />}
              {preferenceBusy === '*' ? 'Ripristino…' : 'Rimuovi tutte le personalizzazioni'}
            </Button>}
            <TerminalDiagnostics />
            <p className={settingsStyles.note}>Runtime, pacchetti e skill Pi restano globali e non appartengono al workspace aperto.</p>
          </section>
        </Tabs.Content>

        <Tabs.Content asChild value="compatibility">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <Cpu aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Compatibilità del sistema</h2>
                <p className={settingsStyles.panelDescription}>Distingue i componenti inclusi nell’app dagli strumenti esterni opzionali.</p>
              </div>
            </div>
            {renderSectionFailure('compatibility')}
            {!sectionFailures.compatibility && runtimeCapabilities && <div className={settingsStyles.capabilityGroups}>
              <section className={settingsStyles.capabilityGroup} aria-labelledby="included-capabilities-title">
                <div className={settingsStyles.groupHeading}>
                  <h3 className={settingsStyles.groupTitle} id="included-capabilities-title">Inclusi in VincodeLab</h3>
                  <p className={settingsStyles.groupDescription}>Non richiedono Node, npm o client database installati sul computer.</p>
                </div>
                <ul className={settingsStyles.capabilityList}>{includedCapabilities.map(renderCapability)}</ul>
              </section>
              <section className={settingsStyles.capabilityGroup} aria-labelledby="optional-capabilities-title">
                <div className={settingsStyles.groupHeading}>
                  <h3 className={settingsStyles.groupTitle} id="optional-capabilities-title">Strumenti opzionali</h3>
                  <p className={settingsStyles.groupDescription}>Se mancano, viene disattivata soltanto la funzione che li utilizza.</p>
                </div>
                <ul className={settingsStyles.capabilityList}>{optionalCapabilities.map(renderCapability)}</ul>
              </section>
            </div>}
            {!sectionFailures.compatibility && !runtimeCapabilities && <p className={settingsStyles.empty}>{refreshing ? 'Verifica compatibilità in corso…' : 'Compatibilità non ancora verificata.'}</p>}
          </section>
        </Tabs.Content>

        <Tabs.Content asChild value="updates">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <Download aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Aggiornamenti</h2>
                <p className={settingsStyles.panelDescription}>Controllo verificato delle risorse Pi gestite da VincodeLab.</p>
              </div>
            </div>
            {renderSectionFailure('updates')}
            {readyUpdates > 0 && <div className={settingsStyles.updateBanner} role="status"><strong>Aggiornamenti pronti — riavvia per attivarli.</strong><span>La sessione corrente non viene interrotta.</span></div>}
            <div className={settingsStyles.updateToolbar}>
              <SegmentGroup.Root aria-label="Filtra aggiornamenti" className={settingsStyles.updateFilters} orientation="horizontal" value={updateFilter} onValueChange={({ value }) => { if (value) setUpdateFilter(value as typeof updateFilter) }}>
                <SegmentGroup.Indicator />
                {([['all', 'Tutti'], ['skill', 'Skill'], ['pi-extension', 'Estensioni Pi'], ['pi-runtime', 'Runtime Pi']] as const).map(([value, label]) => <SegmentGroup.Item key={value} value={value}>
                  <SegmentGroup.ItemHiddenInput />
                  <SegmentGroup.ItemControl />
                  <SegmentGroup.ItemText>{label}</SegmentGroup.ItemText>
                </SegmentGroup.Item>)}
              </SegmentGroup.Root>
              <span className={settingsStyles.updateToolbarActions}>
                <Button size="sm" variant="outline" disabled={Boolean(updateBusy)} onClick={() => void runUpdateAction('check-all', () => window.vincodeLab.updates.check(), 'Controllo completato.')}><RefreshCw aria-hidden="true" size={14} /> Verifica ora</Button>
                <Button size="sm" disabled={Boolean(updateBusy) || !updates.some((update) => update.availableVersion && !update.restartRequired)} onClick={() => void runUpdateAction('download-all', () => window.vincodeLab.updates.downloadAll(), 'Aggiornamenti scaricati.')}><Download aria-hidden="true" size={14} /> Scarica tutti</Button>
              </span>
            </div>
            {visibleUpdates.length ? <div className={settingsStyles.updateList}>
              {visibleUpdates.map((update) => <article aria-busy={updateBusy === update.id} className={settingsStyles.updateCard} key={update.id}>
                <div className={settingsStyles.updateMain}>
                  <span className={settingsStyles.updateKind}>{updateKindLabel(update.kind)}</span>
                  <h3 className={settingsStyles.updateTitle}>{update.name}</h3>
                  <p className={settingsStyles.updateVersions}>Attiva <code>{update.activeVersion}</code>{update.availableVersion && <> · Disponibile <code>{update.availableVersion}</code></>}</p>
                  <small className={settingsStyles.updateMeta}>{update.owner && update.repository ? `${update.owner}/${update.repository} · ${update.ref}` : update.channel}{update.lastCheckedAt ? ` · verificato ${new Date(update.lastCheckedAt).toLocaleString('it-IT')}` : ' · mai verificato'}</small>
                  {!sectionFailures.updates && managedUpdateFailures.get(update.id) && <ErrorNotice
                    action={{
                      label: 'Verifica di nuovo',
                      onClick: () => runUpdateAction(update.id, () => window.vincodeLab.updates.check(update.id), 'Controllo completato.'),
                      pendingLabel: 'Verifica in corso…',
                    }}
                    error={managedUpdateFailures.get(update.id)!}
                  />}
                </div>
                <div className={settingsStyles.updateActions}>
                  <Checkbox checked={update.policy === 'automatic'} disabled={updateBusy === update.id} label="Automatico" onCheckedChange={(checked) => void runUpdateAction(update.id, () => window.vincodeLab.updates.setPolicy(update.id, checked ? 'automatic' : 'manual'), 'Policy aggiornata.')} />
                  <Button size="sm" variant="outline" disabled={Boolean(updateBusy)} onClick={() => void runUpdateAction(update.id, () => window.vincodeLab.updates.check(update.id), 'Controllo completato.')}><RefreshCw aria-hidden="true" size={14} /> Verifica</Button>
                  <Button size="sm" disabled={Boolean(updateBusy) || !update.availableVersion || update.restartRequired} title={!update.availableVersion ? 'Nessuna versione disponibile' : update.restartRequired ? 'Aggiornamento già pronto' : 'Scarica in staging'} onClick={() => void runUpdateAction(update.id, () => window.vincodeLab.updates.download(update.id), 'Aggiornamento pronto.')}><Download aria-hidden="true" size={14} /> Scarica</Button>
                  <Button size="sm" variant="outline" disabled={Boolean(updateBusy) || !update.rollbackVersion} onClick={() => setConfirmation({ title: 'Ripristina versione precedente', detail: `Verrà ripristinata ${update.rollbackVersion} per ${update.name}.`, confirmLabel: 'Ripristina', destructive: true, onConfirm: () => { void runUpdateAction(update.id, () => window.vincodeLab.updates.rollback(update.id), 'Versione precedente ripristinata.') } })}><RotateCcw aria-hidden="true" size={14} /> Ripristina</Button>
                </div>
              </article>)}
            </div> : <p className={settingsStyles.empty}>Nessuna risorsa con aggiornamenti gestiti per questo filtro.</p>}
          </section>
        </Tabs.Content>

        <Tabs.Content asChild value="runtime">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <Bot aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Runtime Pi</h2>
                <p className={settingsStyles.runtime}>{status
                  ? status.state === 'ready' ? `${status.version} · ${status.executable}` : 'Pi Coding Agent non rilevato.'
                  : sectionFailures.runtime ? 'Runtime Pi non verificato.' : refreshing ? 'Verifica Pi in corso…' : 'Runtime Pi non ancora verificato.'}</p>
              </div>
            </div>
            {renderSectionFailure('runtime')}
            {status?.state === 'missing' && <div className={settingsStyles.runtimeMissing} role="status">
              <CircleAlert aria-hidden="true" size={18} />
              <span><strong>Pi Coding Agent non è installato o non è rilevabile.</strong> Il Terminale AI resta disattivato; Editor, Terminale locale, GitHub, Database e Redis continuano a funzionare. Installa Pi, poi seleziona “Aggiorna”.</span>
            </div>}
            <Button className={settingsStyles.primaryPanelAction} size="sm" variant="outline" disabled={configBusy || !piReady} title={!piReady ? 'Installa Pi e aggiorna la verifica prima di configurarlo' : undefined} onClick={() => void startConfig()}>
              {configBusy && <Spinner size={14} />}
              {configBusy ? 'Apertura configurazione…' : 'Configura Pi'}
            </Button>
            {configOpen && <article className={settingsStyles.config}>
              <div className={settingsStyles.configHeader}>
                <h2 className={settingsStyles.configTitle}>Configurazione nativa Pi</h2>
                <Button size="sm" variant="outline" disabled={configBusy} onClick={() => void closeConfig()}>
                  {configBusy && <Spinner size={14} />}
                  {configBusy ? 'Chiusura…' : 'Chiudi'}
                </Button>
              </div>
              <pre className={settingsStyles.configTerminal} aria-label="Terminale configurazione Pi">{configOutput || 'Avvio configurazione Pi…'}</pre>
              <Field.Root>
                <Field.Input aria-label="Input configurazione Pi" onKeyDown={(event) => { const keys: Record<string, string> = { Enter: '\r', ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowLeft: '\x1b[D', ArrowRight: '\x1b[C', Escape: '\x1b', Backspace: '\x7f', Tab: '\t' }; const value = keys[event.key] ?? (event.key.length === 1 ? event.key : ''); if (!value || event.metaKey || event.ctrlKey) return; event.preventDefault(); writeConfigInput(value) }} placeholder="Usa tastiera: Invio, frecce, Tab ed Esc sono inviati a Pi" />
              </Field.Root>
            </article>}
          </section>
        </Tabs.Content>

        <Tabs.Content asChild value="packages">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <Boxes aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Pacchetti Pi</h2>
                <p className={settingsStyles.panelDescription}>Un pacchetto può includere skill, estensioni, prompt e temi.</p>
              </div>
            </div>
            {renderSectionFailure('packages')}
            {!piReady && <div className={settingsStyles.runtimeMissing} role="status"><CircleAlert aria-hidden="true" size={18} /><span>Installa Pi Coding Agent prima di gestirne i pacchetti. Node e npm non sono necessari per avviare VincodeLab.</span></div>}
            <div className={settingsStyles.form}>
              <div className={settingsStyles.packageSource}>
                <SelectField aria-label="Tipo sorgente pacchetto Pi" disabled={Boolean(packageBusy) || !piReady} options={[{ value: 'npm', label: 'Catalogo Pi (npm)' }, { value: 'git', label: 'Git' }, { value: 'local', label: 'Locale' }]} value={packageSource} onValueChange={(value) => {
                  const nextSource = value as PackageSource
                  discardVolatileDraft(packageSourceDraftIdentity(packageSourceRef.current))
                  packageSourceRef.current = nextSource
                  setPackageSource(nextSource)
                  writeVolatileDraft(packageSourceDraftIdentity(nextSource), sourceRef.current, '')
                }} />
              </div>
              <Field.Root><Field.Input aria-label="Sorgente pacchetto Pi" disabled={Boolean(packageBusy) || !piReady} value={source} onChange={(event) => {
                sourceRef.current = event.target.value
                setSource(event.target.value)
                writeVolatileDraft(packageSourceDraftIdentity(packageSourceRef.current), event.target.value, '')
              }} placeholder={packageSourceCopy[packageSource].placeholder} /></Field.Root>
              <Button size="sm" disabled={Boolean(packageBusy) || !piReady || !source.trim()} onClick={() => mutatePackage('install', normalizedSource)}>
                {packageBusy?.startsWith('install:') && <Spinner size={14} />}
                {packageBusy?.startsWith('install:') ? 'Installazione…' : 'Installa'}
              </Button>
            </div>
            <p className={settingsStyles.formHelp}>{packageSourceCopy[packageSource].help} Verifica sempre la sorgente: i pacchetti possono eseguire codice.</p>
            {packages.length ? <ul className={settingsStyles.list}>
              {packages.map((item) => <li className={settingsStyles.listItem} key={item}>
                <code className={settingsStyles.listCode} title={item}>{item}</code>
                <span className={settingsStyles.listActions}>
                  <Button size="xs" variant="outline" disabled={Boolean(packageBusy)} onClick={() => mutatePackage('update', item)}>Aggiorna</Button>
                  <Button size="xs" variant="subtle" tone="danger" disabled={Boolean(packageBusy)} onClick={() => mutatePackage('remove', item)}>Rimuovi</Button>
                </span>
              </li>)}
            </ul> : <p className={settingsStyles.empty}>Nessun pacchetto Pi installato.</p>}
          </section>
        </Tabs.Content>

        <Tabs.Content asChild value="skills">
          <section className={settingsStyles.panel}>
            <div className={settingsStyles.panelHeading}>
              <FilePlus2 aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
              <div className={settingsStyles.panelHeadingCopy}>
                <h2 className={settingsStyles.panelTitle}>Skill Pi</h2>
                <p className={settingsStyles.panelDescription}>Catalogo delle sole risorse Pi, senza percorsi Codex.</p>
              </div>
            </div>
            {renderSectionFailure('skills')}

            <section className={settingsStyles.skillGroup}>
              <div className={settingsStyles.groupHeading}>
                <h3 className={settingsStyles.groupTitle} id="system-skills-list-label">Manuali</h3>
                <p className={settingsStyles.groupDescription}>Disponibili in <code>~/.pi/agent/skills</code> e modificabili dall’app.</p>
              </div>
              <div className={settingsStyles.form}>
                <Field.Root invalid={Boolean(skillNameFailure)}><Field.Input aria-label="Nome skill Pi" disabled={Boolean(systemSkillBusy)} value={skillName} onChange={(event) => {
                  skillNameRef.current = event.target.value
                  setSkillName(event.target.value)
                  setSkillNameFailure(null)
                  writeVolatileDraft(newSystemSkillDraftIdentity, event.target.value, '')
                }} placeholder="es. revisione-codice" />
                  {skillNameFailure && <Field.ErrorText>{skillNameFailure.title}. {skillNameFailure.description} Riferimento {skillNameFailure.correlationId}.</Field.ErrorText>}
                </Field.Root>
                <Button size="sm" disabled={Boolean(systemSkillBusy) || !skillName.trim()} onClick={() => setConfirmation({ title: 'Crea skill Pi', detail: `La skill ${skillName} sarà disponibile globalmente per Pi.`, confirmLabel: 'Crea', onConfirm: () => { void createSystemSkill() } })}>
                  {systemSkillBusy === 'create' && <Spinner size={14} />}
                  {systemSkillBusy === 'create' ? 'Creazione…' : skillNameFailure ? 'Riprova creazione' : 'Crea skill'}
                </Button>
              </div>
              {skills.length ? <div className={settingsStyles.skillList}>
                <Listbox.Root collection={systemSkillCollection} deselectable={false} ids={{ label: 'system-skills-list-label' }} loopFocus selectionMode="single" value={selectedSkill ? [selectedSkill.id] : []} onValueChange={({ value }) => { const skillId = value[0]; if (skillId) requestSelectSystemSkill(skillId) }}>
                  <Listbox.Content className={settingsStyles.skillListbox}>
                    {skills.map((skill) => <Listbox.Item className={settingsStyles.skillItem} highlightOnHover item={skill} key={skill.id}>
                      <Listbox.ItemText asChild>
                        <span className={settingsStyles.skillItemText}>
                          <strong className={settingsStyles.skillItemTitle}>{skill.name}</strong>
                          <small className={settingsStyles.skillItemDescription}>{skill.description || 'Descrizione mancante'}</small>
                        </span>
                      </Listbox.ItemText>
                      <Listbox.ItemIndicator><Check aria-hidden="true" size={14} /></Listbox.ItemIndicator>
                    </Listbox.Item>)}
                  </Listbox.Content>
                </Listbox.Root>
                <div className={settingsStyles.skillDeleteActions}>{skills.map((skill) => <span className={settingsStyles.skillDeleteAction} key={skill.id}><IconButton disabled={Boolean(systemSkillBusy)} tone="danger" tooltip={`Elimina ${skill.name}`} variant="subtle" onClick={() => requestDeleteSystemSkill(skill)}><Trash2 aria-hidden="true" size={14} /></IconButton></span>)}</div>
              </div> : <p className={settingsStyles.empty}>Nessuna skill manuale.</p>}
            </section>

            <section className={`${settingsStyles.skillGroup} ${settingsStyles.separatedSkillGroup}`}>
              <div className={settingsStyles.groupHeading}>
                <h3 className={settingsStyles.groupTitle}>Da pacchetti Pi</h3>
                <p className={settingsStyles.groupDescription}>Rilevate dai pacchetti npm e Git installati per Pi. Sono in sola lettura.</p>
              </div>
              {packageSkills.length ? <ul className={settingsStyles.list}>
                {packageSkills.map((skill) => <li className={settingsStyles.listItem} key={skill.id}>
                  <div className={settingsStyles.packageSkillBody}>
                    <strong className={settingsStyles.packageSkillTitle}>{skill.name}</strong>
                    <small className={settingsStyles.packageSkillDescription}>{skill.description || 'Descrizione mancante'}</small>
                    {!skill.valid && <small className={`${settingsStyles.packageSkillDescription} ${settingsStyles.skillWarning}`}>La skill non può essere usata. Controlla o aggiorna il pacchetto di origine.</small>}
                    <code className={settingsStyles.packageSkillSource} title={skill.source}>{skill.source}</code>
                  </div>
                </li>)}
              </ul> : <p className={settingsStyles.empty}>Nessuna skill rilevata dai pacchetti Pi.</p>}
            </section>

            {selectedSkill && <div className={settingsStyles.skillEditor}>
              <div className={settingsStyles.skillEditorHeader}>
                <h3 className={settingsStyles.skillEditorTitle}>{selectedSkill.name}</h3>
                <span className={settingsStyles.skillEditorDescription}>Modifica il contenuto della skill Pi selezionata.</span>
              </div>
              <Field.Root className={settingsStyles.skillEditorField} invalid={Boolean(skillEditorFailure)}>
                <Field.Textarea aria-label={`Contenuto skill ${selectedSkill.name}`} disabled={systemSkillSaving} value={selectedSkill.content ?? ''} onChange={(event) => {
                  const nextSkill = { ...selectedSkill, content: event.target.value }
                  writeVolatileDraft(systemSkillDraftIdentity(selectedSkill.id), event.target.value, savedSystemSkillContentRef.current)
                  selectedSystemSkillRef.current = nextSkill
                  setSelectedSkill(nextSkill)
                  setSkillEditorFailure(null)
                }} />
                {skillEditorFailure && <Field.ErrorText>{skillEditorFailure.title}. {skillEditorFailure.description} Riferimento {skillEditorFailure.correlationId}.</Field.ErrorText>}
              </Field.Root>
              <Button size="sm" disabled={systemSkillSaving || !systemSkillHasUnsavedChanges} onClick={() => void saveSystemSkill()}>
                {systemSkillSaving && <Spinner size={14} />}
                {systemSkillSaving ? 'Salvataggio…' : skillEditorFailure ? 'Riprova salvataggio' : 'Salva modifiche'}
              </Button>
            </div>}
          </section>
        </Tabs.Content>
      </main>
    </section>
  </Tabs.Root>
}
