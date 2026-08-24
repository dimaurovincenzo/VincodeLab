import { useEffect, useState } from 'react'
import { appBridge } from '@/app/api/app.bridge'
import { reportRendererFailure, reportTransientFailure, showUserErrorToast } from '@/lib/renderer-error'
import type { AppSection } from '../model/app-controller.types'

type AppAppearance = 'system' | 'light' | 'dark'

export function useAppAppearance(selectAppSection: (section: AppSection) => void) {
  const [appearance, setAppearance] = useState<'system' | 'light' | 'dark'>('system')

  useEffect(() => {
    let active = true
    void appBridge.appearance.get().then((value) => {
      if (active) setAppearance(value)
    }).catch((nextError) => {
      // L'app resta utilizzabile con il tema di sistema anche se la preferenza non è disponibile.
      const incident = reportRendererFailure(nextError, {
        category: 'configuration',
        component: 'appearance',
        operation: 'load-theme',
        severity: 'warning',
        title: 'Tema salvato non disponibile',
        description: 'È stato applicato il tema di sistema. Puoi verificare la preferenza nelle Impostazioni.',
      })
      showUserErrorToast(incident, {
        label: 'Apri impostazioni',
        onClick: () => selectAppSection('settings'),
      })
    })
    return () => { active = false }
  }, [selectAppSection])

  useEffect(() => {
    document.documentElement.dataset.theme = appearance
    document.documentElement.style.colorScheme = appearance === 'system' ? 'light dark' : appearance
  }, [appearance])

  const changeAppearance = async (value: AppAppearance) => {
    try {
      setAppearance(await appBridge.appearance.set(value))
    } catch (nextError) {
      reportTransientFailure(nextError, {
        category: 'configuration',
        component: 'appearance',
        operation: 'set-theme',
        title: 'Aspetto non aggiornato',
        description: 'Il tema precedente è rimasto attivo. Puoi riprovare senza perdere altre preferenze.',
      }, { label: 'Riprova', onClick: () => { void changeAppearance(value) } })
    }
  }

  return { appearance, changeAppearance }
}
