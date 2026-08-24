export const SCREENSHOT_MANIFEST = Object.freeze([
  { id: 'ai', fileName: 'ai-workbench.png', title: 'Terminale AI' },
  { id: 'editor', fileName: 'editor-workspace.png', title: 'Editor' },
  { id: 'terminal', fileName: 'terminal-workspace.png', title: 'Terminale' },
  { id: 'git', fileName: 'git-workspace.png', title: 'Git' },
  { id: 'database', fileName: 'database-workspace.png', title: 'Database' },
  { id: 'settings', fileName: 'settings.png', title: 'Impostazioni' },
])

export function rendererBootstrapExpression(databasePath, workspacePath) {
  return `(async () => {
    const deadline = performance.now() + 20000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout preparazione screenshot: ' + label)
    }
    await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'shell applicazione')
    const bridge = window.vincodeLab
    const active = await bridge.workspace.getActive()
    if (active?.path !== ${JSON.stringify(workspacePath)}) throw new Error('Workspace demo non attiva.')
    const captureWindow = await bridge.benchmark?.captureWindowBounds?.()
    if (!captureWindow) throw new Error('Bridge bounds della cattura non disponibile.')
    const connections = await bridge.database.listConnections()
    if (!connections.some((connection) => connection.sqlitePath === ${JSON.stringify(databasePath)})) {
      await bridge.database.createConnection({
        driver: 'sqlite',
        name: 'Orbit Analytics',
        sqlitePath: ${JSON.stringify(databasePath)},
      })
    }
    let captureStyle = document.querySelector('#vincodelab-capture-style')
    if (!captureStyle) {
      captureStyle = document.createElement('style')
      captureStyle.id = 'vincodelab-capture-style'
      captureStyle.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}'
      document.head.append(captureStyle)
    }
    globalThis.__vincodelabCaptureErrors = []
    window.addEventListener('error', (event) => {
      const selectDiagnostics = [...document.querySelectorAll('select')].map((element) => ({
        id: element.id,
        optionCount: element.options?.length,
        optionsIterator: typeof element.options?.[Symbol.iterator],
        optionsType: Object.prototype.toString.call(element.options),
        outerHTML: element.outerHTML.slice(0, 1000),
      }))
      const duplicateIds = [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index)
      globalThis.__vincodelabCaptureErrors.push({
        duplicateIds: [...new Set(duplicateIds)],
        message: event.message || String(event.error),
        selectDiagnostics,
        stack: event.error?.stack || '',
        type: 'error',
      })
    }, { capture: true })
    window.addEventListener('unhandledrejection', (event) => {
      globalThis.__vincodelabCaptureErrors.push({
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack || '',
        type: 'unhandledrejection',
      })
    }, { capture: true })
    return { captureWindow, title: document.title, workspace: active.path }
  })()`
}

function navigationExpression(label, preparation = '') {
  return `(async () => {
    const deadline = performance.now() + 20000
    const waitFor = async (read, name) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout vista screenshot: ' + name)
    }
    const navigation = await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'navigazione')
    const trigger = [...navigation.querySelectorAll('[role="tab"]')].find((element) => element.textContent?.trim() === ${JSON.stringify(label)})
    if (!trigger) throw new Error('Sezione non trovata: ' + ${JSON.stringify(label)})
    trigger.click()
    ${preparation}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  })()`
}

export function screenshotPreparationExpression(id) {
  if (id === 'ai') return navigationExpression('AI', `
    const host = await waitFor(() => document.querySelector('[data-xterm-host="ai"]'), 'terminale AI')
    await waitFor(() => host.querySelector('.xterm-rows')?.textContent?.includes('SESSIONE DEMO OFFLINE'), 'output AI demo')
  `)
  if (id === 'editor') return navigationExpression('Editor', `
    const editor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    let file = editor.querySelector('[data-workspace-context-id="src/dashboard.ts"]')
    if (!file) {
      const sourceDirectory = await waitFor(() => editor.querySelector('[data-workspace-context-id="src"]'), 'cartella src')
      const expandSource = sourceDirectory.querySelector('[aria-label="src: espandi o comprimi"]')
        ?? editor.querySelector('[aria-label="src: espandi o comprimi"]')
      if (!expandSource) throw new Error('Controllo espansione src non trovato.')
      expandSource.click()
      file = await waitFor(() => editor.querySelector('[data-workspace-context-id="src/dashboard.ts"]'), 'file dashboard.ts; elementi: '
        + [...editor.querySelectorAll('[data-workspace-context-id]')].map((element) => element.getAttribute('data-workspace-context-id')).join(', '))
    }
    file.click()
    await waitFor(() => editor.querySelector('.cm-content')?.textContent?.includes('ServiceMetric'), 'contenuto dashboard.ts')
  `)
  if (id === 'terminal') return navigationExpression('Terminale', `
    const workspace = await waitFor(() => document.querySelector('[aria-label="Terminale e file remoti"]'), 'workspace Terminale')
    await waitFor(() => workspace.querySelector('.xterm-rows')?.textContent?.includes('vincodelab-demo'), 'prompt terminale demo')
    const snapshot = await waitFor(async () => {
      const value = await window.vincodeLab.shellSessions.list()
      return value?.sessions?.length ? value : null
    }, 'sessione shell')
    const session = snapshot.sessions.find((entry) => entry.sessionId === snapshot.activeSessionId) ?? snapshot.sessions[0]
    window.vincodeLab.shellSessions.write(session.sessionId, 'npm run check\\r')
    await waitFor(() => workspace.querySelector('.xterm-rows')?.textContent?.includes('TypeScript check passed'), 'output terminale demo')
  `)
  if (id === 'git') return navigationExpression('GitHub', `
    const changes = await waitFor(() => document.querySelector('[aria-label="Preparazione commit"]'), 'modifiche Git')
    const file = await waitFor(() => [...changes.querySelectorAll('button')].find((element) => element.textContent?.includes('src/dashboard.ts')), 'diff dashboard.ts')
    file.click()
    await waitFor(() => document.querySelector('pre')?.textContent?.includes('dashboardFilters'), 'contenuto diff')
  `)
  if (id === 'database') return navigationExpression('Database', `
    const workspace = await waitFor(() => document.querySelector('[aria-label="Database workspace"]'), 'workspace Database')
    await waitFor(() => workspace.getAttribute('aria-busy') === 'false' && workspace.querySelector('[aria-label="Editor SQL"] .cm-content'), 'editor SQLite')
    const connect = await waitFor(() => [...workspace.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === 'Connetti' && !element.disabled), 'comando Connetti Database')
    connect.click()
    await waitFor(() => [...workspace.querySelectorAll('button')]
      .some((element) => element.textContent?.trim() === 'Disconnetti' && !element.disabled)
      && [...workspace.querySelectorAll('button')]
        .some((element) => element.textContent?.trim().includes('Esegui') && !element.disabled), 'connessione SQLite pronta')
    workspace.querySelector('[aria-label="Editor SQL"] .cm-content').focus()
  `)
  if (id === 'settings') return navigationExpression('Impostazioni', `
    await waitFor(() => document.querySelector('[aria-label="Impostazioni"]'), 'pagina Impostazioni')
    await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni Impostazioni"] [role="tab"]')].some((element) => element.textContent?.trim() === 'Generali'), 'impostazioni generali')
  `)
  throw new Error(`Vista screenshot non riconosciuta: ${id}`)
}

export async function prepareDatabaseResults(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 })
  await cdp.send('Input.insertText', {
    text: "SELECT name AS servizio, environment AS ambiente, availability AS disponibilita, latency_ms AS latenza_ms, status\nFROM services\nORDER BY availability DESC;",
  })
  await cdp.evaluate(`(async () => {
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout risultati Database: ' + label)
    }
    const workspace = document.querySelector('[aria-label="Database workspace"]')
    const execute = await waitFor(() => [...workspace.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('Esegui') && !element.disabled), 'comando Esegui Database; pulsanti: '
        + [...workspace.querySelectorAll('button')].map((element) => (element.textContent?.trim() || element.getAttribute('aria-label') || '?') + ':' + element.disabled).join(', '))
    execute.click()
    await waitFor(() => workspace.querySelector('table')?.textContent?.includes('API Gateway'), 'righe SQLite')
    return true
  })()`)
}
