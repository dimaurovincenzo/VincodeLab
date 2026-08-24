import { useCallback, useEffect, useRef, useState } from 'react'
import { settingsBridge } from '../api/settings.bridge'
import { defaultPiConfigDimensions } from '../model/settings-model'
import { settingsUserError } from '../services/settings-error'
import type { SettingsRefreshController } from './use-settings-refresh'

export function usePiConfig(active: boolean, refreshController: SettingsRefreshController) {
  const {
    clearSectionFailure,
    isMounted,
    markSectionOperation,
    mounted,
    publishSectionFailure,
  } = refreshController
  const [configOutput, setConfigOutput] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [configBusy, setConfigBusy] = useState(false)
  const configOpenRef = useRef(false)
  const configStartGeneration = useRef(0)
  const activeRef = useRef(active)

  const closeConfig = useCallback(async () => {
    configStartGeneration.current += 1
    if (configOpenRef.current) markSectionOperation('runtime')
    if (isMounted()) setConfigBusy(configOpenRef.current)
    if (!configOpenRef.current) {
      queueMicrotask(() => {
        if (!isMounted()) return
        setConfigOpen(false)
        setConfigOutput('')
      })
      return
    }
    configOpenRef.current = false
    try {
      await settingsBridge.piConfig.close()
      clearSectionFailure('runtime')
    } catch (cause) {
      if (isMounted()) publishSectionFailure('runtime', {
        error: settingsUserError(cause, {
          category: 'process',
          description: 'La configurazione è stata chiusa nella pagina, ma Pi potrebbe essere ancora in arresto.',
          operation: 'close-pi-config',
          title: 'Configurazione Pi non chiusa completamente',
        }),
        recovery: {
          label: 'Riprova chiusura',
          run: async () => {
            await settingsBridge.piConfig.close()
            clearSectionFailure('runtime')
          },
        },
      })
    } finally {
      if (isMounted()) {
        setConfigBusy(false)
        setConfigOpen(false)
        setConfigOutput('')
      }
    }
  }, [clearSectionFailure, isMounted, markSectionOperation, publishSectionFailure])

  const startConfig = useCallback(async function openConfig(): Promise<void> {
    markSectionOperation('runtime')
    const generation = ++configStartGeneration.current
    setConfigBusy(true)
    try {
      await settingsBridge.piConfig.start()
      if (!isMounted() || !activeRef.current || generation !== configStartGeneration.current) {
        await settingsBridge.piConfig.close()
        return
      }
      configOpenRef.current = true
      setConfigOpen(true)
      clearSectionFailure('runtime')
    } catch (cause) {
      if (isMounted() && generation === configStartGeneration.current) publishSectionFailure('runtime', {
        error: settingsUserError(cause, {
          category: 'configuration',
          description: 'La configurazione Pi non è stata aperta. Le altre impostazioni restano disponibili.',
          operation: 'open-pi-config',
          title: 'Configurazione Pi non disponibile',
        }),
        recovery: { label: 'Apri configurazione', run: openConfig },
      })
    } finally {
      if (isMounted() && generation === configStartGeneration.current) setConfigBusy(false)
    }
  }, [clearSectionFailure, isMounted, markSectionOperation, publishSectionFailure])

  const writeConfigInput = useCallback((value: string): void => {
    try {
      settingsBridge.piConfig.write(value)
    } catch (cause) {
      markSectionOperation('runtime')
      publishSectionFailure('runtime', {
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
      })
    }
  }, [closeConfig, markSectionOperation, publishSectionFailure, startConfig])

  const retryConfigResize = useCallback(() => {
    settingsBridge.piConfig.resize(defaultPiConfigDimensions)
    clearSectionFailure('runtime')
  }, [clearSectionFailure])

  useEffect(() => {
    const offData = settingsBridge.piConfig.onData((data) => queueMicrotask(() => {
      if (mounted.current) setConfigOutput((value) => (value + data).slice(-200000))
    }))
    const offExit = settingsBridge.piConfig.onExit((exitStatus) => queueMicrotask(() => {
      if (!mounted.current) return
      const endedUnexpectedly = configOpenRef.current && (exitStatus.exitCode !== 0 || exitStatus.signal !== 0)
      configOpenRef.current = false
      setConfigOpen(false)
      setConfigBusy(false)
      if (endedUnexpectedly) {
        markSectionOperation('runtime')
        publishSectionFailure('runtime', {
          error: settingsUserError(new Error(`Pi config exit ${exitStatus.exitCode}, signal ${exitStatus.signal}`), {
            category: 'process',
            description: 'La sessione di configurazione si è interrotta. Le altre impostazioni e l’output già ricevuto non sono cambiati.',
            operation: 'pi-config-exit',
            title: 'Configurazione Pi interrotta',
          }),
          recovery: { label: 'Riapri configurazione', run: startConfig },
        })
      }
    }))
    const offError = settingsBridge.piConfig.onError?.((event) => queueMicrotask(() => {
      if (!mounted.current) return
      const inputFailure = event.operation === 'input'
      markSectionOperation('runtime')
      publishSectionFailure('runtime', {
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
      })
    })) ?? (() => undefined)
    return () => {
      configStartGeneration.current += 1
      offData()
      offExit()
      offError()
      if (configOpenRef.current) {
        configOpenRef.current = false
        void settingsBridge.piConfig.close().catch((cause) => {
          settingsUserError(cause, {
            category: 'process',
            operation: 'close-pi-config-on-unmount',
            title: 'Chiusura configurazione Pi non confermata',
            description: 'La pagina Impostazioni è stata chiusa. La sessione di configurazione verrà verificata al prossimo accesso.',
          })
        })
      }
    }
  }, [closeConfig, markSectionOperation, mounted, publishSectionFailure, retryConfigResize, startConfig])

  useEffect(() => {
    activeRef.current = active
    if (!active) void closeConfig()
  }, [active, closeConfig])

  return {
    closeConfig,
    configBusy,
    configOpen,
    configOutput,
    startConfig,
    writeConfigInput,
  }
}

export type PiConfigController = ReturnType<typeof usePiConfig>
