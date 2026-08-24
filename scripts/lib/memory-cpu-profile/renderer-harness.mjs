export const HARNESS_NAME = '__vincodelabAcceleratedReliabilityProfile'

export function rendererHarnessSource() {
  return String.raw`(() => {
    if (window.${HARNESS_NAME}) return true
    const counts = { viewChanges: 0, commandPaletteCycles: 0, quickOpenCycles: 0, uiCycles: 0 }
    const viewLabels = ['Editor', 'Database']
    let viewIndex = 0
    const waitFor = async (predicate, label, timeoutMs = 15000) => {
      const deadline = performance.now() + timeoutMs
      while (performance.now() < deadline) {
        const value = predicate()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      throw new Error('Timeout profilo UI: ' + label)
    }
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const settle = async () => { await nextFrame(); await nextFrame() }
    const navigation = () => document.querySelector('[aria-label="Sezioni applicazione"]')
    const tabFor = (label) => [...(navigation()?.querySelectorAll('[role="tab"]') ?? [])]
      .find((item) => item.textContent?.trim() === label)
    const viewReady = (label) => {
      const selector = label === 'Editor' ? '[aria-label="Editor progetto"]' : '[aria-label="Database workspace"]'
      const element = document.querySelector(selector)
      return Boolean(element) && (label !== 'Database' || element.getAttribute('aria-busy') !== 'true')
    }
    const clickView = async (label, track) => {
      const tab = await waitFor(() => tabFor(label), 'tab ' + label)
      tab.click()
      await waitFor(() => tabFor(label)?.getAttribute('aria-selected') === 'true', 'selezione ' + label)
      await waitFor(() => viewReady(label), 'vista ' + label)
      await settle()
      if (track) counts.viewChanges += 1
    }
    const openDialog = () => document.querySelector('[data-scope="dialog"][data-part="content"][role="dialog"][data-state="open"]')
    const setInputValue = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (setter) setter.call(input, value)
      else input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const closeDialog = async () => {
      const dialog = openDialog()
      if (!dialog) return
      const target = document.activeElement ?? dialog
      const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperties(escape, {
        keyCode: { get: () => 27 },
        which: { get: () => 27 },
      })
      target.dispatchEvent(escape)
      // Lo stato React/Ark cambia in modo asincrono. Aspetta prima di usare il
      // fallback pointer, altrimenti un pointerdown senza pointerup lascia i
      // listener once di interact-outside attivi e falsifica il profilo heap.
      await settle()
      const backdrop = document.querySelector('[data-scope="dialog"][data-part="backdrop"]')
      if (backdrop && openDialog()) {
        backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      await waitFor(() => !openDialog(), 'chiusura dialog')
      await settle()
    }
    const overlayCycle = async (command, counter, track) => {
      const bridge = window.vincodeLab?.benchmark
      if (!bridge) throw new Error('Bridge benchmark non disponibile.')
      await bridge.dispatchCommand(command)
      const dialog = await waitFor(openDialog, command)
      const input = dialog.querySelector('input[role="combobox"], input')
      if (input) {
        input.focus()
        setInputValue(input, 'profilo-' + String(counts.uiCycles % 7))
        await nextFrame()
      }
      await closeDialog()
      if (track) counts[counter] += 1
    }
    const snapshot = () => ({ ...counts, activeView: viewLabels[viewIndex], dialogOpen: Boolean(openDialog()) })
    const warmup = async () => {
      await waitFor(navigation, 'workbench')
      await overlayCycle('workbench.commandPalette', 'commandPaletteCycles', false)
      await overlayCycle('workbench.quickOpen', 'quickOpenCycles', false)
      await new Promise((resolve) => setTimeout(resolve, 500))
      await clickView('Editor', false)
      await clickView('Database', false)
      await clickView('Editor', false)
      viewIndex = 0
      return snapshot()
    }
    const run = async (cycles, operationSet = 'combined') => {
      if (!['combined', 'control', 'views', 'command-palette', 'quick-open'].includes(operationSet)) throw new Error('Set operazioni UI non valido.')
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        if (operationSet === 'control') {
          // Otto frame approssimano il tempo dei tre percorsi UI combinati senza
          // creare dialog, cambiare vista o avviare IPC. Restano invece identici
          // Runtime.evaluate, checkpoint CDP e GC del processo di misura.
          await settle()
          await settle()
          await settle()
          await settle()
        }
        if (operationSet === 'combined' || operationSet === 'views') {
          viewIndex = viewIndex === 0 ? 1 : 0
          await clickView(viewLabels[viewIndex], true)
        }
        if (operationSet === 'combined' || operationSet === 'command-palette') {
          await overlayCycle('workbench.commandPalette', 'commandPaletteCycles', true)
        }
        if (operationSet === 'combined' || operationSet === 'quick-open') {
          await overlayCycle('workbench.quickOpen', 'quickOpenCycles', true)
        }
        counts.uiCycles += 1
        if (cycle % 5 === 4) await settle()
      }
      return snapshot()
    }
    const cleanup = async () => {
      await closeDialog()
      await clickView('Editor', false)
      viewIndex = 0
      await settle()
      await settle()
      return snapshot()
    }
    const reset = () => {
      counts.viewChanges = 0
      counts.commandPaletteCycles = 0
      counts.quickOpenCycles = 0
      counts.uiCycles = 0
      return snapshot()
    }
    window.${HARNESS_NAME} = Object.freeze({ cleanup, reset, run, warmup })
    return true
  })()`
}
