import { describe, expect, it } from 'vitest'
import { suppressGlobalTerminalShortcut } from '@/lib/workbench-shortcuts'

describe('guard delle shortcut globali terminale', () => {
  it('blocca campi, combobox e dialog senza intercettare xterm', () => {
    const input = document.createElement('input')
    const dialog = document.createElement('div')
    const dialogButton = document.createElement('button')
    dialog.setAttribute('role', 'dialog')
    dialog.append(dialogButton)

    const xterm = document.createElement('div')
    const xtermTextarea = document.createElement('textarea')
    xterm.dataset.xtermHost = 'shell'
    xterm.append(xtermTextarea)

    expect(suppressGlobalTerminalShortcut(input)).toBe(true)
    expect(suppressGlobalTerminalShortcut(dialogButton)).toBe(true)
    expect(suppressGlobalTerminalShortcut(xtermTextarea)).toBe(false)
    expect(suppressGlobalTerminalShortcut(document.body)).toBe(false)
  })
})
