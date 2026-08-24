export function rendererSmokeScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    let navigation
    while (performance.now() < deadline) {
      navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
      if (document.readyState === 'complete' && navigation?.isConnected) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!navigation?.isConnected) {
      const text = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 600) ?? ''
      throw new Error('Workbench non renderizzato: ' + text)
    }
    const bridge = window.vincodeLab
    if (!bridge?.workspace?.getActive || !bridge?.preferences?.get || !bridge?.benchmark?.shutdown) {
      throw new Error('Preload bridge incompleto nel bundle.')
    }
    const [activeWorkspace, preferences] = await Promise.all([
      bridge.workspace.getActive(),
      bridge.preferences.get(),
    ])
    return {
      activeWorkspace: activeWorkspace?.path ?? null,
      bodyTextLength: document.body?.innerText?.length ?? 0,
      documentTitle: document.title,
      navigationConnected: navigation.isConnected,
      preferenceDefinitions: Array.isArray(preferences?.schema) ? preferences.schema.length : -1,
      readyState: document.readyState,
    }
  })()`
}

export function verifyRedisSelectScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    const text = (element) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    const visible = (element) => {
      if (!(element instanceof HTMLElement) || element.hidden || element.getAttribute('aria-hidden') === 'true') return false
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0
    }
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Elemento Redis non disponibile: ' + label)
    }
    const zIndexOf = (element) => {
      let current = element
      while (current instanceof HTMLElement) {
        const raw = getComputedStyle(current).zIndex
        if (raw && raw !== 'auto') {
          const value = Number(raw)
          if (Number.isFinite(value)) return value
        }
        current = current.parentElement
      }
      return 0
    }
    const clickAtCenter = (element, label) => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      if (!(hit instanceof HTMLElement) || (hit !== element && !element.contains(hit) && !hit.contains(element))) {
        throw new Error('Il controllo Redis non riceve il click: ' + label)
      }
      hit.click()
    }

    const navigation = await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'navigazione applicazione')
    const redisTab = [...navigation.querySelectorAll('[role="tab"]')].find((element) => text(element) === 'Redis')
    if (!(redisTab instanceof HTMLElement)) throw new Error('Sezione Redis assente dalla navigazione.')
    redisTab.click()

    const workspace = await waitFor(() => {
      const element = document.querySelector('[aria-label="Workspace Redis"]')
      return visible(element) ? element : null
    }, 'workspace Redis')
    const connectionButton = await waitFor(() => [...workspace.querySelectorAll('button')]
      .find((element) => visible(element) && text(element) === 'Connessione'), 'pulsante Connessione Redis')
    connectionButton.click()

    const dialog = await waitFor(() => [...document.querySelectorAll('[role="dialog"]')]
      .find((element) => visible(element) && text(element).includes('Nuova connessione Redis')), 'dialog nuova connessione Redis')
    const trigger = [...dialog.querySelectorAll('[role="combobox"]')].find((element) => text(element).includes('Standalone'))
    if (!(trigger instanceof HTMLElement)) throw new Error('Select modalità Redis non inizializzato su Standalone.')
    const standaloneValue = trigger.querySelector('[data-scope="select"][data-part="value-text"]')
    if (!(standaloneValue instanceof HTMLElement) || text(standaloneValue) !== 'Standalone') {
      throw new Error('Valore Standalone non disponibile nel trigger Redis.')
    }
    clickAtCenter(standaloneValue, 'valore Standalone')
    await waitFor(() => trigger.getAttribute('aria-expanded') === 'true', 'apertura select modalità Redis')

    const listbox = await waitFor(() => [...document.querySelectorAll('[role="listbox"]')].find((element) => {
      const labels = [...element.querySelectorAll('[role="option"]')].map(text)
      return visible(element) && labels.includes('Standalone') && labels.includes('Sentinel')
    }), 'listbox modalità Redis')
    const options = [...listbox.querySelectorAll('[role="option"]')]
    if (!options.every(visible)) throw new Error('Le opzioni modalità Redis non sono tutte visibili.')
    const optionLabels = options.map(text)
    const dialogPositioner = dialog.closest('[data-scope="dialog"][data-part="positioner"]')
    const popupPositioner = listbox.closest('[data-scope="select"][data-part="positioner"]')
    const dialogZIndex = zIndexOf(dialogPositioner ?? dialog)
    const popupZIndex = zIndexOf(popupPositioner ?? listbox)
    if (popupZIndex <= dialogZIndex) {
      throw new Error('Il popup Redis non supera il dialog nello stacking: ' + popupZIndex + ' <= ' + dialogZIndex)
    }

    const sentinelOption = options.find((element) => text(element) === 'Sentinel')
    if (!(sentinelOption instanceof HTMLElement)) throw new Error('Opzione Sentinel assente dal select Redis.')
    clickAtCenter(sentinelOption, 'opzione Sentinel')
    await waitFor(() => text(trigger).includes('Sentinel') && trigger.getAttribute('aria-expanded') === 'false', 'selezione Sentinel')

    const visibleControlForLabel = (labelText) => {
      const label = [...dialog.querySelectorAll('label')].find((element) => text(element) === labelText)
      if (!(label instanceof HTMLLabelElement) || !visible(label)) return null
      const control = label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null)
      return visible(control) ? control : null
    }
    const hostSentinel = await waitFor(() => visibleControlForLabel('Host Sentinel'), 'campo Host Sentinel')
    const masterName = await waitFor(() => visibleControlForLabel('Nome master Sentinel'), 'campo Nome master Sentinel')

    const cancelButton = [...dialog.querySelectorAll('button')].find((element) => visible(element) && text(element) === 'Annulla')
    if (!(cancelButton instanceof HTMLElement)) throw new Error('Chiusura dialog Redis non disponibile.')
    cancelButton.click()
    await waitFor(() => !dialog.isConnected, 'chiusura dialog Redis')

    return {
      attempted: true,
      dialogClosed: true,
      dialogZIndex,
      initialValue: 'Standalone',
      listboxVisible: true,
      optionLabels,
      popupAboveDialog: true,
      popupZIndex,
      pointerHitTestPassed: true,
      selectedValue: 'Sentinel',
      sentinelFieldsVisible: Boolean(hostSentinel && masterName),
    }
  })()`
}

export function verifyCleanMachineScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    let notice
    while (performance.now() < deadline) {
      notice = [...document.querySelectorAll('[role="status"], [role="alert"]')]
        .find((element) => element.textContent?.includes('Pi Coding Agent non installato'))
      if (notice) break
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    if (!notice) throw new Error('Messaggio Pi non installato non visibile.')
    const bridge = window.vincodeLab
    if (!bridge?.runtime?.capabilities || !bridge?.workspace?.getActive) throw new Error('Bridge compatibilità incompleto.')
    const [capabilities, activeWorkspace] = await Promise.all([
      bridge.runtime.capabilities(),
      bridge.workspace.getActive(),
    ])
    const byId = new Map((capabilities?.items ?? []).map((item) => [item.id, item]))
    const databaseDrivers = ['database-sqlite', 'database-postgresql', 'database-mysql', 'database-sqlserver']
    const navigationText = document.querySelector('[aria-label="Sezioni applicazione"]')?.textContent ?? ''
    const bodyText = document.body?.innerText ?? ''
    return {
      activeWorkspace: activeWorkspace?.path ?? null,
      databaseDriversReady: databaseDrivers.every((id) => byId.get(id)?.state === 'ready'),
      redisClientReady: byId.get('redis-client')?.state === 'ready',
      navigationPreserved: ['Editor', 'Terminale', 'GitHub', 'Database', 'Redis'].every((label) => navigationText.includes(label)),
      nodeState: byId.get('node-system')?.state ?? null,
      npmOptional: byId.get('npm-system')?.kind === 'optional',
      npmState: byId.get('npm-system')?.state ?? null,
      piState: byId.get('pi-agent')?.state ?? null,
      sanitized: !/Something went wrong|Cannot find module|MODULE_NOT_FOUND|ERR_DLOPEN|stack trace/iu.test(bodyText),
      userMessage: notice.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }
  })()`
}
