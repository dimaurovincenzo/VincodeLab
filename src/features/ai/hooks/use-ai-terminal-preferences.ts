import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Terminal } from '@xterm/xterm'
import { terminalFontFamily } from '@/lib/app-preferences'
import { reportTransientFailure } from '@/lib/renderer-error'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '@/lib/terminal-preferences.js'
import type { FitAddonInstance } from '../model/ai-runtime.types'

type UseAiTerminalPreferencesOptions = {
  fitAddon: RefObject<FitAddonInstance | null>
  getTerminal: () => Terminal | null
  preferredTerminalFontSize: number
  workspace: string | null
}

export function useAiTerminalPreferences({
  fitAddon,
  getTerminal,
  preferredTerminalFontSize,
  workspace,
}: UseAiTerminalPreferencesOptions) {
  const [fontSize, setFontSize] = useState(11)
  const fontSizeRef = useRef(fontSize)

  const persistAiTerminalPreferences = useCallback(function persistAiTerminalPreferencesAction(workspacePath: string, nextFontSize: number) {
    writeTerminalPreferences(workspacePath, { fontSize: nextFontSize, followOutput: true }, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'save-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non salvate',
          description: 'La nuova dimensione resta attiva in questa sessione, ma potrebbe non essere ripristinata alla prossima apertura.',
        }, { label: 'Salva di nuovo', onClick: () => { persistAiTerminalPreferencesAction(workspacePath, nextFontSize) } })
      },
    })
  }, [])

  const loadAiTerminalPreferences = useCallback(function loadAiTerminalPreferencesAction(workspacePath: string) {
    const preferences = readTerminalPreferences(workspacePath, {
      onError: (nextError) => {
        reportTransientFailure(nextError, {
          category: 'persistence',
          component: 'ai-terminal',
          operation: 'load-terminal-preferences',
          severity: 'warning',
          title: 'Preferenze del terminale non caricate',
          description: 'È stata applicata la dimensione predefinita. La sessione e l’output sono rimasti disponibili.',
        }, { label: 'Carica di nuovo', onClick: () => { loadAiTerminalPreferencesAction(workspacePath) } })
      },
    })
    fontSizeRef.current = preferences.fontSize
    setFontSize(preferences.fontSize)
    const xterm = getTerminal()
    if (xterm) xterm.options.fontSize = preferences.fontSize
    fitAddon.current?.fit()
  }, [fitAddon, getTerminal])

  const changeFontSize = useCallback((delta: number) => {
    const next = nextTerminalFontSize(fontSizeRef.current, delta)
    fontSizeRef.current = next
    setFontSize(next)
    if (workspace) persistAiTerminalPreferences(workspace, next)
  }, [persistAiTerminalPreferences, workspace])

  const resetTerminalZoom = useCallback(() => {
    fontSizeRef.current = preferredTerminalFontSize
    setFontSize(preferredTerminalFontSize)
    if (workspace) persistAiTerminalPreferences(workspace, preferredTerminalFontSize)
  }, [persistAiTerminalPreferences, preferredTerminalFontSize, workspace])

  return {
    changeFontSize,
    fontSize,
    fontSizeRef,
    loadAiTerminalPreferences,
    resetTerminalZoom,
    setFontSize,
  }
}

type UseAiTerminalZoomEffectOptions = {
  fitAddon: RefObject<FitAddonInstance | null>
  fontSize: number
  getTerminal: () => Terminal | null
}

export function useAiTerminalZoomEffect({ fitAddon, fontSize, getTerminal }: UseAiTerminalZoomEffectOptions) {
  useEffect(() => {
    const xterm = getTerminal()
    if (!xterm) return
    xterm.options.fontSize = fontSize
    requestAnimationFrame(() => fitAddon.current?.fit())
  }, [fitAddon, fontSize, getTerminal])
}

type UseAiTerminalPreferenceSyncEffectOptions = {
  fitAddon: RefObject<FitAddonInstance | null>
  fontSizeRef: RefObject<number>
  getTerminal: () => Terminal | null
  preferredTerminalCursorStyle: 'bar' | 'block' | 'underline'
  preferredTerminalFontFamily: string
  preferredTerminalFontSize: number
  preferredTerminalScrollback: number
  setFontSize: Dispatch<SetStateAction<number>>
}

export function useAiTerminalPreferenceSyncEffect({
  fitAddon,
  fontSizeRef,
  getTerminal,
  preferredTerminalCursorStyle,
  preferredTerminalFontFamily,
  preferredTerminalFontSize,
  preferredTerminalScrollback,
  setFontSize,
}: UseAiTerminalPreferenceSyncEffectOptions) {
  useEffect(() => {
    fontSizeRef.current = preferredTerminalFontSize
    queueMicrotask(() => setFontSize(preferredTerminalFontSize))
    const xterm = getTerminal()
    if (!xterm) return
    xterm.options.fontSize = preferredTerminalFontSize
    xterm.options.fontFamily = terminalFontFamily(preferredTerminalFontFamily)
    xterm.options.cursorStyle = preferredTerminalCursorStyle
    xterm.options.scrollback = preferredTerminalScrollback
    fitAddon.current?.fit()
  }, [fitAddon, fontSizeRef, getTerminal, preferredTerminalCursorStyle, preferredTerminalFontFamily, preferredTerminalFontSize, preferredTerminalScrollback, setFontSize])
}
