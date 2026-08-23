import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog, Field, IconButton, SelectField, Splitter, Tabs, type SplitterPanelData } from '@/components/ui'

afterEach(() => vi.restoreAllMocks())

describe('contratti di accessibilità Ark/Park', () => {
  it('collega il nome del dialog al Title con id esplicito', async () => {
    render(
      <Dialog.Root defaultOpen ids={{ title: 'dialog-title-esplicito' }}>
        <Dialog.Portal>
          <Dialog.Positioner>
            <Dialog.Content>
              <Dialog.Title id="dialog-title-esplicito">Dettagli attività</Dialog.Title>
              <Dialog.CloseTrigger>Chiudi</Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Dialog.Portal>
      </Dialog.Root>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Dettagli attività' })
    expect(dialog).toHaveAttribute('aria-labelledby', 'dialog-title-esplicito')
    expect(document.getElementById('dialog-title-esplicito')).toHaveTextContent('Dettagli attività')
  })

  it('nomina un dialog Ark senza Title tramite aria-label sulla Root', async () => {
    render(
      <Dialog.Root aria-label="Comandi del workspace" defaultOpen modal={false}>
        <Dialog.Content asChild>
          <aside>Raccolta comandi</aside>
        </Dialog.Content>
      </Dialog.Root>,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Comandi del workspace' })
    expect(dialog).toHaveAttribute('aria-label', 'Comandi del workspace')
    expect(dialog).not.toHaveAttribute('aria-labelledby')
  })

  it('mantiene il Label Field collegato quando il controllo usa un id esplicito', () => {
    render(
      <Field.Root id="github-repository-name">
        <Field.Label>Crea repository GitHub</Field.Label>
        <Field.Input id="github-repository-name" />
      </Field.Root>,
    )

    const input = screen.getByRole('textbox', { name: 'Crea repository GitHub' })
    const label = screen.getByText('Crea repository GitHub')
    expect(input).toHaveAttribute('id', 'github-repository-name')
    expect(label).toHaveAttribute('for', 'github-repository-name')
  })

  it('crea un Label Ark nascosto e relazioni valide per SelectField con aria-label', () => {
    const { container } = render(
      <SelectField
        aria-label="Filtra attività per stato"
        id="status-filter"
        onValueChange={() => {}}
        options={[{ label: 'Tutte', value: 'all' }, { label: 'Aperte', value: 'open' }]}
        value="all"
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Filtra attività per stato' })
    const labelId = trigger.getAttribute('aria-labelledby')
    const label = document.getElementById(labelId ?? '')
    const hiddenSelect = container.querySelector('select[aria-hidden="true"]')

    expect(trigger).toHaveAttribute('id', 'status-filter')
    expect(labelId).toBeTruthy()
    expect(label).toHaveTextContent('Filtra attività per stato')
    expect(hiddenSelect).toBeInTheDocument()
    expect(label).toHaveAttribute('for', hiddenSelect?.id)
  })

  it('rende focalizzabile il trigger del tooltip lasciando disabilitato il pulsante', async () => {
    const user = userEvent.setup()
    render(<IconButton disabled tooltip="Azione non disponibile">X</IconButton>)

    const button = screen.getByRole('button', { name: 'Azione non disponibile' })
    const tooltipTrigger = screen.getByRole('group', { name: 'Azione non disponibile' })
    expect(button).toBeDisabled()
    expect(tooltipTrigger).toHaveAttribute('aria-disabled', 'true')
    expect(tooltipTrigger).toHaveAttribute('tabindex', '0')

    await user.tab()
    expect(tooltipTrigger).toHaveFocus()
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('Azione non disponibile'), { timeout: 1_500 })
  })

  it('mantiene stabile il nodo e trasferisce il focus al tooltip quando il pulsante diventa disabilitato', () => {
    const { rerender } = render(<IconButton tooltip="Aggiorna">X</IconButton>)
    const enabledButton = screen.getByRole('button', { name: 'Aggiorna' })
    enabledButton.focus()
    expect(enabledButton).toHaveFocus()

    rerender(<IconButton disabled tooltip="Aggiorna">X</IconButton>)

    const disabledButton = screen.getByRole('button', { name: 'Aggiorna' })
    const tooltipTrigger = screen.getByRole('group', { name: 'Aggiorna' })
    expect(disabledButton).toBe(enabledButton)
    expect(disabledButton).toBeDisabled()
    expect(tooltipTrigger).toHaveFocus()
  })

  it('mantiene distinti i contratti ARIA di Splitter e Tabs composti', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 500,
      height: 500,
      left: 0,
      right: 900,
      top: 0,
      width: 900,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    const panels: SplitterPanelData[] = [
      { id: 'navigator', minSize: '180px' },
      { id: 'document', minSize: '360px' },
    ]

    render(
      <Splitter.Root defaultFixedSize={260} panels={panels} storageKey="test.a11y.composition">
        <Splitter.Panel id="navigator">
          <Tabs.Root defaultValue="files">
            <Tabs.List aria-label="Navigatori"><Tabs.Trigger value="files">File</Tabs.Trigger><Tabs.Indicator /></Tabs.List>
            <Tabs.Content value="files">Elenco file</Tabs.Content>
          </Tabs.Root>
        </Splitter.Panel>
        <Splitter.ResizeTrigger aria-label="Ridimensiona navigatore" id="navigator:document"><Splitter.ResizeTriggerIndicator /></Splitter.ResizeTrigger>
        <Splitter.Panel id="document"><div>Documento</div></Splitter.Panel>
      </Splitter.Root>,
    )

    const separator = screen.getByRole('separator', { name: 'Ridimensiona navigatore' })
    const splitterTargets = separator.getAttribute('aria-controls')?.split(' ') ?? []
    expect(splitterTargets).toHaveLength(2)
    for (const id of splitterTargets) {
      expect(document.getElementById(id)).toHaveAttribute('data-scope', 'splitter')
      expect(document.getElementById(id)).toHaveAttribute('data-part', 'panel')
    }

    const tab = screen.getByRole('tab', { name: 'File' })
    const tabPanel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
    expect(tabPanel).toHaveAttribute('data-scope', 'tabs')
    expect(tabPanel).toHaveAttribute('data-part', 'content')
    expect(splitterTargets).not.toContain(tabPanel?.id)
  })
})
