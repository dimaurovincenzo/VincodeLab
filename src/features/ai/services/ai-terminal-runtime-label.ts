import type { AiTerminalFallbackReason, AiTerminalRuntimeState } from '@/bridge'

const fallbackDescriptions: Record<AiTerminalFallbackReason, string> = {
  missing: 'Herdr non è stato rilevato.',
  'not-executable': 'Herdr è presente ma non è eseguibile.',
  timeout: 'Herdr non ha completato la verifica iniziale in tempo.',
  'invalid-version-output': 'Herdr non ha restituito una versione riconoscibile.',
  'preflight-failed': 'La verifica iniziale di Herdr non è riuscita.',
  'spawn-failed': 'Il client Herdr non è stato avviato.',
  'early-exit': 'Il client Herdr si è chiuso prima di mostrare contenuti.',
  'nested-herdr': 'VincodeLab è già stato avviato dentro Herdr; il client annidato è stato evitato.',
  disabled: 'Herdr è disattivato in questa modalità di verifica di VincodeLab.',
}

export function aiTerminalRuntimeLabel(state: AiTerminalRuntimeState | null) {
  if (!state) return 'Runtime in rilevamento'
  if (state.runtime === 'herdr') return `Herdr · sessione condivisa · ${state.piAvailable === false ? 'Pi locale non rilevato' : 'seleziona o avvia un pane Pi'}`
  return state.fallbackReason ? 'Pi diretto · Herdr non disponibile' : 'Pi diretto'
}

export function aiTerminalRuntimeDescription(state: AiTerminalRuntimeState | null) {
  if (state?.fallbackReason) return fallbackDescriptions[state.fallbackReason]
  if (state?.runtime === 'herdr' && state.piAvailable === false) return 'Herdr è disponibile, ma Pi locale non è rilevabile: la recovery Pi diretto richiederà l’installazione di Pi.'
  return undefined
}
