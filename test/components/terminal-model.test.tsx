// oxlint-disable-next-line typescript/triple-slash-reference -- include the renderer's ambient Electron bridge types in the isolated component-test project.
/// <reference path="../../src/vincode-lab.d.ts" />

import { describe, expect, it, vi } from 'vitest'
import {
  terminalSessionStatusLabel,
  terminalSessionUiStatus,
} from '@/features/terminal/model/terminal-session'
import {
  reportTerminalClipboardFailure,
  reportTerminalPreferenceFailure,
  terminalFailureFromEvent,
} from '@/features/terminal/services/terminal-error'

describe('terminal session model', () => {
  it('normalizza gli stati del processo senza inventare uno stato di errore', () => {
    expect(terminalSessionUiStatus('starting')).toBe('starting')
    expect(terminalSessionUiStatus('running')).toBe('ready')
    expect(terminalSessionUiStatus('exited')).toBe('exited')
    expect(terminalSessionUiStatus(undefined)).toBe('ready')
  })

  it('mantiene centralizzati i testi mostrati dalla toolbar', () => {
    expect(terminalSessionStatusLabel('starting')).toBe('Avvio shell…')
    expect(terminalSessionStatusLabel('ready')).toBe('Shell pronta')
    expect(terminalSessionStatusLabel('exited')).toBe('Shell terminata')
    expect(terminalSessionStatusLabel('error')).toBe('Shell non disponibile')
  })
})

describe('terminal error mapping', () => {
  it('conserva classificazione, correlation ID e recovery degli errori shell', () => {
    const failure = terminalFailureFromEvent({
      sessionId: 'shell-1',
      operation: 'resize',
      recovery: 'resize',
      error: {
        category: 'process',
        code: 'PTY_RESIZE_FAILED',
        correlationId: 'ERR-A1B2C3',
        message: 'resize failed [PTY_RESIZE_FAILED] [ERR-A1B2C3]',
        recoverable: true,
        severity: 'warning',
      },
    })

    expect(failure.recovery).toBe('resize')
    expect(failure.error).toMatchObject({
      category: 'process',
      code: 'PTY_RESIZE_FAILED',
      correlationId: 'ERR-A1B2C3',
      operation: 'resize',
      recoverable: true,
      severity: 'warning',
      title: 'Terminale non ridimensionato',
    })
    expect(failure.error.description).toBe('resize failed')
  })

  it('mantiene distinto il copy di recovery per preferenze e clipboard', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const preference = reportTerminalPreferenceFailure(new Error('password=privata storage unavailable'), 'load')
    const clipboard = reportTerminalClipboardFailure(new Error('token=privato clipboard denied'), 'paste')

    expect(preference).toMatchObject({
      category: 'persistence',
      operation: 'load-terminal-preferences',
      title: 'Preferenze del terminale non caricate',
    })
    expect(preference.description).toContain('dimensione predefinita')
    expect(clipboard.action).toBe('paste')
    expect(clipboard.error).toMatchObject({
      category: 'permission',
      operation: 'paste',
      title: 'Testo non incollato',
    })
    expect(clipboard.error.description).toContain('sessione del terminale è rimasta attiva')
    expect(clipboard.error.technicalMessage).not.toMatch(/token|privato/iu)
  })
})
