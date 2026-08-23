# Libreria comandi del Terminale libero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al Terminale libero una libreria di categorie e comandi locali al workspace, con esecuzione nel PTY solo dopo conferma esplicita.

**Architecture:** Il main process possiede persistenza SQLite e l’invio al PTY; il renderer riceve DTO tipizzati e non conosce il database. I comandi sono riferiti per ID all’esecuzione: il main rilegge il contenuto nel workspace attivo prima di scriverlo nella shell, evitando di fidarsi di testo trasportato dalla UI.

**Tech Stack:** Electron 43, React 19, TypeScript 6, `better-sqlite3`, Node test runner, xterm.

**Spec:** `docs/superpowers/specs/2026-08-20-comandi-terminali-workspace-design.md`

## Global Constraints

- Riutilizzare `vincodelab.sqlite` in WAL e `getDatabase()` di `electron/workspace-store.cjs`; nessuna dipendenza nuova.
- Categorie e comandi sono isolati per `workspace_path` assoluto e non esiste una libreria globale.
- Il campo `command` è libero e persiste in chiaro su richiesta esplicita dell’utente: non applicare filtri, mascheramenti, logging o sincronizzazione.
- L’esecuzione richiede conferma del renderer, ma il main deve comunque accettare solo un `commandId` appartenente al workspace attivo e alla shell attiva.
- L’apertura della sidebar non deve ridimensionare, rimontare o riavviare xterm/PTy.
- Mantenere `assertTrustedSender`, `requireActiveWorkspace`, `contextIsolation: true` e nessun accesso SQLite dal renderer.
- Prima dell’handoff eseguire `npm test && npm run lint && npm run build && git diff --check`; mantenere `npm run dev`, senza package.

---

## File structure

- Modify: `electron/workspace-store.cjs` — schema condiviso invariato, solo consumo della connessione esistente.
- Create: `electron/workspace-commands.cjs` — schema, CRUD, ordine e lookup sicuro dei comandi del workspace.
- Modify: `electron/main.cjs` — handler IPC CRUD e invio del comando salvato al PTY della shell attiva.
- Modify: `electron/preload.cjs` — unica superficie `workspaceCommands` per il renderer.
- Modify: `src/vincode-lab.d.ts` — DTO e contratti IPC tipizzati.
- Modify: `src/components/free-terminal.tsx` — pulsante, sidebar, ricerca, form e conferma esecuzione.
- Modify: `src/terminal.css` — sidebar overlay, responsive, focus e nessun overflow.
- Create: `test/workspace-commands.test.cjs` — contratti SQLite e isolamento workspace.
- Modify: `test/preload-surface.test.cjs`, `test/terminal-resize.test.mjs`, `test/ui-design-system.test.cjs` — confini IPC, PTY e UX.

### Task 1: Archivio SQLite dei comandi per workspace

**Files:**
- Create: `electron/workspace-commands.cjs`
- Create: `test/workspace-commands.test.cjs`

**Interfaces:**
- Produces: `listWorkspaceCommands(workspacePath)`, `createCommandCategory(workspacePath, name)`, `updateCommandCategory(workspacePath, categoryId, name)`, `deleteCommandCategory(workspacePath, categoryId)`, `createWorkspaceCommand(workspacePath, input)`, `updateWorkspaceCommand(workspacePath, commandId, input)`, `moveWorkspaceCommand(workspacePath, commandId, categoryId)`, `deleteWorkspaceCommand(workspacePath, commandId)`, `getWorkspaceCommand(workspacePath, commandId)`.
- Consumes: `getDatabase()` da `workspace-store.cjs`.

- [x] **Step 1: Scrivere il test RED per isolamento, contenuto libero e cascata categoria**

```js
test('isola categorie e comandi per workspace senza filtrare il testo', (t) => {
  withTemporaryDatabase(t)
  const category = createCommandCategory('/tmp/a', 'Server')
  const command = createWorkspaceCommand('/tmp/a', {
    categoryId: category.id,
    title: 'Produzione',
    command: 'ssh api-prod && export PASSWORD=sviluppo',
    note: 'Accesso diagnostico',
  })
  createCommandCategory('/tmp/b', 'Build')

  assert.equal(listWorkspaceCommands('/tmp/a').categories[0].commands[0].command, command.command)
  assert.deepEqual(listWorkspaceCommands('/tmp/b').categories, [{ name: 'Build', commands: [] }])
  deleteCommandCategory('/tmp/a', category.id)
  assert.equal(getWorkspaceCommand('/tmp/a', command.id), null)
})
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/workspace-commands.test.cjs`

Expected: FAIL perché il modulo `workspace-commands.cjs` non esiste.

- [x] **Step 3: Implementare schema e CRUD minimo**

```js
database.exec(`
  CREATE TABLE IF NOT EXISTS workspace_command_categories (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_path TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_commands (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_path TEXT NOT NULL,
    category_id TEXT NOT NULL REFERENCES workspace_command_categories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    command TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)
```

Generare gli ID con `crypto.randomUUID()`. Validare solo struttura e limiti: path assoluto, ID UUID, categoria/titolo non vuoti e testo `command` stringa non vuota fino a 65.536 caratteri; non ispezionare o modificare il contenuto del comando.

- [x] **Step 4: Implementare ordine, spostamento e lettura atomica**

`listWorkspaceCommands` restituisce `{ categories: Array<{ id, name, commands }> }` ordinato per `sort_order, created_at`. Creazione e spostamento calcolano il prossimo ordine nella stessa transazione. `getWorkspaceCommand` filtra sempre per `workspace_path` e ritorna `null` per ID non appartenente al workspace.

- [x] **Step 5: Eseguire il GREEN e commit**

Run: `node --test test/workspace-commands.test.cjs && git diff --check`

Expected: PASS per CRUD, isolamento, comando libero, spostamento e cascade delete.

```bash
git add electron/workspace-commands.cjs test/workspace-commands.test.cjs
git commit -m "feat: aggiunge libreria comandi per workspace"
```

### Task 2: IPC tipizzate e invio sicuro al PTY esistente

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `test/preload-surface.test.cjs`
- Modify: `test/terminal-resize.test.mjs`

**Interfaces:**
- Consumes: CRUD e `getWorkspaceCommand` di Task 1; `shellProcess`, `shellWorkspacePath`, `requireActiveWorkspace` esistenti.
- Produces: `window.vincodeLab.workspaceCommands.{list,createCategory,updateCategory,deleteCategory,create,update,move,delete,run}`; `run(commandId)` restituisce `{ executed: true }`.

- [x] **Step 1: Scrivere i test RED per superficie preload e vincolo workspace/PTy**

```js
assert.match(preload, /workspaceCommands: \{[\s\S]*run: \(commandId\) => ipcRenderer\.invoke\('workspaceCommands:run', commandId\)/)
assert.doesNotMatch(preload, /workspaceCommands:[\s\S]*shell:input/)
assert.match(main, /shellWorkspacePath !== workspacePath[\s\S]*La shell non è attiva per questo workspace/)
assert.match(main, /getWorkspaceCommand\(workspacePath, commandId\)/)
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/preload-surface.test.cjs test/terminal-resize.test.mjs`

Expected: FAIL perché non esiste la superficie `workspaceCommands` né l’handler di esecuzione.

- [x] **Step 3: Aggiungere DTO e handler IPC**

```ts
interface WorkspaceCommandCategory { id: string; name: string; commands: WorkspaceCommand[] }
interface WorkspaceCommand { id: string; categoryId: string; title: string; command: string; note: string }
interface WorkspaceCommandInput { categoryId: string; title: string; command: string; note: string }
```

Ogni handler applica `assertTrustedSender` e `requireActiveWorkspace`. Gli handler CRUD passano sempre il percorso restituito da `requireActiveWorkspace`, non ricevono un path dal renderer.

- [x] **Step 4: Implementare `workspaceCommands:run`**

```js
ipcMain.handle('workspaceCommands:run', (event, commandId) => {
  assertTrustedSender(event)
  const workspacePath = requireActiveWorkspace()
  if (!shellProcess || shellWorkspacePath !== workspacePath) {
    throw new Error('La shell non è attiva per questo workspace.')
  }
  const command = getWorkspaceCommand(workspacePath, commandId)
  if (!command) throw new Error('Comando del workspace non trovato.')
  shellProcess.write(`${command.command}\r`)
  return { executed: true }
})
```

Non accettare testo comando nell’handler `run`; non aggiungere log del contenuto.

- [x] **Step 5: Eseguire il GREEN e commit**

Run: `node --test test/preload-surface.test.cjs test/terminal-resize.test.mjs && npm run build`

Expected: PASS; renderer tipizzato, main unico esecutore, PTY preservato.

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs test/terminal-resize.test.mjs
git commit -m "feat: espone comandi workspace nel terminale"
```

### Task 3: Sidebar a comparsa e gestione comandi nel Terminale libero

**Files:**
- Modify: `src/components/free-terminal.tsx`
- Modify: `src/terminal.css`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `window.vincodeLab.workspaceCommands` da Task 2 e `ConfirmationDialog` esistente.
- Produces: pulsante `Comandi`, sidebar overlay, ricerca, CRUD UI e richiesta di conferma prima di `run(id)`.

- [x] **Step 1: Scrivere il test RED UX**

```js
assert.match(component, /aria-label="Apri comandi workspace"/)
assert.match(component, /className="workspace-command-sidebar"/)
assert.match(component, /workspaceCommands\.run\(pendingCommand\.id\)/)
assert.match(component, /ConfirmationDialog/)
assert.match(styles, /\.workspace-command-sidebar\{[^}]*position:absolute/)
assert.match(styles, /\.workspace-command-sidebar\{[^}]*inset-inline-end:12px/)
assert.doesNotMatch(styles, /\.free-terminal-page:has\(\.workspace-command-sidebar\).*grid-template-columns/)
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/ui-design-system.test.cjs`

Expected: FAIL perché il terminale non ha la sidebar né la conferma esecuzione.

- [x] **Step 3: Implementare stato e caricamento sidebar**

In `FreeTerminal` aggiungere stato per apertura sidebar, elenco categorie, ricerca, comando/categoria in modifica e `pendingCommand`. Caricare `workspaceCommands.list()` solo quando la sidebar viene aperta e ricaricare dopo ogni mutazione; al cambio `workspace` chiudere sidebar e svuotare lo stato. Non collegare l’apertura sidebar a `restartKey`, `ResizeObserver` o al ciclo di mount di xterm.

- [x] **Step 4: Implementare CRUD e conferma esecuzione**

Il form crea/modifica categoria e comando con campi controllati. Il comando conserva il testo esattamente inserito. `Esegui` imposta `pendingCommand`; `ConfirmationDialog` mostra `pendingCommand.command` e `onConfirm` chiama `workspaceCommands.run(pendingCommand.id)`. Disabilitare il pulsante esecuzione se `status !== 'ready'`; mostrare toast per successo o errore senza ristampare il comando.

- [x] **Step 5: Implementare CSS overlay accessibile**

```css
.workspace-command-sidebar {
  position: absolute;
  z-index: 12;
  inset-block: 52px 12px;
  inset-inline-end: 12px;
  width: min(380px, calc(100% - 24px));
  overflow: auto;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}
```

Usare i token del design system anche in dark mode, `min-width: 0` per i testi lunghi e breakpoint mobile dove la sidebar occupa la larghezza disponibile. Non modificare padding/width della superficie xterm quando la sidebar è aperta.

- [x] **Step 6: Eseguire il GREEN e commit**

Run: `node --test test/ui-design-system.test.cjs && npm run lint && npm run build`

Expected: PASS; sidebar overlay senza overflow e conferma obbligatoria.

```bash
git add src/components/free-terminal.tsx src/terminal.css test/ui-design-system.test.cjs
git commit -m "feat: aggiunge sidebar comandi al terminale libero"
```

### Task 4: Verifica integrata e collaudo dev

**Files:**
- Modify: `test/workspace-commands.test.cjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: contratti Tasks 1-3.
- Produces: evidenza ripetibile per isolamento, invio controllato e stabilità terminale.

- [x] **Step 1: Aggiungere scenario di workspace differente**

```js
const command = createWorkspaceCommand('/tmp/a', input)
assert.equal(getWorkspaceCommand('/tmp/b', command.id), null)
assert.throws(() => updateWorkspaceCommand('/tmp/b', command.id, input), /Comando del workspace non trovato/)
```

- [x] **Step 2: Verificare senza shell attiva e senza auto-run**

Run: `node --test test/workspace-commands.test.cjs test/preload-surface.test.cjs test/terminal-resize.test.mjs`

Expected: PASS; un ID di un altro workspace non è eseguibile e la UI non dispone di un canale che invii il comando all’apertura.

- [x] **Step 3: Eseguire verifica completa**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: tutte le verifiche verdi.

- [x] **Step 4: Collaudo manuale in dev**

1. Aprire un workspace e la tab Terminale libero.
2. Aprire/chiudere la sidebar più volte verificando che terminale e prompt restino visibili.
3. Creare categoria `Build` e comando innocuo `pwd`, confermare l’esecuzione e verificare output nel PTY.
4. Cambiare workspace e verificare che il comando non compaia.
5. Creare un comando `ssh alias-dev` o con variabile ambiente e verificare che sia salvato e modificabile senza mascheramenti.

- [x] **Step 5: Commit finale**

```bash
git add test/workspace-commands.test.cjs test/ui-design-system.test.cjs
git commit -m "test: verifica libreria comandi del terminale"
```
