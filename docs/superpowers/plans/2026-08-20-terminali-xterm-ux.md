# Terminali xterm UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** rendere coerenti, accessibili e resilienti il Terminale AI Pi e il Terminale libero, aggiungendo allegati esterni solo alla sessione Pi esistente.

**Architecture:** una libreria renderer pura concentra preferenze, viewport e scorciatoie; una toolbar React riusabile riceve callback e non conosce PTY. Per gli allegati il main process convalida path e restituisce soli metadata, il preload espone metodi limitati e il renderer scrive riferimenti nel PTY Pi già attivo senza inviare Invio.

**Tech Stack:** Electron, React, TypeScript, xterm.js 6, lucide-react, Node test, CSS esistente.

**Spec:** docs/superpowers/specs/2026-08-20-terminali-xterm-ux-design.md

## Global Constraints

- Non creare Pi Web UI, server locale o una seconda sessione Pi.
- Non copiare, caricare, indicizzare o persistere file allegati, output o comandi.
- File esterni al workspace sono ammessi solo dopo verifica main-process; il renderer non riceve API Node o filesystem generiche.
- Inserire il riferimento Pi con prefisso @ e path assoluto, senza CR; Pi invia il messaggio solo quando l'utente preme Invio.
- Conservare fuori dallo staging le modifiche utente in src/components/project-editor.tsx e test/editor-ux.test.cjs.
- L'app resta in sviluppo con hot reload; riavviare il main Electron soltanto per verificare main/preload.

---

## File structure

| File | Responsabilità |
|---|---|
| src/lib/terminal-preferences.ts | preferenze locali per workspace e limiti font |
| src/lib/terminal-viewport.ts | decisione pura per auto-scroll e stato |
| src/components/terminal-toolbar.tsx | toolbar accessibile riusata da Pi e shell |
| src/components/terminal-attachments.tsx | coda e drop allegati, soltanto per Pi |
| electron/terminal-attachments.cjs | verifica file e metadata minimali |
| electron/main.cjs | picker nativo e IPC ristretto |
| electron/preload.cjs | bridge senza API Node |
| src/vincode-lab.d.ts | contratti renderer |
| src/App.tsx, src/components/free-terminal.tsx | integrazione xterm |
| src/App.css, src/terminal.css | overlay, chip, controllo nuovo output |

### Task 1: Preferenze e viewport pure

**Files:**
- Create: src/lib/terminal-preferences.ts
- Create: src/lib/terminal-viewport.ts
- Test: test/terminal-preferences.test.mjs
- Test: test/terminal-viewport.test.mjs

**Interfaces:**
- Produces: readTerminalPreferences(workspace), writeTerminalPreferences(workspace, preferences), nextTerminalFontSize(current, delta).
- Produces: shouldFollowTerminalOutput({ viewportY, baseY }) and terminalStatusLabel(status, readyLabel).

- [ ] **Step 1: Write failing tests**

~~~
import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTerminalFontSize, readTerminalPreferences, writeTerminalPreferences } from '../src/lib/terminal-preferences.js'

test('preferenze isolate per workspace e font limitato', () => {
  const data = new Map()
  globalThis.localStorage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  assert.equal(nextTerminalFontSize(11, -1), 11)
  assert.equal(nextTerminalFontSize(20, 1), 20)
  writeTerminalPreferences('/workspace/a', { fontSize: 14, followOutput: false })
  assert.deepEqual(readTerminalPreferences('/workspace/a'), { fontSize: 14, followOutput: false })
  assert.deepEqual(readTerminalPreferences('/workspace/b'), { fontSize: 11, followOutput: true })
})
~~~

~~~
import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldFollowTerminalOutput } from '../src/lib/terminal-viewport.js'

test('segue output solo se il viewport è in fondo', () => {
  assert.equal(shouldFollowTerminalOutput({ viewportY: 45, baseY: 45 }), true)
  assert.equal(shouldFollowTerminalOutput({ viewportY: 44, baseY: 45 }), false)
})
~~~

- [ ] **Step 2: Run tests to verify they fail**

Run: node --test test/terminal-preferences.test.mjs test/terminal-viewport.test.mjs
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement minimal modules**

~~~
export type TerminalPreferences = { fontSize: number; followOutput: boolean }
const defaults = { fontSize: 11, followOutput: true }
const keyFor = (workspace: string) => 'vincodelab:terminal:' + workspace

export function nextTerminalFontSize(current: number, delta: number) {
  return Math.min(20, Math.max(11, current + delta))
}
export function readTerminalPreferences(workspace: string): TerminalPreferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(keyFor(workspace)) ?? '{}') } } catch { return defaults }
}
export function writeTerminalPreferences(workspace: string, preferences: TerminalPreferences) {
  localStorage.setItem(keyFor(workspace), JSON.stringify(preferences))
}
~~~

~~~
export function shouldFollowTerminalOutput({ viewportY, baseY }: { viewportY: number; baseY: number }) {
  return viewportY >= baseY
}
export function terminalStatusLabel(status: 'starting' | 'running' | 'ended' | 'error', readyLabel: string) {
  return status === 'running' ? readyLabel : status === 'starting' ? 'Avvio…' : status === 'ended' ? 'Sessione terminata' : 'Errore sessione'
}
~~~

- [ ] **Step 4: Run tests to verify they pass**

Run: node --test test/terminal-preferences.test.mjs test/terminal-viewport.test.mjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add src/lib/terminal-preferences.ts src/lib/terminal-viewport.ts test/terminal-preferences.test.mjs test/terminal-viewport.test.mjs
git commit -m "feat: aggiunge preferenze e viewport terminale"
~~~

### Task 2: Verifica main-process degli allegati Pi

**Files:**
- Create: electron/terminal-attachments.cjs
- Test: test/terminal-attachments.test.cjs

**Interfaces:**
- Produces: prepareTerminalAttachment(filePath) -> { absolutePath, name }.
- Rejects input non stringa, relativo, oltre 4096 caratteri, assente, symlink e directory. Non legge il contenuto.

- [ ] **Step 1: Write a failing test**

~~~
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { prepareTerminalAttachment } = require('../electron/terminal-attachments.cjs')

test('prepara solo file reali', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vincode-terminal-'))
  const file = path.join(dir, 'report con spazi.pdf')
  fs.writeFileSync(file, 'test')
  assert.deepEqual(prepareTerminalAttachment(file), { absolutePath: fs.realpathSync(file), name: 'report con spazi.pdf' })
  assert.throws(() => prepareTerminalAttachment(dir), /file regolare/)
  assert.throws(() => prepareTerminalAttachment('relative.pdf'), /assoluto/)
})
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test test/terminal-attachments.test.cjs
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement path validation**

~~~
const fs = require('node:fs')
const path = require('node:path')

function prepareTerminalAttachment(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.length > 4096 || !path.isAbsolute(filePath)) {
    throw new Error('Il percorso allegato deve essere assoluto e valido.')
  }
  const absolutePath = fs.realpathSync(filePath)
  const stats = fs.lstatSync(absolutePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('L’allegato deve essere un file regolare.')
  fs.accessSync(absolutePath, fs.constants.R_OK)
  return { absolutePath, name: path.basename(absolutePath) }
}
module.exports = { prepareTerminalAttachment }
~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: node --test test/terminal-attachments.test.cjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add electron/terminal-attachments.cjs test/terminal-attachments.test.cjs
git commit -m "feat: valida allegati per il terminale Pi"
~~~

### Task 3: IPC limitato per picker e drop Pi

**Files:**
- Modify: electron/main.cjs
- Modify: electron/preload.cjs
- Modify: src/vincode-lab.d.ts
- Modify: test/preload-surface.test.cjs

**Interfaces:**
- Consumes: prepareTerminalAttachment(filePath).
- Produces: terminal.chooseAttachments() and terminal.prepareDroppedAttachments(files: File[]).

- [ ] **Step 1: Add failing surface test**

~~~
test('gli allegati Pi passano da API terminale ristrette', () => {
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  assert.match(preload, /chooseAttachments: \(\) => ipcRenderer\.invoke\('terminal:chooseAttachments'\)/)
  assert.match(preload, /webUtils\.getPathForFile/)
  assert.doesNotMatch(preload, /node:fs/)
  assert.match(main, /ipcMain\.handle\('terminal:chooseAttachments'/)
  assert.match(main, /prepareTerminalAttachment/)
})
~~~

- [ ] **Step 2: Run the test to verify it fails**

Run: node --test test/preload-surface.test.cjs
Expected: FAIL because the bridge is absent.

- [ ] **Step 3: Add handlers and declarations**

~~~
async function chooseTerminalAttachments() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Allega file a Pi', buttonLabel: 'Allega', properties: ['openFile', 'multiSelections'],
  })
  return result.canceled ? [] : result.filePaths.map(prepareTerminalAttachment)
}
ipcMain.handle('terminal:chooseAttachments', (event) => { assertTrustedSender(event); return chooseTerminalAttachments() })
ipcMain.handle('terminal:prepareDroppedAttachments', (event, filePaths) => {
  assertTrustedSender(event)
  if (!Array.isArray(filePaths) || filePaths.length > 20) throw new Error('Allegati non validi.')
  return filePaths.map(prepareTerminalAttachment)
})
~~~

~~~
chooseAttachments: () => ipcRenderer.invoke('terminal:chooseAttachments'),
prepareDroppedAttachments: (files) => ipcRenderer.invoke(
  'terminal:prepareDroppedAttachments',
  files.map((file) => webUtils.getPathForFile(file)),
),
~~~

Add the shared TypeScript type:
~~~
interface TerminalAttachment { absolutePath: string; name: string }
~~~

- [ ] **Step 4: Run the test to verify it passes**

Run: node --test test/preload-surface.test.cjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs
git commit -m "feat: espone allegati Pi con IPC limitato"
~~~

### Task 4: Toolbar comune e controlli xterm

**Files:**
- Create: src/components/terminal-toolbar.tsx
- Modify: src/App.tsx
- Modify: src/components/free-terminal.tsx
- Modify: src/App.css
- Modify: src/terminal.css
- Modify: test/ui-design-system.test.cjs

**Interfaces:**
- Produces: TerminalToolbar with statusLabel, fontSize, onSearch, onZoom, onResetZoom, onCopy, onPaste, onClear and onRestart.
- Pi and shell bind callbacks only to their respective PTY APIs.

- [ ] **Step 1: Add failing shared-toolbar test**

~~~
test('i terminali riusano toolbar e reset zoom', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const shell = fs.readFileSync(path.join(__dirname, '../src/components/free-terminal.tsx'), 'utf8')
  const toolbar = fs.readFileSync(path.join(__dirname, '../src/components/terminal-toolbar.tsx'), 'utf8')
  assert.match(app, /<TerminalToolbar/)
  assert.match(shell, /<TerminalToolbar/)
  assert.match(toolbar, /aria-label="Reimposta zoom"/)
  assert.match(toolbar, /aria-label="Riavvia sessione"/)
})
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/ui-design-system.test.cjs
Expected: FAIL because the toolbar module does not exist.

- [ ] **Step 3: Implement and integrate**

~~~
export function TerminalToolbar({ statusLabel, fontSize, onSearch, onZoom, onResetZoom, onCopy, onPaste, onClear, onRestart }: TerminalToolbarProps) {
  return <div className="terminal-toolbar" aria-label="Controlli terminale">
    <span className="terminal-status-label" aria-live="polite">{statusLabel}</span>
    <div className="terminal-actions">
      <button aria-label="Cerca nel terminale" onClick={onSearch}><Search size={15} /></button>
      <button aria-label="Riduci zoom" onClick={() => onZoom(-1)}><Minus size={15} /></button>
      <button aria-label="Reimposta zoom" onClick={onResetZoom}>{fontSize}px</button>
      <button aria-label="Aumenta zoom" onClick={() => onZoom(1)}><Plus size={15} /></button>
      <button aria-label="Copia selezione" onClick={onCopy}><Clipboard size={15} /></button>
      <button aria-label="Incolla nel terminale" onClick={onPaste}><ClipboardPaste size={15} /></button>
      <button aria-label="Pulisci vista terminale" onClick={onClear}><Trash2 size={15} /></button>
      <button aria-label="Riavvia sessione" onClick={onRestart}><RefreshCw size={15} /></button>
    </div>
  </div>
}
~~~

Use the SearchAddon in both terminals. Implement Cmd/Ctrl+F, Cmd/Ctrl++, Cmd/Ctrl+-, Cmd/Ctrl+0, Cmd/Ctrl+C only with selection, Cmd/Ctrl+V and Cmd/Ctrl+K only when that terminal is visible. Call focus after toolbar actions and after closing search.

- [ ] **Step 4: Add responsive styles and rerun test**

~~~
.terminal-toolbar { display:flex; min-width:0; align-items:center; justify-content:space-between; gap:var(--space-3); }
.terminal-actions { display:flex; min-width:0; align-items:center; gap:4px; }
.terminal-actions button { flex:0 0 auto; }
~~~

Run: node --test test/ui-design-system.test.cjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add src/components/terminal-toolbar.tsx src/App.tsx src/components/free-terminal.tsx src/App.css src/terminal.css test/ui-design-system.test.cjs
git commit -m "feat: unifica i controlli dei terminali"
~~~

### Task 5: Auto-scroll, preferenze e refit resistente

**Files:**
- Modify: src/App.tsx
- Modify: src/components/free-terminal.tsx
- Modify: src/App.css
- Modify: src/terminal.css
- Modify: test/terminal-session-history.test.cjs
- Modify: test/ui-design-system.test.cjs

**Interfaces:**
- Consumes Task 1 and xterm buffer.active.viewportY, buffer.active.baseY, scrollToBottom().
- Produces the control Nuovo output only when the user is reading history.

- [ ] **Step 1: Add failing assertions**

~~~
test('i terminali non forzano lo scroll durante la lettura dello storico', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const shell = fs.readFileSync(path.join(__dirname, '../src/components/free-terminal.tsx'), 'utf8')
  assert.match(app, /shouldFollowTerminalOutput/)
  assert.match(shell, /shouldFollowTerminalOutput/)
  assert.match(app, /scrollToBottom/)
  assert.match(shell, /scrollToBottom/)
})
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/ui-design-system.test.cjs test/terminal-session-history.test.cjs
Expected: FAIL because viewport handling is not integrated.

- [ ] **Step 3: Integrate scroll, preference and refit**

~~~
const followsOutput = shouldFollowTerminalOutput({
  viewportY: xterm.buffer.active.viewportY,
  baseY: xterm.buffer.active.baseY,
})
if (followsOutput) xterm.scrollToBottom()
else setHasUnreadOutput(true)
~~~

Restore preferences before xterm creation. Write them only after a user action. Preserve the existing ResizeObserver, bounded frame output queue and scheduleVisibleTerminalRefit; every fit computes dimensions and calls resize only when cols or rows changed.

- [ ] **Step 4: Render unread-output button and verify**

~~~
{hasUnreadOutput && <button className="terminal-new-output" onClick={() => {
  terminal.current?.scrollToBottom()
  setHasUnreadOutput(false)
}}>Nuovo output</button>}
~~~

Run: node --test test/ui-design-system.test.cjs test/terminal-session-history.test.cjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add src/App.tsx src/components/free-terminal.tsx src/App.css src/terminal.css test/terminal-session-history.test.cjs test/ui-design-system.test.cjs
git commit -m "feat: migliora scroll e recupero dei terminali"
~~~

### Task 6: Coda, picker e drop del solo Terminale AI

**Files:**
- Create: src/components/terminal-attachments.tsx
- Modify: src/App.tsx
- Modify: src/App.css
- Modify: test/ui-design-system.test.cjs

**Interfaces:**
- Consumes terminal.chooseAttachments() and terminal.prepareDroppedAttachments(files).
- Produces onInsert(referenceText), whose value ends with one space and has no CR.

- [ ] **Step 1: Add failing Pi-only attachment test**

~~~
test('gli allegati sono esclusivi di Pi e non inviano Invio', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const attachments = fs.readFileSync(path.join(__dirname, '../src/components/terminal-attachments.tsx'), 'utf8')
  const shell = fs.readFileSync(path.join(__dirname, '../src/components/free-terminal.tsx'), 'utf8')
  assert.match(app, /<TerminalAttachments/)
  assert.match(attachments, /prepareDroppedAttachments/)
  assert.match(attachments, /attachment\.absolutePath/)
  assert.doesNotMatch(attachments, /\\r/)
  assert.doesNotMatch(shell, /TerminalAttachments/)
})
~~~

- [ ] **Step 2: Run test to verify it fails**

Run: node --test test/ui-design-system.test.cjs
Expected: FAIL because the attachment component does not exist.

- [ ] **Step 3: Implement the temporary deduplicated queue**

~~~
const addAttachments = (next: TerminalAttachment[]) => setAttachments((current) => {
  const known = new Set(current.map((item) => item.absolutePath))
  return [...current, ...next.filter((item) => !known.has(item.absolutePath))]
})
const insert = () => {
  onInsert(attachments.map((attachment) => '@' + attachment.absolutePath).join(' ') + ' ')
  setAttachments([])
}
~~~

Render a button labelled Allega file, removable chips and a disabled insert action when empty. Use a dragenter/dragleave depth counter to avoid overlay flicker. On drop call the preload method with event.dataTransfer.files. Retain valid queued files if another file fails validation; show the error. Never use File.path, fs, clipboard or CR.

- [ ] **Step 4: Add styling and rerun targeted tests**

~~~
.terminal-drop-overlay { position:absolute; inset:0; display:grid; place-items:center; border:2px dashed var(--brand); background:color-mix(in srgb,var(--brand-soft) 76%,transparent); pointer-events:none; }
.terminal-attachment-chips { display:flex; flex-wrap:wrap; gap:6px; min-width:0; }
.terminal-attachment-chip { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
~~~

Run: node --test test/ui-design-system.test.cjs test/preload-surface.test.cjs test/terminal-attachments.test.cjs
Expected: PASS.

- [ ] **Step 5: Commit**

~~~
git add src/components/terminal-attachments.tsx src/App.tsx src/App.css test/ui-design-system.test.cjs
git commit -m "feat: aggiunge allegati al terminale Pi"
~~~

### Task 7: Verifica integrata e controllo manuale

**Files:**
- Modify only if a regression assertion is required: test/ui-design-system.test.cjs or test/preload-surface.test.cjs.

- [ ] **Step 1: Run the complete automated suite**

Run: npm test && npm run lint && npm run build && git diff --check
Expected: all commands exit 0; the two user files never enter staging.

- [ ] **Step 2: Verify in the developer app**

Check: Pi and shell at 11px; search, zoom/reset, copy/paste, clear and restart; return between tabs; resize window; PTY exit; manual scroll plus Nuovo output; external file with spaces via picker and drop; chip removal; insert path without Invio.

- [ ] **Step 3: Restart only Electron main and recheck IPC**

Run: stop the current dev Electron main process, then npm run dev. Do not package.
Expected: picker and drop respond and Pi/shell remain visible after tab changes.

- [ ] **Step 4: Commit final test-only changes when present**

~~~
git add test/ui-design-system.test.cjs test/preload-surface.test.cjs
git commit -m "test: copre UX condivisa dei terminali"
~~~

Do not create this commit when no test file changed.

## Self-review

- Coverage: Task 1 and 5 cover preference, focus, refit and scroll; Tasks 2, 3 and 6 cover external attachments, constrained IPC and no copies; Task 4 covers toolbar and shortcuts; Task 7 covers automated and runtime verification.
- Placeholder scan: no TBD/TODO or generic validation steps.
- Type consistency: TerminalAttachment is always { absolutePath, name }; TerminalPreferences is always { fontSize, followOutput }; the renderer receives only these metadata.
