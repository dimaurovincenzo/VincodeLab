import { FAULT_RECOVERY_FILE_ID } from './fixture.mjs'

export const PACKAGED_DOMAIN_FAULTS = Object.freeze([
  { fault: 'ai-crash', category: 'process', code: 'BENCHMARK_AI_CRASH', copy: 'La sessione AI si è interrotta.' },
  { fault: 'pty-failure', category: 'process', code: 'BENCHMARK_PTY_FAILURE', copy: 'Il terminale non è stato avviato.' },
  { fault: 'file-not-found', category: 'not-found', code: 'BENCHMARK_FILE_NOT_FOUND', copy: 'Il file di prova non è più disponibile.' },
  { fault: 'file-permission', category: 'permission', code: 'BENCHMARK_FILE_PERMISSION', copy: 'Il file di prova non è accessibile.' },
  { fault: 'git-failure', category: 'git', code: 'BENCHMARK_GIT_FAILURE', copy: 'Git non ha aggiornato il repository di prova.' },
  { fault: 'github-network', category: 'network', code: 'BENCHMARK_GITHUB_NETWORK', copy: 'GitHub non è raggiungibile.' },
  { fault: 'database-connection', category: 'network', code: 'BENCHMARK_DATABASE_CONNECTION', copy: 'Impossibile raggiungere il database di prova.' },
  { fault: 'database-query', category: 'database', code: 'BENCHMARK_DATABASE_QUERY', copy: 'La query di prova non è stata completata.' },
  { fault: 'sftp-failure', category: 'remote', code: 'BENCHMARK_SFTP_FAILURE', copy: 'Il server remoto di prova non è raggiungibile.' },
])

export function exerciseIpcRejectionScenario() {
  return String.raw`(async () => {
    const bridge = window.vincodeLab
    if (!bridge?.benchmark?.injectFault || !bridge?.benchmark?.probe) throw new Error('Bridge fault injection non disponibile.')
    let message = ''
    try {
      await bridge.benchmark.injectFault('ipc-rejection')
    } catch (error) {
      message = error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : error instanceof Error ? error.message : String(error)
    }
    const correlationId = message.match(/\[(ERR-[A-F0-9]{6})\]/)?.[1]
    if (!correlationId || !message.includes('[BENCHMARK_IPC_REJECTION]')) {
      throw new Error('La rejection IPC non contiene classificazione e correlation ID pubblici.')
    }
    if (/benchmark-secret|\/Users\/benchmark|query\.sql|token=/iu.test(message)) {
      throw new Error('La rejection IPC espone dettagli tecnici della fault injection.')
    }
    const [probe, activeWorkspace] = await Promise.all([
      bridge.benchmark.probe(),
      bridge.workspace.getActive(),
    ])
    if (!probe?.ok || !activeWorkspace?.path) throw new Error('La chiamata successiva alla rejection IPC non è riuscita.')
    return {
      code: 'BENCHMARK_IPC_REJECTION',
      correlationId,
      nextCallSucceeded: true,
      sanitized: true,
    }
  })()`
}

export function exerciseDomainFailureScenarios() {
  const scenarios = JSON.stringify(PACKAGED_DOMAIN_FAULTS)
  return `(async () => {
    const bridge = window.vincodeLab?.benchmark
    if (!bridge?.injectFault || !bridge?.probe) throw new Error('Bridge fault injection non disponibile.')
    const scenarios = ${scenarios}
    const incidents = []
    for (const scenario of scenarios) {
      let message = ''
      try {
        await bridge.injectFault(scenario.fault)
      } catch (error) {
        message = error && typeof error === 'object' && typeof error.message === 'string'
          ? error.message
          : error instanceof Error ? error.message : String(error)
      }
      const correlationId = message.match(/\\[(ERR-[A-F0-9]{6})\\]/)?.[1]
      if (!correlationId || !message.includes('[' + scenario.code + ']') || !message.includes(scenario.copy)) {
        throw new Error('Failure controllato senza messaggio pubblico completo: ' + scenario.fault)
      }
      if (/benchmark-secret|access_token|\\/tmp\\/vincodelab-private/iu.test(message)) {
        throw new Error('Failure controllato con dettaglio tecnico esposto: ' + scenario.fault)
      }
      const probe = await bridge.probe()
      if (!probe?.ok) throw new Error('Recovery non confermata dopo il failure: ' + scenario.fault)
      incidents.push({
        category: scenario.category,
        code: scenario.code,
        correlationId,
        fault: scenario.fault,
        messageActionable: true,
        nextCallSucceeded: true,
        sanitized: true,
      })
    }
    return { incidents, nextCallsSucceeded: true }
  })()`
}

export function armPersistenceCorruptionScenario() {
  return String.raw`(async () => {
    const bridge = window.vincodeLab?.benchmark
    if (!bridge?.injectFault || !bridge?.probe) throw new Error('Bridge fault injection non disponibile.')
    const result = await bridge.injectFault('persistence-corrupt')
    if (!result?.armed || result.fault !== 'persistence-corrupt') throw new Error('Corruzione persistenza non armata.')
    return { armed: true }
  })()`
}

export function verifyPersistenceRecoveryScenario() {
  return String.raw`(async () => {
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica persistenza corrotta: ' + label)
    }
    const bridge = window.vincodeLab
    if (!bridge?.benchmark?.probe || !bridge?.workspaceSession?.get) throw new Error('Bridge recovery persistenza non disponibile.')
    const notice = await waitFor(() => [...document.querySelectorAll('[role="status"], [role="alert"]')]
      .find((element) => element.textContent?.includes('Layout del workspace ripristinato')
        && /Riferimento ERR-[A-F0-9]{6}/u.test(element.textContent ?? '')), 'messaggio recovery')
    const noticeText = notice.textContent ?? ''
    const correlationId = noticeText.match(/Riferimento (ERR-[A-F0-9]{6})/u)?.[1]
    if (!correlationId) throw new Error('Correlation ID recovery persistenza assente.')
    if (/benchmark-secret|\/Users\/benchmark|query\.sql|token=/iu.test(document.body?.innerText ?? '')) {
      throw new Error('Il recovery persistenza espone dettagli tecnici della fault injection.')
    }
    const recovery = [...notice.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Continua')
    if (!recovery) throw new Error('Azione recovery persistenza assente.')
    recovery.click()
    await waitFor(() => !notice.isConnected, 'chiusura messaggio recovery')
    const [nextSnapshot, probe, activeWorkspace] = await Promise.all([
      bridge.workspaceSession.get(),
      bridge.benchmark.probe(),
      bridge.workspace.getActive(),
    ])
    if (nextSnapshot?.recovery || !probe?.ok || !activeWorkspace?.path) {
      throw new Error('La chiamata successiva al recovery persistenza non è riuscita.')
    }
    const savedSnapshot = await bridge.workspaceSession.save({ version: nextSnapshot.version, state: nextSnapshot.state })
    if (!Number.isInteger(savedSnapshot?.updatedAt) || savedSnapshot.updatedAt < 1) {
      throw new Error('La persistenza non ha accettato un nuovo salvataggio dopo il recovery.')
    }
    return {
      correlationId,
      nextCallSucceeded: true,
      noticeDismissed: true,
      noticeVisible: true,
      persistenceWriteSucceeded: true,
      sanitized: true,
    }
  })()`
}

export function prepareFaultRecoveryScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedFileId = JSON.stringify(fileId)
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const fileId = ${serializedFileId}
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout preparazione fault recovery: ' + label)
    }
    const editorNavigation = await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni applicazione"] [role="tab"]')]
      .find((element) => element.textContent?.trim() === 'Editor'), 'navigazione Editor')
    editorNavigation.click()
    const projectEditor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    const fileEntry = await waitFor(() => [...projectEditor.querySelectorAll('[data-workspace-context-id]')]
      .find((element) => element.getAttribute('data-workspace-context-id') === fileId), 'file README')
    fileEntry.click()
    await waitFor(() => [...projectEditor.querySelectorAll('[aria-label="File aperti"] [role="tab"]')]
      .find((element) => element.textContent?.includes(fileId)), 'tab README')
    const sourceToggle = await waitFor(() => [...projectEditor.querySelectorAll('button')]
      .find((element) => ['Mostra sorgente', 'Mostra anteprima'].includes(element.getAttribute('aria-label') ?? '')), 'toggle sorgente')
    if (sourceToggle.getAttribute('aria-label') === 'Mostra sorgente') sourceToggle.click()
    const content = await waitFor(() => projectEditor.querySelector('.cm-content[contenteditable="true"]'), 'CodeMirror editabile')
    content.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(content)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
    globalThis.__vincodelabFaultRecoveryToken = marker
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    return {
      baseline: content.textContent ?? '',
      editorFocused: document.activeElement === content,
      fileId,
      sourceMode: Boolean(projectEditor.querySelector('[aria-label="Mostra anteprima"]')),
    }
  })()`
}

export function visibleCodeMirrorTextMarker(marker) {
  if (typeof marker !== 'string') throw new TypeError('Marker fault recovery non valido.')
  return marker.replace(/^\r?\n/u, '')
}

export function confirmFaultRecoveryDraftScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 10000
    let lastObservation = { draftCount: -1, draftContainsMarker: false, markerVisible: false, matchingIdentity: false, workspaceAvailable: false }
    while (performance.now() < deadline) {
      const editor = document.querySelector('[aria-label="Editor progetto"] .cm-content[contenteditable="true"]')
      const [activeWorkspace, drafts] = await Promise.all([
        window.vincodeLab?.workspace?.getActive?.(),
        window.vincodeLab?.volatileDrafts?.list?.(),
      ])
      const matchingIdentity = Array.isArray(drafts) ? drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource) : null
      const mainDraft = Array.isArray(drafts) ? drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker)) : null
      lastObservation = {
        draftCount: Array.isArray(drafts) ? drafts.length : -1,
        draftContainsMarker: Boolean(matchingIdentity?.content?.includes(marker)),
        markerVisible: Boolean(editor?.textContent?.includes(visibleMarker)),
        matchingIdentity: Boolean(matchingIdentity),
        workspaceAvailable: Boolean(activeWorkspace?.path),
      }
      if (editor?.textContent?.includes(visibleMarker) && mainDraft) {
        return { fileId, mainRegistryMirrored: true, markerVisible: true }
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('La bozza non è stata specchiata nel registro main prima del crash: ' + JSON.stringify(lastObservation))
  })()`
}

export function exerciseReactViewCrashScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 15000
    let lastObservation = null
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica crash React locale: ' + label
        + (lastObservation ? '; stato: ' + JSON.stringify(lastObservation) : ''))
    }
    window.dispatchEvent(new CustomEvent('vincodelab:benchmark-view-fault', { detail: { viewName: 'Editor' } }))
    const notice = await waitFor(() => [...document.querySelectorAll('[role="alert"], [role="status"]')]
      .find((element) => element.textContent?.includes('Editor non è disponibile')
        && /Riferimento ERR-[A-F0-9]{6}/u.test(element.textContent ?? '')), 'fallback Editor')
    const correlationId = (notice.textContent ?? '').match(/Riferimento (ERR-[A-F0-9]{6})/u)?.[1]
    if (!correlationId) throw new Error('Correlation ID crash React locale assente.')
    if (/benchmark-react-secret|access_token|\/tmp\/vincodelab-private/iu.test(document.body?.innerText ?? '')) {
      throw new Error('Il crash React locale espone dettagli tecnici riservati.')
    }
    const navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
    if (!navigation?.isConnected) throw new Error('La shell non è rimasta disponibile dopo il crash React locale.')
    const focusConfined = notice === document.activeElement || notice.contains(document.activeElement)
    const retry = [...notice.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Riprova')
    if (!retry) throw new Error('Recovery locale della vista assente.')
    retry.click()
    await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor rimontato')
    const restored = await waitFor(async () => {
      // Il refresh dello snapshot parent e il reset del boundary possono
      // produrre due commit consecutivi: rileggiamo sempre la vista connessa.
      const projectEditor = document.querySelector('[aria-label="Editor progetto"]')
      const codeMirrorContent = projectEditor?.querySelector('.cm-content')
      const editor = projectEditor?.querySelector('.cm-content[contenteditable="true"]')
      const sourceToggle = [...(projectEditor?.querySelectorAll('button') ?? [])]
        .find((button) => ['Mostra sorgente', 'Mostra anteprima'].includes(button.getAttribute('aria-label') ?? ''))
      const [activeWorkspace, drafts, session] = await Promise.all([
        window.vincodeLab?.workspace?.getActive?.(),
        window.vincodeLab?.volatileDrafts?.list?.(),
        window.vincodeLab?.workspaceSession?.get?.(),
      ])
      const matchingDraft = Array.isArray(drafts) && drafts.some((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker))
      const openFiles = session?.state?.editor?.openFiles
      lastObservation = {
        activeFileMatches: session?.state?.editor?.activeFile?.id === fileId,
        codeMirrorFound: Boolean(codeMirrorContent),
        contentEditable: codeMirrorContent?.getAttribute('contenteditable') ?? null,
        editorFound: Boolean(editor),
        projectEditorConnected: Boolean(projectEditor?.isConnected),
        mainDraftCount: Array.isArray(drafts) ? drafts.length : -1,
        markerVisible: Boolean(editor?.textContent?.includes(visibleMarker)),
        matchingDraft: Boolean(matchingDraft),
        openFileCount: Array.isArray(openFiles) ? openFiles.length : -1,
        openFileMatches: Array.isArray(openFiles) && openFiles.some((file) => file?.id === fileId),
        sourceMode: sourceToggle?.getAttribute('aria-label') === 'Mostra anteprima',
      }
      return editor?.textContent?.includes(visibleMarker) ? editor : null
    }, 'bozza Editor recuperata')
    const probe = await window.vincodeLab?.benchmark?.probe?.()
    if (!probe?.ok || !restored) throw new Error('La chiamata successiva al crash React locale non è riuscita.')
    return {
      correlationId,
      fileId,
      focusConfined,
      markerRecovered: true,
      nextCallSucceeded: true,
      shellPreserved: true,
    }
  })()`
}

export function verifyFaultRecoveryScenario(marker, fileId = FAULT_RECOVERY_FILE_ID) {
  const serializedMarker = JSON.stringify(marker)
  const serializedVisibleMarker = JSON.stringify(visibleCodeMirrorTextMarker(marker))
  const serializedFileId = JSON.stringify(fileId)
  const serializedResource = JSON.stringify(JSON.stringify(['workspace', fileId]))
  return String.raw`(async () => {
    const marker = ${serializedMarker}
    const visibleMarker = ${serializedVisibleMarker}
    const fileId = ${serializedFileId}
    const resource = ${serializedResource}
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error('Timeout verifica fault recovery: ' + label)
    }
    if (globalThis.__vincodelabFaultRecoveryToken === marker) {
      throw new Error('Il contesto renderer non è stato sostituito dopo Page.crash.')
    }
    const editorNavigation = await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni applicazione"] [role="tab"]')]
      .find((element) => element.textContent?.trim() === 'Editor'), 'navigazione Editor')
    editorNavigation.click()
    const projectEditor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    const fileEntry = await waitFor(() => [...projectEditor.querySelectorAll('[data-workspace-context-id]')]
      .find((element) => element.getAttribute('data-workspace-context-id') === fileId), 'file README')
    fileEntry.click()
    await waitFor(() => [...projectEditor.querySelectorAll('[aria-label="File aperti"] [role="tab"]')]
      .find((element) => element.textContent?.includes(fileId)), 'tab README')
    const sourceToggle = await waitFor(() => [...projectEditor.querySelectorAll('button')]
      .find((element) => ['Mostra sorgente', 'Mostra anteprima'].includes(element.getAttribute('aria-label') ?? '')), 'toggle sorgente')
    if (sourceToggle.getAttribute('aria-label') === 'Mostra sorgente') sourceToggle.click()
    const restored = await waitFor(async () => {
      const editor = projectEditor.querySelector('.cm-content[contenteditable="true"]')
      if (!editor?.textContent?.includes(visibleMarker)) return null
      const activeWorkspace = await window.vincodeLab.workspace.getActive()
      const drafts = await window.vincodeLab.volatileDrafts.list()
      const mainDraft = drafts.find((draft) => draft.scope === 'project-editor'
        && draft.workspace === activeWorkspace?.path
        && draft.resource === resource
        && draft.content.includes(marker))
      return mainDraft ? { activeWorkspace: activeWorkspace?.path ?? null, mainDraft } : null
    }, 'marker recuperato')
    const probe = await window.vincodeLab?.benchmark?.probe?.()
    if (!probe?.ok) throw new Error('La chiamata successiva al crash renderer non è riuscita.')
    return {
      activeWorkspace: restored.activeWorkspace,
      fileId,
      mainRegistryRecovered: true,
      markerRecovered: true,
      nextCallSucceeded: true,
      rendererContextReplaced: true,
    }
  })()`
}
