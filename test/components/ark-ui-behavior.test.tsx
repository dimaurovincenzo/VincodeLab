import { useRef, useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Dialog, Tabs } from '@/components/ui'

function DialogHarness() {
  const initialFocus = useRef<HTMLInputElement>(null)

  return (
    <Dialog.Root initialFocusEl={() => initialFocus.current}>
      <Dialog.Trigger asChild>
        <button type="button">Apri impostazioni</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Title>Impostazioni progetto</Dialog.Title>
            <Dialog.Description>Configura il progetto attivo.</Dialog.Description>
            <input ref={initialFocus} aria-label="Nome progetto" />
            <button type="button">Salva</button>
            <Dialog.CloseTrigger asChild>
              <button type="button">Chiudi</button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TabsHarness() {
  return (
    <Tabs.Root defaultValue="editor">
      <Tabs.List aria-label="Aree workspace">
        <Tabs.Trigger value="editor">Editor</Tabs.Trigger>
        <Tabs.Trigger value="terminal">Terminale</Tabs.Trigger>
        <Tabs.Trigger value="database">Database</Tabs.Trigger>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Content value="editor">Vista editor</Tabs.Content>
      <Tabs.Content value="terminal">Vista terminale</Tabs.Content>
      <Tabs.Content value="database">Vista database</Tabs.Content>
    </Tabs.Root>
  )
}

function PersistentViewsHarness() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  return (
    <main data-theme={theme}>
      <button type="button" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
        Cambia tema
      </button>
      <Tabs.Root defaultValue="editor" lazyMount={false} unmountOnExit={false}>
        <Tabs.List aria-label="Viste persistenti">
          <Tabs.Trigger value="editor">Editor persistente</Tabs.Trigger>
          <Tabs.Trigger value="database">Database persistente</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="editor">
          <div data-testid="editor-instance">Istanza CodeMirror</div>
        </Tabs.Content>
        <Tabs.Content value="database">
          <div data-testid="database-instance">Istanza griglia</div>
        </Tabs.Content>
      </Tabs.Root>
    </main>
  )
}

describe('primitive Ark/Park', () => {
  it('traps focus in Dialog, closes on Escape and returns focus to its opener', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const opener = screen.getByRole('button', { name: 'Apri impostazioni' })
    await user.click(opener)

    const initialField = await screen.findByRole('textbox', { name: 'Nome progetto' })
    await waitFor(() => expect(initialField).toHaveFocus())

    await user.tab()
    expect(screen.getByRole('button', { name: 'Salva' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Chiudi' })).toHaveFocus()
    await user.tab()
    expect(initialField).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('moves roving focus with arrow keys and wraps horizontal Tabs', async () => {
    const user = userEvent.setup()
    render(<TabsHarness />)

    const editor = screen.getByRole('tab', { name: 'Editor' })
    const terminal = screen.getByRole('tab', { name: 'Terminale' })
    const database = screen.getByRole('tab', { name: 'Database' })

    await user.click(editor)
    expect(editor).toHaveFocus()
    expect(editor).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(terminal).toHaveFocus())

    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(editor).toHaveFocus())
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(database).toHaveFocus())
  })

  it('keeps persistent view nodes mounted across navigation and theme changes', async () => {
    const user = userEvent.setup()
    const { container } = render(<PersistentViewsHarness />)

    const editorNode = screen.getByTestId('editor-instance')
    const databaseNode = screen.getByTestId('database-instance')
    const root = container.querySelector('main')

    expect(root).toHaveAttribute('data-theme', 'light')
    await user.click(screen.getByRole('tab', { name: 'Database persistente' }))
    expect(screen.getByTestId('editor-instance')).toBe(editorNode)
    expect(screen.getByTestId('database-instance')).toBe(databaseNode)
    expect(editorNode.isConnected).toBe(true)
    expect(databaseNode.isConnected).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Cambia tema' }))
    expect(root).toHaveAttribute('data-theme', 'dark')
    await user.click(screen.getByRole('tab', { name: 'Editor persistente' }))
    expect(screen.getByTestId('editor-instance')).toBe(editorNode)
    expect(screen.getByTestId('database-instance')).toBe(databaseNode)
  })
})
