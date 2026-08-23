# Incolla Terminale AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedire che il Terminale AI scarti silenziosamente contenuti oltre 65.536 caratteri e trasmettere in modo integro gli input ammessi.

**Architecture:** Una funzione pura valida e suddivide l'input; il main process resta responsabile della scrittura PTY. L'API passa da evento senza risposta a richiesta con esito strutturato, così il renderer può mostrare un avviso senza inviare frammenti parziali.

**Tech Stack:** Electron IPC, Node.js, node-pty, React, TypeScript, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-21-multi-istanza-workspace-design.md`

## Global Constraints

- Nessun input viene ignorato senza esito.
- Nessun frammento viene scritto quando l'input complessivo è rifiutato.
- I blocchi non modificano caratteri o ritorni a capo.
- Il limite complessivo protegge memoria e reattività.
- La digitazione interattiva resta immediata.
- La sessione Pi, il focus e l'output esistente non vengono azzerati.

---

## File map

- `electron/terminal-input.cjs`: validazione, limiti e scrittura sequenziale a blocchi.
- `electron/main.cjs`: handler IPC con risposta.
- `electron/preload.cjs`: API `terminal.write` asincrona.
- `src/App.tsx`: feedback dell'incolla e gestione errori.
- `src/vincode-lab.d.ts`: tipi dell'esito.
- `test/terminal-input.test.cjs`: integrità, soglie e assenza di scritture parziali.
- `test/preload-surface.test.cjs`: contratto invoke confinato.
- `test/ui-design-system.test.cjs`: feedback esplicito nel flusso paste.

### Task 1: Validazione e scrittura PTY a blocchi

**Files:**
- Create: `electron/terminal-input.cjs`
- Test: `test/terminal-input.test.cjs`

**Interfaces:**
- Produces: `writeTerminalInput(ptyProcess, data, options): Promise<TerminalWriteResult>`.
- `TerminalWriteResult`: `{ accepted: true; length: number; chunks: number } | { accepted: false; reason: 'invalid' | 'too-large' | 'not-running'; length: number; limit: number }`.

- [ ] **Step 1: Scrivere test fallenti per integrità e rifiuto atomico**

```js
const writes = []
const result = await writeTerminalInput({ write: (chunk) => writes.push(chunk) }, 'x'.repeat(70_000), { maxLength: 200_000, chunkSize: 16_384, yieldControl: async () => {} })
assert.equal(result.accepted, true)
assert.equal(writes.join(''), 'x'.repeat(70_000))
assert.ok(writes.every((chunk) => chunk.length <= 16_384))

writes.length = 0
const rejected = await writeTerminalInput({ write: (chunk) => writes.push(chunk) }, 'x'.repeat(200_001), { maxLength: 200_000, chunkSize: 16_384 })
assert.deepEqual(rejected, { accepted: false, reason: 'too-large', length: 200_001, limit: 200_000 })
assert.deepEqual(writes, [])
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/terminal-input.test.cjs`

Expected: FAIL perché il modulo non esiste.

- [ ] **Step 3: Implementare validazione completa prima della prima scrittura**

```js
async function writeTerminalInput(ptyProcess, data, { maxLength = 200_000, chunkSize = 16_384, yieldControl = () => new Promise((resolve) => setImmediate(resolve)) } = {}) {
  const length = typeof data === 'string' ? data.length : 0
  if (typeof data !== 'string') return { accepted: false, reason: 'invalid', length, limit: maxLength }
  if (!ptyProcess) return { accepted: false, reason: 'not-running', length, limit: maxLength }
  if (length > maxLength) return { accepted: false, reason: 'too-large', length, limit: maxLength }
  let chunks = 0
  for (let offset = 0; offset < length; offset += chunkSize) {
    ptyProcess.write(data.slice(offset, offset + chunkSize))
    chunks += 1
    if (offset + chunkSize < length) await yieldControl()
  }
  return { accepted: true, length, chunks }
}
```

Includere casi `''`, caratteri Unicode, JSON multilinea, processo assente e valore non stringa.

- [ ] **Step 4: Eseguire i test**

Run: `node --test test/terminal-input.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/terminal-input.cjs test/terminal-input.test.cjs
git commit -m "fix: valida e suddivide gli input del terminale"
```

### Task 2: Rendere osservabile il risultato nel renderer

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `src/App.tsx`
- Test: `test/preload-surface.test.cjs`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `writeTerminalInput`.
- Produces: `terminal.write(data): Promise<TerminalWriteResult>`.

- [ ] **Step 1: Scrivere test fallenti sul passaggio da send a invoke**

```js
assert.match(preload, /write: \(data\) => ipcRenderer\.invoke\('terminal:input', data\)/)
assert.match(main, /ipcMain\.handle\('terminal:input'/)
assert.doesNotMatch(main, /ipcMain\.on\('terminal:input'/)
assert.match(app, /Contenuto non incollato/)
assert.match(app, /result\.reason === 'too-large'/)
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test test/preload-surface.test.cjs test/ui-design-system.test.cjs`

Expected: FAIL perché l'API usa ancora `send` e non mostra feedback.

- [ ] **Step 3: Sostituire l'handler senza risposta**

```js
ipcMain.handle('terminal:input', async (event, data) => {
  assertTrustedSender(event)
  return writeTerminalInput(terminalProcess, data)
})
```

Aggiornare preload e dichiarazione globale affinché `write` ritorni `Promise<TerminalWriteResult>`. Tutti gli invii interattivi da `xterm.onData` devono gestire il rifiuto `not-running` senza generare promise non osservate.

- [ ] **Step 4: Mostrare feedback solo per azioni di incolla/allegato**

```ts
const pasteIntoTerminal = useCallback(async () => {
  const text = await navigator.clipboard.readText()
  if (!text) return
  const result = await window.vincodeLab.terminal.write(text)
  if (!result.accepted) {
    toast.error('Contenuto non incollato', {
      description: result.reason === 'too-large'
        ? `${result.length.toLocaleString('it-IT')} caratteri superano il limite di ${result.limit.toLocaleString('it-IT')}.`
        : 'La sessione Pi non è disponibile.',
    })
  }
  terminal.current?.focus()
}, [])
```

La digitazione normale non deve produrre toast ripetuti. In caso di sessione terminata, aggiornare lo stato esistente una sola volta.

- [ ] **Step 5: Eseguire test mirati e build**

Run: `node --test test/terminal-input.test.cjs test/preload-surface.test.cjs test/ui-design-system.test.cjs && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts src/App.tsx test/preload-surface.test.cjs test/ui-design-system.test.cjs
git commit -m "fix: segnala gli incolla rifiutati nel terminale AI"
```

### Task 3: Regressione completa del terminale

**Files:**
- Modify only if a failing verification identifies a root cause in files already listed.

**Interfaces:**
- Consumes: `terminal.write(data): Promise<TerminalWriteResult>`.
- Produces: evidenza che input interattivi e paste restano integri.

- [ ] **Step 1: Eseguire suite terminali**

Run: `node --test test/terminal-input.test.cjs test/terminal-resize.test.mjs test/terminal-session-history.test.cjs test/ui-design-system.test.cjs`

Expected: PASS.

- [ ] **Step 2: Eseguire suite completa e lint**

Run: `npm test && npm run lint && npm run build`

Expected: tutti i comandi terminano con codice 0.

- [ ] **Step 3: Verifica manuale nel Terminale AI**

Incollare JSON da 10.000, 65.536, 70.000 e 200.001 caratteri. I primi tre devono arrivare integri; l'ultimo deve essere rifiutato prima di qualsiasi scrittura e mostrare dimensione e limite.

- [ ] **Step 4: Verificare focus e sessione**

Dopo un rifiuto, digitare un comando breve. Il cursore deve restare nel terminale, l'output precedente deve restare visibile e Pi deve ricevere il nuovo comando.

- [ ] **Step 5: Controllare lo stato Git**

Run: `git status --short && git diff --check`

Expected: nessuna modifica non intenzionale. Non creare commit vuoti.
