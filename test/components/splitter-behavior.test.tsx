import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Splitter, type SplitterPanelData, type SplitterResizeDetails, type SplitterResizeEndDetails } from '@/components/ui'

const panels: SplitterPanelData[] = [
  { id: 'navigator', minSize: '100px', maxSize: '600px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'workbench', minSize: '100px' },
]

const normalizedPanels: SplitterPanelData[] = [
  { id: 'navigator', minSize: 20, maxSize: 60 },
  { id: 'workbench', minSize: 25, maxSize: 80 },
]

const collapsiblePanels: SplitterPanelData[] = [
  { id: 'navigator', minSize: '100px', maxSize: '600px', collapsible: true, collapsedSize: '0px', resizeBehavior: 'preserve-pixel-size' },
  { id: 'workbench', minSize: '100px' },
]

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length() { return this.#values.size }
  clear() { this.#values.clear() }
  getItem(key: string) { return this.#values.get(key) ?? null }
  key(index: number) { return [...this.#values.keys()][index] ?? null }
  removeItem(key: string) { this.#values.delete(key) }
  setItem(key: string, value: string) { this.#values.set(key, value) }
}

const durableStorage = new MemoryStorage()
const legacyStorage = new MemoryStorage()

type HarnessProps = {
  defaultFixedSize?: number
  fixedPanel?: 'start' | 'end'
  onResize?: (details: SplitterResizeDetails) => void
  onResizeEnd?: (details: SplitterResizeEndDetails) => void
  orientation: 'horizontal' | 'vertical'
  panelDefinitions?: SplitterPanelData[]
  storageKey: string
}

function SplitterHarness({
  defaultFixedSize = 240,
  fixedPanel = 'start',
  onResize,
  onResizeEnd,
  orientation,
  panelDefinitions = panels,
  storageKey,
}: HarnessProps) {
  return (
    <Splitter.Root
      aria-label={`Splitter ${orientation}`}
      defaultFixedSize={defaultFixedSize}
      fixedPanel={fixedPanel}
      keyboardResizeBy={5}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      orientation={orientation}
      panels={panelDefinitions}
      storageKey={storageKey}
      style={orientation === 'horizontal' ? { width: '800px' } : { height: '600px' }}
    >
      <Splitter.Panel id="navigator"><div>Navigatore</div></Splitter.Panel>
      <Splitter.ResizeTrigger aria-label={`Ridimensiona ${orientation}`} id="navigator:workbench">
        <Splitter.ResizeTriggerIndicator />
      </Splitter.ResizeTrigger>
      <Splitter.Panel id="workbench"><div>{panelDefinitions[0]?.collapsible && <Splitter.CollapseTrigger collapseLabel="Nascondi navigatore" expandLabel="Mostra navigatore" panelId="navigator" />}Workbench</div></Splitter.Panel>
    </Splitter.Root>
  )
}

function rectangle(width: number, height: number): DOMRect {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }
}

function mockSplitterGeometry(rootWidth: number, rootHeight: number, panelWidth: number, panelHeight: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getBoundingClientRect(this: HTMLElement) {
    if (this.dataset.scope === 'splitter' && this.dataset.part === 'root') return rectangle(rootWidth, rootHeight)
    if (this.dataset.scope === 'splitter' && this.dataset.part === 'panel' && this.dataset.index === '0') return rectangle(panelWidth, panelHeight)
    return rectangle(1, 1)
  })
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: durableStorage })
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: legacyStorage })
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('Splitter Ark/Park', () => {
  it.each([
    { orientation: 'horizontal' as const, storedSize: 312, rootWidth: 800, rootHeight: 400 },
    { orientation: 'vertical' as const, storedSize: 228, rootWidth: 700, rootHeight: 600 },
  ])('ripristina e resetta la misura persistita in $orientation', async ({ orientation, storedSize, rootWidth, rootHeight }) => {
    const storageKey = `test.splitter.${orientation}`
    window.localStorage.setItem(storageKey, String(storedSize))
    // Il DOM espone ancora la vecchia misura durante il callback sincrono di Ark:
    // il reset deve comunque lasciare persistito il default, non questa geometria stale.
    mockSplitterGeometry(rootWidth, rootHeight, storedSize, storedSize)

    const { container } = render(<SplitterHarness defaultFixedSize={240} orientation={orientation} storageKey={storageKey} />)

    const root = container.querySelector<HTMLElement>('[data-scope="splitter"][data-part="root"]')
    const fixedPanel = screen.getByText('Navigatore').parentElement
    const separator = screen.getByRole('separator', { name: `Ridimensiona ${orientation}` })
    expect(root).not.toBeNull()
    expect(root).toHaveAttribute('data-orientation', orientation)
    expect(separator).toHaveAttribute('aria-orientation', orientation)
    expect(fixedPanel?.getAttribute('style')).toContain(`${storedSize}px`)

    fireEvent.doubleClick(separator)
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('240'))
    const expectedPercentage = orientation === 'horizontal' ? 30 : 40
    await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', String(expectedPercentage)))
  })

  it.each([
    { orientation: 'horizontal' as const, key: 'ArrowRight', persistedSize: 333 },
    { orientation: 'vertical' as const, key: 'ArrowDown', persistedSize: 222 },
  ])('ridimensiona da tastiera in $orientation e persiste la misura del relativo asse', async ({ orientation, key, persistedSize }) => {
    const onResize = vi.fn<(details: SplitterResizeDetails) => void>()
    const onResizeEnd = vi.fn<(details: SplitterResizeEndDetails) => void>()
    const storageKey = `test.splitter.keyboard.${orientation}`
    mockSplitterGeometry(800, 600, 333, 222)
    const { container } = render(<SplitterHarness onResize={onResize} onResizeEnd={onResizeEnd} orientation={orientation} storageKey={storageKey} />)

    const root = container.querySelector<HTMLElement>('[data-scope="splitter"][data-part="root"]')
    const separator = screen.getByRole('separator', { name: `Ridimensiona ${orientation}` })
    expect(root).not.toBeNull()
    const initialValue = separator.getAttribute('aria-valuenow')
    separator.focus()
    fireEvent.keyDown(separator, { key })

    await waitFor(() => expect(onResize).toHaveBeenCalled())
    await waitFor(() => expect(onResizeEnd).toHaveBeenCalled())
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe(String(persistedSize)))
    await waitFor(() => expect(separator).not.toHaveAttribute('aria-valuenow', initialValue))
    expect(onResize.mock.lastCall?.[0].size).toHaveLength(2)
  })

  it('migra una misura valida da sessionStorage allo storage durevole', async () => {
    const storageKey = 'test.splitter.legacy-session'
    window.sessionStorage.setItem(storageKey, '318')
    mockSplitterGeometry(800, 600, 318, 318)

    render(<SplitterHarness orientation="horizontal" storageKey={storageKey} />)

    expect(screen.getByText('Navigatore').parentElement?.getAttribute('style')).toContain('318px')
    await waitFor(() => expect(window.localStorage.getItem(storageKey)).toBe('318'))
    expect(window.sessionStorage.getItem(storageKey)).toBeNull()
  })

  it('ripiega su sessionStorage quando localStorage rifiuta la scrittura', async () => {
    const storageKey = 'test.splitter.storage-fallback'
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage non disponibile', 'SecurityError')
    })
    mockSplitterGeometry(800, 600, 333, 222)

    render(<SplitterHarness orientation="horizontal" storageKey={storageKey} />)
    const separator = screen.getByRole('separator', { name: 'Ridimensiona horizontal' })
    separator.focus()
    fireEvent.keyDown(separator, { key: 'ArrowRight' })

    await waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBe('333'))
    expect(window.localStorage.getItem(storageKey)).toBeNull()
  })

  it('collassa, espande e ripristina lo stato persistito tramite il controllo accessibile', async () => {
    const storageKey = 'test.splitter.collapse'
    const firstRender = render(<SplitterHarness orientation="horizontal" panelDefinitions={collapsiblePanels} storageKey={storageKey} />)

    const collapse = screen.getByRole('button', { name: 'Nascondi navigatore' })
    expect(collapse).toHaveAttribute('aria-controls', 'navigator')
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mostra navigatore' })).toHaveAttribute('aria-expanded', 'false'))
    expect(window.localStorage.getItem(`${storageKey}:collapsed`)).toBe('true')

    firstRender.unmount()
    render(<SplitterHarness orientation="horizontal" panelDefinitions={collapsiblePanels} storageKey={storageKey} />)
    const expand = screen.getByRole('button', { name: 'Mostra navigatore' })
    fireEvent.click(expand)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Nascondi navigatore' })).toHaveAttribute('aria-expanded', 'true'))
    expect(window.localStorage.getItem(`${storageKey}:collapsed`)).toBe('false')
  })

  it.each([
    { orientation: 'horizontal' as const, decrease: 'ArrowLeft', increase: 'ArrowRight', rootWidth: 800, rootHeight: 400 },
    { orientation: 'vertical' as const, decrease: 'ArrowUp', increase: 'ArrowDown', rootWidth: 700, rootHeight: 600 },
  ])('limita il resize da frecce ai vincoli normalizzati in $orientation', async ({ orientation, decrease, increase, rootWidth, rootHeight }) => {
    mockSplitterGeometry(rootWidth, rootHeight, 240, 240)
    render(<SplitterHarness orientation={orientation} panelDefinitions={normalizedPanels} storageKey={`test.splitter.clamp.${orientation}`} />)

    const separator = screen.getByRole('separator', { name: `Ridimensiona ${orientation}` })
    const minimum = Number(separator.getAttribute('aria-valuemin'))
    const maximum = Number(separator.getAttribute('aria-valuemax'))
    expect(minimum).toBeGreaterThan(0)
    expect(maximum).toBeLessThan(100)
    separator.focus()

    for (let index = 0; index < 30; index += 1) {
      const before = Number(separator.getAttribute('aria-valuenow'))
      fireEvent.keyDown(separator, { key: decrease })
      if (before > minimum) await waitFor(() => expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThan(before))
    }
    await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', String(minimum)))
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(minimum)

    for (let index = 0; index < 30; index += 1) {
      const before = Number(separator.getAttribute('aria-valuenow'))
      fireEvent.keyDown(separator, { key: increase })
      if (before < maximum) await waitFor(() => expect(Number(separator.getAttribute('aria-valuenow'))).toBeGreaterThan(before))
    }
    await waitFor(() => expect(separator).toHaveAttribute('aria-valuenow', String(maximum)))
    expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(maximum)
  })
})
