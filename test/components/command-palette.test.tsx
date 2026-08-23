import { useRef, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, type CommandPaletteItem, type CommandPaletteMode } from '@/components/command-palette'

const items: CommandPaletteItem[] = [
  { id: 'file.open', label: 'Apri file', category: 'File', shortcut: '⌘O' },
  { id: 'file.save', label: 'Salva file', category: 'File', shortcut: '⌘S' },
  { id: 'view.terminal', label: 'Mostra terminale', description: 'Porta il focus al terminale', category: 'Vista' },
]

function PaletteHarness({
  mode = 'commands',
  paletteItems = items,
  onSelect,
}: {
  mode?: CommandPaletteMode
  paletteItems?: readonly CommandPaletteItem[]
  onSelect: (item: CommandPaletteItem) => void | boolean | Promise<void | boolean>
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Apri palette</button>
    <CommandPalette items={paletteItems} mode={mode} open={open} onOpenChange={setOpen} onSelect={onSelect} />
  </>
}

function FocusOutcomeHarness() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const target = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={opener} type="button" onClick={() => setOpen(true)}>Apri palette focus</button>
    <button ref={target} type="button">Destinazione comando</button>
    <CommandPalette
      items={[{ id: 'navigation.editor', label: 'Vai all’Editor' }]}
      mode="commands"
      open={open}
      onOpenChange={setOpen}
      onSelect={() => {
        target.current?.focus()
        // Simula il ripristino intermedio dell'opener eseguito dal dialog Ark.
        opener.current?.focus()
        return true
      }}
    />
  </>
}

function ModeSwitchHarness() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<CommandPaletteMode>('commands')
  const paletteItems: CommandPaletteItem[] = mode === 'commands'
    ? [{ id: 'workbench.quickOpen', label: 'Apri rapidamente' }]
    : [{ id: 'src/App.tsx', label: 'App.tsx', path: 'src/App.tsx' }]

  return <>
    <button type="button" onClick={() => setOpen(true)}>Apri palette modalità</button>
    <CommandPalette
      items={paletteItems}
      mode={mode}
      open={open}
      onOpenChange={setOpen}
      onSelect={(item) => {
        if (item.id !== 'workbench.quickOpen') return true
        setMode('files')
        return false
      }}
    />
  </>
}

function RetainedPaletteHarness({
  outcome,
  onSelection,
  onSelectionError,
}: {
  outcome: 'false' | 'error'
  onSelection: () => void
  onSelectionError: (error: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const target = useRef<HTMLButtonElement>(null)
  return <>
    <button type="button" onClick={() => setOpen(true)}>Apri palette cleanup</button>
    <button ref={target} type="button">Target transitorio</button>
    <CommandPalette
      items={[{ id: 'navigation.transient', label: 'Azione transitoria' }]}
      mode="commands"
      open={open}
      onOpenChange={setOpen}
      onSelectionError={onSelectionError}
      onSelect={() => {
        target.current?.focus()
        onSelection()
        if (outcome === 'error') throw new Error('Selezione fallita')
        return false
      }}
    />
  </>
}

describe('CommandPalette', () => {
  it('focuses the native Ark Combobox, exposes count and shortcut, then returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<PaletteHarness onSelect={() => undefined} />)

    const opener = screen.getByRole('button', { name: 'Apri palette' })
    await user.click(opener)

    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByRole('dialog', { name: 'Palette comandi' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('3 risultati')
    expect(screen.getByLabelText('Scorciatoia ⌘⇧P')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('filters and ranks results, then selects the autohighlighted item with Enter', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PaletteHarness onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await user.type(input, 'salva')

    expect(screen.getByRole('status')).toHaveTextContent('1 risultato')
    expect(screen.getByRole('option', { name: /Salva file/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Apri file/ })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'file.save' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('does not select a stale result when query input and Enter arrive together', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(() => false)
    render(<PaletteHarness onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await waitFor(() => expect(input).toHaveFocus())
    act(() => {
      fireEvent.change(input, { target: { value: 'salva' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'file.save' })))
  })

  it('moves the highlighted option with Arrow keys using Ark navigation', async () => {
    const user = userEvent.setup()
    render(<PaletteHarness onSelect={() => false} />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    await screen.findByRole('combobox', { name: 'Palette comandi' })
    const options = screen.getAllByRole('option')

    await user.keyboard('{ArrowDown}')
    const firstHighlight = options.find((option) => option.hasAttribute('data-highlighted'))
    expect(firstHighlight).toBeDefined()

    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      const nextHighlight = options.find((option) => option.hasAttribute('data-highlighted'))
      expect(nextHighlight).toBeDefined()
      expect(nextHighlight).not.toBe(firstHighlight)
    })
  })

  it('keeps the palette open when selection returns false and reports empty results accessibly', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(() => false)
    render(<PaletteHarness onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await user.type(input, 'apri')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('dialog', { name: 'Palette comandi' })).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, 'nessuna corrispondenza')
    expect(screen.getByRole('status')).toHaveTextContent('0 risultati')
    expect(screen.getByText('Nessun comando corrispondente.')).toBeInTheDocument()
  })

  it('adapts copy and basename search to Quick Open file mode', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<PaletteHarness
      mode="files"
      onSelect={onSelect}
      paletteItems={[
        { id: '/workspace/src/editor.tsx', label: 'src/editor.tsx', path: '/workspace/src/editor.tsx' },
        { id: '/workspace/README.md', label: 'README.md', path: '/workspace/README.md' },
      ]}
    />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Apertura rapida' })
    expect(input).toHaveAttribute('placeholder', 'Cerca un file per nome o percorso…')
    expect(screen.getByLabelText('Scorciatoia ⌘P')).toBeInTheDocument()

    await user.type(input, 'readme.md')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /README.md/ })).toBeInTheDocument()
  })

  it('supports the workspace switcher mode without a separate primitive', async () => {
    const user = userEvent.setup()
    render(<PaletteHarness
      mode="workspaces"
      onSelect={() => undefined}
      paletteItems={[{ id: '/workspace/vincodelab', label: 'VincodeLab', path: '/workspace/vincodelab' }]}
    />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Cambia workspace' })
    expect(input).toHaveAttribute('placeholder', 'Cerca un workspace…')
    expect(screen.getByRole('option', { name: /VincodeLab/ })).toBeInTheDocument()
  })

  it('does not restore the opener over focus assigned by a selected command', async () => {
    const user = userEvent.setup()
    render(<FocusOutcomeHarness />)

    await user.click(screen.getByRole('button', { name: 'Apri palette focus' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Destinazione comando' })).toHaveFocus()
  })

  it('switches from commands to Quick Open without closing the active dialog', async () => {
    const user = userEvent.setup()
    render(<ModeSwitchHarness />)

    await user.click(screen.getByRole('button', { name: 'Apri palette modalità' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await waitFor(() => expect(input).toHaveFocus())
    await user.keyboard('{Enter}')

    const quickOpen = await screen.findByRole('combobox', { name: 'Apertura rapida' })
    expect(quickOpen).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Apertura rapida' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /App.tsx/ })).toBeInTheDocument()
  })

  it.each(['false', 'error'] as const)(
    'clears a transient focus target when selection ends with %s',
    async (outcome) => {
      const user = userEvent.setup()
      const onSelection = vi.fn()
      const onSelectionError = vi.fn()
      render(<RetainedPaletteHarness
        onSelection={onSelection}
        onSelectionError={onSelectionError}
        outcome={outcome}
      />)

      const opener = screen.getByRole('button', { name: 'Apri palette cleanup' })
      await user.click(opener)
      const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
      await waitFor(() => expect(input).toHaveFocus())
      await user.keyboard('{Enter}')

      await waitFor(() => expect(onSelection).toHaveBeenCalledOnce())
      if (outcome === 'error') {
        await waitFor(() => expect(onSelectionError).toHaveBeenCalledOnce())
      }
      expect(screen.getByRole('dialog', { name: 'Palette comandi' })).toBeInTheDocument()

      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(opener).toHaveFocus()
    },
  )

  it('removes external focus tracking when unmounted during an async selection', async () => {
    const user = userEvent.setup()
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<PaletteHarness onSelect={() => new Promise(() => undefined)} />)

    await user.click(screen.getByRole('button', { name: 'Apri palette' }))
    const input = await screen.findByRole('combobox', { name: 'Palette comandi' })
    await waitFor(() => expect(input).toHaveFocus())
    const registrationStart = addListener.mock.calls.length
    await user.keyboard('{Enter}')

    const focusRegistration = addListener.mock.calls.slice(registrationStart).find(
      ([type, , capture]) => type === 'focusin' && capture === true,
    )
    expect(focusRegistration).toBeDefined()

    unmount()
    expect(removeListener).toHaveBeenCalledWith('focusin', focusRegistration?.[1], true)
    addListener.mockRestore()
    removeListener.mockRestore()
  })
})
