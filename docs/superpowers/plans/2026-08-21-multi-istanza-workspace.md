# Multi-istanza workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consentire al massimo due processi VincodeLab, ciascuno con un workspace diverso, tramite un selettore progetto centrato e un cambio workspace protetto dalle modifiche non salvate.

**Architecture:** L'attuale modello a workspace singolo resta invariato dentro ogni processo. Un registro SQLite atomico coordina limite, heartbeat e deduplicazione tra processi; il main process valida e avvia la seconda istanza senza shell. Il renderer usa un controllo centrale e un guard esplicito dell'Editor prima di sostituire il workspace corrente.

**Tech Stack:** Electron 43, Node.js, better-sqlite3, React 19, TypeScript, CSS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-21-multi-istanza-workspace-design.md`

## Global Constraints

- Massimo due istanze vive.
- Un solo workspace per istanza e nessun workspace duplicato.
- Percorsi assoluti risolti e validati esclusivamente nel main process.
- Nessuna shell per avviare il secondo processo.
- Pi, shell, SSH e database restano isolati per processo.
- `Apri qui` non cambia workspace finché il guard Editor non ha concluso.
- Nessuna release pubblicata durante questa implementazione.
- Il bundle resta solo monitorato; nessuna ottimizzazione senza problema misurabile.

---

## File map

- `electron/instance-registry.cjs`: schema, normalizzazione, registrazione atomica, heartbeat e cleanup.
- `electron/instance-launcher.cjs`: parsing argomenti e costruzione sicura del processo figlio.
- `electron/main.cjs`: ciclo di vita dell'istanza, IPC e integrazione con `openWorkspace`.
- `electron/preload.cjs`: superficie workspace confinata per stato e nuova istanza.
- `src/lib/workspace-change-guard.ts`: contratto renderer per file non salvati.
- `src/components/project-editor.tsx`: implementazione del guard e salvataggio di tutti i tab modificati.
- `src/components/workspace-switcher.tsx`: selettore progetto centrato.
- `src/App.tsx`: orchestrazione cambio workspace e dialogo a tre azioni.
- `src/styles/views/home.css`: layout della testata e pannello responsive.
- `src/vincode-lab.d.ts`: contratti IPC condivisi dal renderer.
- `test/instance-registry.test.cjs`: concorrenza, deduplicazione e cleanup.
- `test/instance-launcher.test.cjs`: argomenti sviluppo/pacchetto senza shell.
- `test/workspace-multi-instance.test.cjs`: integrazione main/preload e ciclo di vita.
- `test/editor-workspace-guard.test.cjs`: salvataggio completo e propagazione errori.
- `test/ui-design-system.test.cjs`: struttura e vincoli visuali della testata.

### Task 1: Registro atomico delle istanze

**Files:**
- Create: `electron/instance-registry.cjs`
- Modify: `electron/workspace-store.cjs`
- Test: `test/instance-registry.test.cjs`

**Interfaces:**
- Consumes: `getDatabase(): Database` da `electron/workspace-store.cjs`.
- Produces: `createInstanceRegistry({ database, now, isProcessAlive, maxInstances, staleAfterMs })` con metodi `register`, `heartbeat`, `setWorkspace`, `status`, `unregister`.

- [ ] **Step 1: Scrivere i test fallenti per limite, duplicati e stale cleanup**

```js
const registry = createInstanceRegistry({ database, now: () => clock, isProcessAlive: (pid) => alive.has(pid), maxInstances: 2, staleAfterMs: 15_000 })
assert.deepEqual(registry.register({ instanceId: 'one', pid: 101 }), { accepted: true, activeCount: 1 })
registry.setWorkspace('one', '/tmp/project-a')
assert.deepEqual(registry.register({ instanceId: 'two', pid: 102 }), { accepted: true, activeCount: 2 })
assert.deepEqual(registry.register({ instanceId: 'three', pid: 103 }), { accepted: false, reason: 'limit', activeCount: 2 })
assert.deepEqual(registry.status('/tmp/../tmp/project-a').reason, 'duplicate')
clock += 16_000
alive.delete(101)
assert.equal(registry.register({ instanceId: 'three', pid: 103 }).accepted, true)
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento previsto**

Run: `node --test test/instance-registry.test.cjs`

Expected: FAIL con `Cannot find module '../electron/instance-registry.cjs'`.

- [ ] **Step 3: Implementare schema e transazione atomica**

```js
function createInstanceRegistry({ database, now = Date.now, isProcessAlive, maxInstances = 2, staleAfterMs = 15_000 }) {
  database.pragma('busy_timeout = 5000')
  database.exec(`CREATE TABLE IF NOT EXISTS app_instances (
    instance_id TEXT PRIMARY KEY NOT NULL,
    pid INTEGER NOT NULL,
    workspace_path TEXT UNIQUE,
    started_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL
  )`)
  const registerTransaction = database.transaction(({ instanceId, pid }) => {
    pruneStaleRows(database, { now: now(), staleAfterMs, isProcessAlive })
    const activeCount = database.prepare('SELECT COUNT(*) AS count FROM app_instances').get().count
    if (activeCount >= maxInstances) return { accepted: false, reason: 'limit', activeCount }
    database.prepare('INSERT INTO app_instances VALUES (?, ?, NULL, ?, ?)').run(instanceId, pid, now(), now())
    return { accepted: true, activeCount: activeCount + 1 }
  })
  return { register: registerTransaction, heartbeat, setWorkspace, status, unregister }
}
```

Implementare `normalizeWorkspacePath()` con `path.resolve()` e `fs.realpathSync.native()` quando la cartella esiste. `setWorkspace()` deve ritornare `{ accepted: false, reason: 'duplicate' }` senza modificare la riga se il vincolo univoco rileva un'altra istanza.

- [ ] **Step 4: Eseguire test registro e store**

Run: `node --test test/instance-registry.test.cjs test/workspace-store.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit atomico**

```bash
git add electron/instance-registry.cjs electron/workspace-store.cjs test/instance-registry.test.cjs
git commit -m "feat: coordina due istanze applicative"
```

### Task 2: Avvio sicuro del secondo processo

**Files:**
- Create: `electron/instance-launcher.cjs`
- Test: `test/instance-launcher.test.cjs`

**Interfaces:**
- Consumes: `process.execPath`, `app.getAppPath()`, `app.isPackaged`.
- Produces: `readWorkspaceArgument(argv): string | null` e `launchWorkspaceInstance(options): { launched: true }`.

- [ ] **Step 1: Scrivere test fallenti per parsing e spawn**

```js
assert.equal(readWorkspaceArgument(['electron', '.', '--workspace', '/tmp/a']), '/tmp/a')
assert.equal(readWorkspaceArgument(['VincodeLab', '--workspace']), null)
launchWorkspaceInstance({ executable: '/Applications/VincodeLab', appPath: '/app', packaged: true, workspacePath: '/tmp/a b', spawn })
assert.deepEqual(spawn.mock.calls[0], ['/Applications/VincodeLab', ['--workspace', '/tmp/a b'], { detached: true, stdio: 'ignore' }])
assert.equal(spawn.mock.calls[0][2].shell, undefined)
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/instance-launcher.test.cjs`

Expected: FAIL perché il modulo non esiste.

- [ ] **Step 3: Implementare parser e launcher senza interpolazione**

```js
function launchWorkspaceInstance({ executable, appPath, packaged, workspacePath, spawn = childProcess.spawn }) {
  const args = packaged ? ['--workspace', workspacePath] : [appPath, '--workspace', workspacePath]
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  child.unref()
  return { launched: true }
}
```

Il parser accetta una sola occorrenza di `--workspace`; valori mancanti, non assoluti o oltre 4096 caratteri ritornano `null` e vengono poi rifiutati dal flusso principale.

- [ ] **Step 4: Eseguire il test**

Run: `node --test test/instance-launcher.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/instance-launcher.cjs test/instance-launcher.test.cjs
git commit -m "feat: avvia workspace in un processo isolato"
```

### Task 3: Integrare registro, argomenti e IPC nel main process

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Test: `test/workspace-multi-instance.test.cjs`
- Test: `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: `createInstanceRegistry`, `readWorkspaceArgument`, `launchWorkspaceInstance`.
- Produces: `workspace.instanceStatus(path?)`, `workspace.openInNewInstance(path)`, `WorkspaceInstanceStatus`, `WorkspaceLaunchResult`.

- [ ] **Step 1: Scrivere test fallenti per superficie IPC confinata**

```js
assert.match(preload, /instanceStatus: \(workspacePath\) => ipcRenderer\.invoke\('workspace:instanceStatus', workspacePath\)/)
assert.match(preload, /openInNewInstance: \(workspacePath\) => ipcRenderer\.invoke\('workspace:openInNewInstance', workspacePath\)/)
assert.match(main, /ipcMain\.handle\('workspace:openInNewInstance'[\s\S]*assertTrustedSender/)
assert.match(main, /before-quit[\s\S]*instanceRegistry\.unregister/)
assert.doesNotMatch(preload, /execPath|spawn|child_process/)
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/workspace-multi-instance.test.cjs test/preload-surface.test.cjs`

Expected: FAIL per API e handler mancanti.

- [ ] **Step 3: Registrare l'istanza prima di creare la finestra**

```js
const instanceId = crypto.randomUUID()
const instanceRegistry = createInstanceRegistry({ database: getDatabase(), isProcessAlive })
const admission = instanceRegistry.register({ instanceId, pid: process.pid })
if (!admission.accepted) {
  dialog.showErrorBox('VincodeLab è già aperto', 'Puoi usare al massimo due finestre contemporaneamente.')
  app.quit()
  return
}
```

Avviare heartbeat ogni 5 secondi, usare `unref()` sul timer e cancellarlo in `before-quit`. Prima di `createWindow()`, leggere `--workspace`; se valido chiamare `openWorkspace()` e associare il percorso al registro. Se duplicato, mostrare l'errore nativo e terminare.

- [ ] **Step 4: Aggiungere IPC con errori strutturati**

```ts
interface WorkspaceInstanceStatus {
  activeCount: number
  maxInstances: 2
  canOpenNew: boolean
  workspaceOpenElsewhere: boolean
  reason?: 'limit' | 'duplicate'
}
interface WorkspaceLaunchResult { launched: boolean; reason?: 'limit' | 'duplicate' | 'invalid-path'; message?: string }
```

`workspace:openInNewInstance` deve verificare mittente, directory e stato del registro subito prima dello spawn. Non deve mutare `activeWorkspacePath`.

- [ ] **Step 5: Eseguire i test IPC e lifecycle**

Run: `node --test test/workspace-multi-instance.test.cjs test/preload-surface.test.cjs test/workspace-store.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/workspace-multi-instance.test.cjs test/preload-surface.test.cjs
git commit -m "feat: espone apertura workspace in nuova istanza"
```

### Task 4: Guard dell'Editor per il cambio workspace

**Files:**
- Create: `src/lib/workspace-change-guard.ts`
- Modify: `src/components/project-editor.tsx`
- Modify: `src/App.tsx`
- Test: `test/editor-workspace-guard.test.cjs`

**Interfaces:**
- Produces: `WorkspaceChangeGuard` con `hasUnsavedChanges(): boolean`, `saveAll(): Promise<void>`, `discardAll(): void`.
- Consumes: callback `onWorkspaceGuardChange(guard: WorkspaceChangeGuard | null)` passata a `ProjectEditor`.

- [ ] **Step 1: Scrivere test fallenti sul contratto e sul salvataggio completo**

```js
assert.match(editor, /export type WorkspaceChangeGuard/)
assert.match(editor, /tabsRef\.current\.filter\(\(tab\) => tab\.content !== tab\.savedContent\)/)
assert.match(editor, /await saveEditorTab\(tab\)/)
assert.match(app, /Salva e cambia/)
assert.match(app, /Scarta e cambia/)
assert.match(app, /Annulla/)
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/editor-workspace-guard.test.cjs`

Expected: FAIL per contratto e dialogo mancanti.

- [ ] **Step 3: Estrarre il salvataggio di un singolo tab e implementare `saveAll`**

```ts
const saveEditorTab = useCallback(async (tab: EditorTab) => {
  const remoteFile = tab.source === 'remote' && tab.remote
    ? await window.vincodeLab.remoteFiles.saveLocal(tab.remote.file.id, tab.content)
    : null
  if (!remoteFile) await window.vincodeLab.files.save(tab.id, tab.content)
  markTabSaved(tab, remoteFile)
}, [])

const saveAll = useCallback(async () => {
  const dirtyTabs = tabsRef.current.filter((tab) => tab.content !== tab.savedContent)
  for (const tab of dirtyTabs) await saveEditorTab(tab)
}, [saveEditorTab])
```

`saveEditorTab` deve propagare l'errore; il toast può descriverlo, ma non deve convertirlo in successo. `discardAll` riallinea `content` a `savedContent` prima del cambio.

- [ ] **Step 4: Orchestrare il dialogo a tre azioni in App**

Conservare la richiesta di apertura `{ path, mode }` finché l'utente decide. `Salva e cambia` attende `guard.saveAll()`; `Scarta e cambia` chiama `guard.discardAll()`; `Annulla` chiude il dialogo. Solo i primi due invocano l'apertura.

- [ ] **Step 5: Eseguire test guard ed Editor**

Run: `node --test test/editor-workspace-guard.test.cjs test/editor-ux.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workspace-change-guard.ts src/components/project-editor.tsx src/App.tsx test/editor-workspace-guard.test.cjs
git commit -m "feat: protegge i file durante il cambio workspace"
```

### Task 5: Selettore progetto e testata centrata

**Files:**
- Create: `src/components/workspace-switcher.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/views/home.css`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: recenti, workspace corrente, `WorkspaceInstanceStatus`, callback `onOpenHere`, `onOpenNew`, `onChooseDirectory`.
- Produces: `WorkspaceSwitcher` accessibile con pannello `role="dialog"` e stati disabilitati motivati.

- [ ] **Step 1: Aggiungere test visuali strutturali fallenti**

```js
assert.match(app, /<WorkspaceSwitcher/)
assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/)
assert.match(styles, /\.workspace-switcher-trigger[\s\S]*-webkit-app-region:\s*no-drag/)
assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.workspace-switcher-app-name[\s\S]*display:\s*none/)
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/ui-design-system.test.cjs`

Expected: FAIL per componente e layout mancanti.

- [ ] **Step 3: Implementare il componente con copy italiana**

Il trigger mostra icona, `VincodeLab` e basename del workspace. Il pannello elenca recenti e per ogni riga espone `Apri qui` e `Nuova finestra`; il percorso completo è in `title`. Il pulsante nuova finestra usa `disabled={!status.canOpenNew || status.workspaceOpenElsewhere}` e mostra rispettivamente `Limite di due finestre raggiunto` o `Progetto già aperto in un'altra finestra`.

- [ ] **Step 4: Applicare la griglia della toolbar**

```css
.window-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
}
.workspace-switcher { grid-column: 2; min-width: 0; }
.app-section-tabs { grid-column: 3; justify-self: end; }
```

Il primo binario vuoto riserva lo spazio dei semafori; il controllo resta centrato nello spazio utile. A meno di 1100px nascondere solo `.workspace-switcher-app-name`, poi applicare ellissi al progetto.

- [ ] **Step 5: Eseguire test UI e build TypeScript**

Run: `node --test test/ui-design-system.test.cjs && npm run build`

Expected: PASS; build senza errori TypeScript.

- [ ] **Step 6: Commit**

```bash
git add src/components/workspace-switcher.tsx src/App.tsx src/styles/views/home.css test/ui-design-system.test.cjs
git commit -m "feat: centra e rende operativo il selettore workspace"
```

### Task 6: Verifica integrata e regressioni

**Files:**
- Modify only if a failing verification identifies a root cause in files already listed.

**Interfaces:**
- Consumes: tutte le interfacce delle Task 1-5.
- Produces: evidenza di test, build e comportamento dev senza release.

- [ ] **Step 1: Eseguire suite e lint**

Run: `npm test && npm run lint && npm run build && npm run audit:css:check`

Expected: tutti i comandi terminano con codice 0.

- [ ] **Step 2: Verificare manualmente due processi in sviluppo**

Avviare il primo workspace, aprire un secondo workspace con `Nuova finestra`, verificare PID distinti e terminali indipendenti. Tentare terza finestra e duplicato; entrambi devono mostrare il messaggio previsto.

- [ ] **Step 3: Verificare arresto anomalo e recupero**

Terminare forzatamente la seconda istanza, attendere al massimo 15 secondi, quindi aprire un altro workspace. La nuova istanza deve essere ammessa e la prima deve restare operativa.

- [ ] **Step 4: Verificare il dialogo dei file modificati**

Modificare due file, provare `Annulla`, `Scarta e cambia`, quindi ripetere con `Salva e cambia`. Simulare un salvataggio fallito usando un file non scrivibile e verificare che il workspace non cambi.

- [ ] **Step 5: Controllare lo stato Git e creare il commit di consolidamento solo se necessario**

Run: `git status --short && git diff --check`

Expected: nessuna modifica non intenzionale. Se le verifiche non hanno richiesto correzioni, non creare un commit vuoto.
