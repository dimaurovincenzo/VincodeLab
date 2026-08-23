# Terminale AI xterm ad alte prestazioni — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere il Terminale AI lossless, reattivo e recuperabile sotto output Pi intensivo, incolla fino a 5 MB e reload del renderer.

**Architecture:** Un controller nel processo principale aggrega l'output PTY in blocchi ordinati, applica backpressure tramite `pause()`/`resume()` e conserva uno storico circolare. Un controller renderer scrive un solo blocco alla volta in xterm e conferma il completamento; un handshake separato ricostruisce la vista dopo reload senza riavviare Pi.

**Tech Stack:** Electron 43, node-pty 1.1, xterm 6, React 19, JavaScript/CJS testabile con `node:test`, TypeScript 6, Vite 8.

**Spec:** `docs/superpowers/specs/2026-08-21-terminale-ai-xterm-performance-design.md`

## Global Constraints

- Una sola sessione Pi per workspace; il PTY rimane nel processo principale.
- Nessun contenuto, comando, output, path o allegato nei log e nei report diagnostici.
- Blocco output: massimo 64 KB oppure massimo 8 ms di aggregazione.
- Sospensione PTY oltre 4 MB di coda; ripresa sotto 1 MB.
- Stato rallentato dopo 2 secondi senza conferma xterm.
- Storico volatile a blocchi: massimo 4 MB.
- Incolla: massimo 5 MB UTF-8, blocchi da massimo 16 KB, cancellazione esplicita.
- Scrollback predefinito invariato a 10.000 righe.
- Nessuna seconda pipeline PTY permanente e nessuna persistenza dell'output su disco.
- WebGL entra nel prodotto solo con miglioramento ripetibile e fallback verificato.
- Nessuna ottimizzazione generale del bundle senza un problema misurabile.
- Main, preload e renderer migrano atomicamente al nuovo protocollo IPC.

## File Structure

- `electron/terminal-history-buffer.cjs`: buffer circolare lossless e limitato per lo snapshot della sessione.
- `electron/terminal-stream-controller.cjs`: batching, sequenze, ACK, backpressure, recovery e metriche main-process.
- `electron/terminal-input.cjs`: input interattivo e trasferimenti di incolla controllati.
- `electron/terminal-diagnostics.cjs`: report diagnostico allowlist, privo di contenuti sensibili.
- `electron/main.cjs`: lifecycle Pi e registrazione IPC; nessuna logica algoritmica nuova oltre al wiring.
- `electron/preload.cjs`: API terminale stretta, tipizzata e senza accesso Node.
- `src/lib/xterm-output-controller.js` + `.d.ts`: serializzazione delle scritture xterm e handshake snapshot.
- `src/lib/terminal-paste-controller.js` + `.d.ts`: chunk UTF-8, progressione e cancellazione dell'incolla.
- `src/components/terminal-paste-status.tsx`: feedback non ambiguo per progressione, annullamento ed errori.
- `src/components/terminal-diagnostics.tsx`: pannello compatto nelle Impostazioni.
- `src/App.tsx`: composizione della vista AI sui controller, senza code parallele locali.
- `src/vincode-lab.d.ts`: contratto IPC condiviso dal renderer.
- `src/styles/views/ai.css` e `src/styles/views/settings.css`: soli stati e layout delle nuove superfici.
- `scripts/benchmark-terminal-stream.mjs`: benchmark ripetibile 1/10/100 MB.
- `test/terminal-*.test.*`: test unitari e di integrazione mirati.

---

### Task 1: Storico circolare a blocchi

**Files:**
- Create: `electron/terminal-history-buffer.cjs`
- Create: `test/terminal-history-buffer.test.cjs`

**Interfaces:**
- Consumes: blocchi `{ sequence: number, data: string, bytes: number }` già ordinati.
- Produces: `createTerminalHistoryBuffer({ maxBytes, byteLength? })` con `append(block)`, `clear()`, `snapshot()` e `size()`.

- [ ] **Step 1: Write the failing tests for bounded append, eviction and Unicode accounting**

```js
// test/terminal-history-buffer.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalHistoryBuffer } = require('../electron/terminal-history-buffer.cjs')

test('espelle blocchi interi e conserva ordine e watermark', () => {
  const history = createTerminalHistoryBuffer({ maxBytes: 6 })
  history.append({ sequence: 1, data: 'abc', bytes: 3 })
  history.append({ sequence: 2, data: 'def', bytes: 3 })
  history.append({ sequence: 3, data: 'ghi', bytes: 3 })
  assert.deepEqual(history.snapshot(), { data: 'defghi', firstSequence: 2, watermark: 3, bytes: 6 })
})

test('misura UTF-8 e non muta i blocchi ricevuti', () => {
  const history = createTerminalHistoryBuffer({ maxBytes: 5 })
  const block = Object.freeze({ sequence: 4, data: '🚀', bytes: 4 })
  history.append(block)
  assert.equal(history.size().bytes, 4)
  assert.equal(history.snapshot().data, '🚀')
})
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `node --test test/terminal-history-buffer.test.cjs`

Expected: FAIL con `MODULE_NOT_FOUND` per `terminal-history-buffer.cjs`.

- [ ] **Step 3: Add the minimal circular buffer**

```js
// electron/terminal-history-buffer.cjs
function createTerminalHistoryBuffer({ maxBytes, byteLength = Buffer.byteLength }) {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('Capacità storico non valida.')
  const blocks = []
  let bytes = 0

  return {
    append(block) {
      const next = { sequence: block.sequence, data: block.data, bytes: block.bytes ?? byteLength(block.data, 'utf8') }
      blocks.push(next)
      bytes += next.bytes
      while (bytes > maxBytes && blocks.length > 1) bytes -= blocks.shift().bytes
    },
    clear() { blocks.length = 0; bytes = 0 },
    size() { return { blocks: blocks.length, bytes } },
    snapshot() {
      return {
        data: blocks.map((block) => block.data).join(''),
        firstSequence: blocks[0]?.sequence ?? 0,
        watermark: blocks.at(-1)?.sequence ?? 0,
        bytes,
      }
    },
  }
}

module.exports = { createTerminalHistoryBuffer }
```

- [ ] **Step 4: Run focused tests and the existing history regression test**

Run: `node --test test/terminal-history-buffer.test.cjs test/terminal-session-history.test.cjs`

Expected: nuovo test PASS; il vecchio test può restare PASS finché il wiring non viene migrato nel Task 3.

- [ ] **Step 5: Commit the isolated data structure**

```bash
git add electron/terminal-history-buffer.cjs test/terminal-history-buffer.test.cjs
git commit -m "feat: aggiunge storico circolare al Terminale AI"
```

### Task 2: Controller output main-process con ACK e backpressure

**Files:**
- Create: `electron/terminal-stream-controller.cjs`
- Create: `test/terminal-stream-controller.test.cjs`
- Modify: `electron/terminal-history-buffer.cjs`
- Modify: `test/terminal-history-buffer.test.cjs`

**Interfaces:**
- Consumes: `createTerminalHistoryBuffer`, un PTY con `pause()`, `resume()` e blocchi da `onData`.
- Produces: `createTerminalStreamController(options)` con `push(data)`, `ack(message)`, `createResumeSnapshot()`, `rendererReady(message)`, `end(status)`, `dispose()`, `waitForInputCapacity()`, `updateRendererMetrics(metrics)` e `getDiagnostics()`.

- [ ] **Step 1: Write failing tests for batching, order, pause/resume, stale ACK and exit flush**

```js
// test/terminal-stream-controller.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalStreamController } = require('../electron/terminal-stream-controller.cjs')

function harness(overrides = {}) {
  const sent = []
  const states = []
  const pty = { pauses: 0, resumes: 0, pause() { this.pauses += 1 }, resume() { this.resumes += 1 } }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'session-a',
    sendBlock: (block) => sent.push(block),
    sendState: (state) => states.push(state),
    limits: { blockBytes: 4, batchMs: 8, pauseBytes: 8, resumeBytes: 3, stallMs: 2_000, historyBytes: 32 },
    ...overrides,
  })
  controller.rendererReady({ sessionId: 'session-a', watermark: 0 })
  return { controller, pty, sent, states }
}

test('invia un solo blocco e aspetta ACK prima del successivo', () => {
  const { controller, sent } = harness()
  controller.push('abcd')
  controller.push('efgh')
  assert.deepEqual(sent.map(({ sequence, data }) => [sequence, data]), [[1, 'abcd']])
  controller.ack({ sessionId: 'session-a', sequence: 1 })
  assert.deepEqual(sent.map(({ sequence, data }) => [sequence, data]), [[1, 'abcd'], [2, 'efgh']])
})

test('applica isteresi e ignora ACK di sessioni obsolete', () => {
  const { controller, pty, sent } = harness()
  controller.push('abcd')
  controller.push('efgh')
  controller.push('ijkl')
  assert.equal(pty.pauses, 1)
  controller.ack({ sessionId: 'old-session', sequence: sent[0].sequence })
  assert.equal(pty.resumes, 0)
  controller.ack({ sessionId: 'session-a', sequence: 1 })
  controller.ack({ sessionId: 'session-a', sequence: 2 })
  controller.ack({ sessionId: 'session-a', sequence: 3 })
  assert.equal(pty.resumes, 1)
})

test('include il blocco parziale nello snapshot finale', () => {
  const { controller } = harness()
  controller.push('abc')
  controller.end({ exitCode: 0, signal: 0 })
  assert.equal(controller.createResumeSnapshot().snapshot.data, 'abc')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/terminal-stream-controller.test.cjs`

Expected: FAIL con `MODULE_NOT_FOUND`.

- [ ] **Step 3: Add the controller state machine and exact defaults**

```js
// electron/terminal-stream-controller.cjs
const { createTerminalHistoryBuffer } = require('./terminal-history-buffer.cjs')

const TERMINAL_STREAM_LIMITS = Object.freeze({
  blockBytes: 64 * 1024,
  batchMs: 8,
  pauseBytes: 4 * 1024 * 1024,
  resumeBytes: 1 * 1024 * 1024,
  stallMs: 2_000,
  historyBytes: 4 * 1024 * 1024,
})

function createTerminalStreamController({ pty, sessionId, sendBlock, sendState, limits = TERMINAL_STREAM_LIMITS, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
  const history = createTerminalHistoryBuffer({ maxBytes: limits.historyBytes })
  const queue = []
  const inputWaiters = []
  let pending = ''
  let pendingBytes = 0
  let sequence = 0
  let queuedBytes = 0
  let inFlight = null
  let batchTimer = null
  let stallTimer = null
  let rendererReady = false
  let pausedForPressure = false
  let pausedForStall = false
  let ptyPaused = false
  let disposed = false
  let endedStatus
  let receivedBytes = 0
  let renderedBytes = 0
  let blockCount = 0
  let maxBlockBytes = 0
  let peakQueuedBytes = 0
  let pauseCount = 0
  let pausedSince = null
  let pausedMs = 0
  let rendererMetrics = {}

  const setStatus = (status) => sendState({ sessionId, status, queuedBytes })
  const syncPty = () => {
    const shouldPause = pausedForPressure || pausedForStall
    if (shouldPause && !ptyPaused) { pty.pause(); ptyPaused = true; pausedSince = now(); pauseCount += 1 }
    if (!shouldPause && ptyPaused) {
      pty.resume()
      ptyPaused = false
      pausedMs += Math.max(0, now() - pausedSince)
      pausedSince = null
    }
    if (!shouldPause) inputWaiters.splice(0).forEach((resolve) => resolve())
  }
  const updatePressure = () => {
    if (queuedBytes > limits.pauseBytes) pausedForPressure = true
    if (queuedBytes < limits.resumeBytes) pausedForPressure = false
    syncPty()
    if (pausedForPressure) setStatus('paused')
  }
  const pump = () => {
    if (disposed || !rendererReady || inFlight || queue.length === 0) return
    inFlight = queue[0]
    sendBlock({ sessionId, sequence: inFlight.sequence, data: inFlight.data })
    stallTimer = setTimer(() => {
      pausedForStall = true
      syncPty()
      setStatus('stalled')
    }, limits.stallMs)
  }
  const enqueue = (data) => {
    const block = { sequence: ++sequence, data, bytes: Buffer.byteLength(data, 'utf8') }
    blockCount += 1
    maxBlockBytes = Math.max(maxBlockBytes, block.bytes)
    history.append(block)
    queue.push(block)
    queuedBytes += block.bytes
    peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes)
    updatePressure()
    pump()
  }
  const flushBatch = () => {
    if (batchTimer) clearTimer(batchTimer)
    batchTimer = null
    if (!pending) return
    const data = pending
    pending = ''
    pendingBytes = 0
    enqueue(data)
  }
  const push = (data) => {
    if (disposed || typeof data !== 'string' || data.length === 0) return
    receivedBytes += Buffer.byteLength(data, 'utf8')
    for (const character of data) {
      const characterBytes = Buffer.byteLength(character, 'utf8')
      if (pending && pendingBytes + characterBytes > limits.blockBytes) flushBatch()
      pending += character
      pendingBytes += characterBytes
    }
    if (pendingBytes >= limits.blockBytes) flushBatch()
    else if (!batchTimer) batchTimer = setTimer(flushBatch, limits.batchMs)
  }
  const ack = (message) => {
    if (disposed || message?.sessionId !== sessionId || message.sequence !== inFlight?.sequence) return false
    if (stallTimer) clearTimer(stallTimer)
    stallTimer = null
    pausedForStall = false
    const block = queue.shift()
    queuedBytes -= block.bytes
    renderedBytes += block.bytes
    inFlight = null
    updatePressure()
    setStatus(endedStatus && queue.length === 0 ? 'ended' : 'running')
    pump()
    return true
  }
  const createResumeSnapshot = () => {
    flushBatch()
    rendererReady = false
    if (stallTimer) clearTimer(stallTimer)
    stallTimer = null
    inFlight = null
    pausedForStall = false
    syncPty()
    setStatus('recovering')
    return { sessionId, snapshot: history.snapshot(), status: endedStatus ? 'ended' : 'recovering', exitStatus: endedStatus }
  }
  const markRendererReady = (message) => {
    if (message?.sessionId !== sessionId) return false
    while (queue[0] && queue[0].sequence <= message.watermark) {
      const block = queue.shift()
      queuedBytes -= block.bytes
      renderedBytes += block.bytes
    }
    rendererReady = true
    updatePressure()
    setStatus(endedStatus && queue.length === 0 ? 'ended' : 'running')
    pump()
    return true
  }
  const waitForInputCapacity = () => pausedForPressure || pausedForStall
    ? new Promise((resolve) => inputWaiters.push(resolve))
    : Promise.resolve()
  const end = (status) => { flushBatch(); endedStatus = status; if (queue.length === 0) setStatus('ended') }
  const dispose = () => {
    disposed = true
    if (batchTimer) clearTimer(batchTimer)
    if (stallTimer) clearTimer(stallTimer)
    if (ptyPaused) {
      pty.resume()
      ptyPaused = false
      pausedMs += Math.max(0, now() - pausedSince)
      pausedSince = null
    }
    inputWaiters.splice(0).forEach((resolve) => resolve())
    queue.length = 0
    history.clear()
  }
  const updateRendererMetrics = (metrics) => { rendererMetrics = { ...metrics } }
  const getDiagnostics = () => ({
    receivedBytes,
    renderedBytes,
    queuedBytes,
    peakQueuedBytes,
    averageBlockBytes: blockCount === 0 ? 0 : receivedBytes / blockCount,
    maxBlockBytes,
    pauseCount,
    pausedMs: pausedMs + (ptyPaused ? Math.max(0, now() - pausedSince) : 0),
    renderer: rendererMetrics,
  })

  return { push, ack, createResumeSnapshot, rendererReady: markRendererReady, waitForInputCapacity, end, dispose, updateRendererMetrics, getDiagnostics }
}

module.exports = { TERMINAL_STREAM_LIMITS, createTerminalStreamController }
```

Keep the `for…of` split so surrogate pairs stay intact. `pendingBytes` makes batching linear in the input size and avoids repeatedly measuring the whole pending string. `queuedBytes` includes the in-flight block and `updateRendererMetrics` accepts only the numeric allowlist later defined in Task 7.

- [ ] **Step 4: Add deterministic timer tests for 8 ms batching and 2 s stall**

```js
test('chiude un blocco parziale dopo 8 ms e sospende su stall', () => {
  const timers = []
  const { controller, pty, sent, states } = harness({
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
  })
  controller.push('ab')
  timers.find((timer) => timer.ms === 8).fn()
  assert.equal(sent[0].data, 'ab')
  timers.find((timer) => timer.ms === 2_000).fn()
  assert.equal(pty.pauses, 1)
  assert.equal(states.at(-1).status, 'stalled')
})
```

- [ ] **Step 5: Run controller and buffer tests**

Run: `node --test test/terminal-history-buffer.test.cjs test/terminal-stream-controller.test.cjs`

Expected: PASS; nessuna coda supera `pauseBytes + blockBytes` prima della sospensione.

- [ ] **Step 6: Commit the main-process controller**

```bash
git add electron/terminal-history-buffer.cjs electron/terminal-stream-controller.cjs test/terminal-history-buffer.test.cjs test/terminal-stream-controller.test.cjs
git commit -m "feat: controlla output Pi con backpressure lossless"
```

### Task 3: Migrazione atomica del protocollo IPC output

**Files:**
- Modify: `electron/main.cjs:35-230,805-820,1015-1028`
- Modify: `electron/preload.cjs:198-214`
- Modify: `src/vincode-lab.d.ts:1-25,371-379`
- Modify: `test/terminal-session-history.test.cjs`
- Modify: `test/preload-surface.test.cjs`
- Create: `test/terminal-stream-ipc.test.cjs`

**Interfaces:**
- Consumes: `createTerminalStreamController` dal Task 2.
- Produces: `terminal.resume()`, `terminal.ready()`, `terminal.ack()`, `terminal.onOutput()` e `terminal.onStreamState()`; rimuove `terminal.history()` e `terminal.onData()`.

- [ ] **Step 1: Replace source-shape expectations with the new protocol**

```js
// test/terminal-stream-ipc.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('main preload e tipi usano resume ACK e sequenze senza lo storico stringa', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  assert.match(main, /createTerminalStreamController/)
  assert.match(main, /ipcMain\.handle\('terminal:resume'/)
  assert.match(main, /ipcMain\.on\('terminal:ack'/)
  assert.match(preload, /resume: \(request\) => ipcRenderer\.invoke\('terminal:resume', request\)/)
  assert.match(preload, /ack: \(message\) => ipcRenderer\.send\('terminal:ack', message\)/)
  assert.doesNotMatch(main, /terminalOutputHistory/)
  assert.doesNotMatch(preload, /terminal:history/)
})
```

- [ ] **Step 2: Run IPC surface tests and verify failure against the old API**

Run: `node --test test/terminal-stream-ipc.test.cjs test/preload-surface.test.cjs test/terminal-session-history.test.cjs`

Expected: FAIL perché `terminal:history` è ancora presente e `terminal:resume` manca.

- [ ] **Step 3: Define the renderer contract types**

```ts
// src/vincode-lab.d.ts
type TerminalStreamStatus = 'running' | 'paused' | 'stalled' | 'recovering' | 'ended'
type TerminalOutputBlock = { sessionId: string; sequence: number; data: string }
type TerminalOutputAck = { sessionId: string; sequence: number }
type TerminalResumeSnapshot = {
  sessionId: string
  snapshot: { data: string; firstSequence: number; watermark: number; bytes: number }
  status: TerminalStreamStatus
  exitStatus?: TerminalExitStatus
}
type TerminalStreamState = { sessionId: string; status: TerminalStreamStatus; queuedBytes: number }
```

```ts
terminal: {
  resume: (request: { knownSessionId?: string; lastAcknowledgedSequence?: number }) => Promise<TerminalResumeSnapshot>
  ready: (message: { sessionId: string; watermark: number }) => void
  ack: (message: TerminalOutputAck) => void
  onOutput: (listener: (block: TerminalOutputBlock) => void) => () => void
  onStreamState: (listener: (state: TerminalStreamState) => void) => () => void
  // Existing attachment, resize and exit members remain unchanged.
}
```

- [ ] **Step 4: Wire one controller to the Pi lifecycle**

```js
// electron/main.cjs
const { createTerminalStreamController } = require('./terminal-stream-controller.cjs')
let terminalStream

function stopTerminal() {
  terminalStream?.dispose()
  terminalStream = undefined
  // Kill the same PTY after invalidating timers and queued deliveries.
}

// Inside startPi, after pty.spawn:
terminalStream = createTerminalStreamController({
  pty: ptyProcess,
  sessionId: randomUUID(),
  sendBlock: (block) => sendToRenderer('terminal:output', block),
  sendState: (state) => sendToRenderer('terminal:streamState', state),
})
ptyProcess.onData((data) => terminalStream?.push(data))
```

Register `terminal:resume` with `ipcMain.handle`; register `terminal:ready` and `terminal:ack` with `ipcMain.on`; call `assertTrustedSender` before every controller method. `onExit` calls `terminalStream.end({ exitCode, signal })` before publishing the final state.

- [ ] **Step 5: Replace preload history/data members with typed output members**

```js
// electron/preload.cjs
resume: (request) => ipcRenderer.invoke('terminal:resume', request),
ready: (message) => ipcRenderer.send('terminal:ready', message),
ack: (message) => ipcRenderer.send('terminal:ack', message),
onOutput: (listener) => {
  const handler = (_event, block) => listener(block)
  ipcRenderer.on('terminal:output', handler)
  return () => ipcRenderer.removeListener('terminal:output', handler)
},
onStreamState: (listener) => {
  const handler = (_event, state) => listener(state)
  ipcRenderer.on('terminal:streamState', handler)
  return () => ipcRenderer.removeListener('terminal:streamState', handler)
},
```

- [ ] **Step 6: Run IPC and existing security-surface tests**

Run: `node --test test/terminal-stream-ipc.test.cjs test/preload-surface.test.cjs test/terminal-session-history.test.cjs`

Expected: PASS; nessuna API Node o oggetto PTY compare nel preload.

- [ ] **Step 7: Commit the atomic IPC migration**

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/terminal-stream-ipc.test.cjs test/terminal-session-history.test.cjs test/preload-surface.test.cjs
git commit -m "refactor: migra il Terminale AI al protocollo output sequenziale"
```

### Task 4: Controller renderer per scritture xterm seriali

**Files:**
- Create: `src/lib/xterm-output-controller.js`
- Create: `src/lib/xterm-output-controller.d.ts`
- Create: `test/xterm-output-controller.test.mjs`

**Interfaces:**
- Consumes: `TerminalOutputBlock` e `TerminalResumeSnapshot` dal Task 3, una funzione `write(data, callback)` compatibile con xterm.
- Produces: `createXtermOutputController({ write, ack, ready, onRendered, onWriteError, now? })` con `accept(block)`, `restore(snapshot)`, `dispose()` e `metrics()`.

- [ ] **Step 1: Write failing serialisation and recovery tests**

```js
// test/xterm-output-controller.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { createXtermOutputController } from '../src/lib/xterm-output-controller.js'

test('conferma un blocco solo dal callback xterm', () => {
  const callbacks = []
  const acknowledgements = []
  const controller = createXtermOutputController({
    write: (_data, done) => callbacks.push(done),
    ack: (message) => acknowledgements.push(message),
    ready: () => {},
    onRendered: () => {},
    onWriteError: assert.fail,
  })
  controller.restore({ sessionId: 's1', snapshot: { data: '', watermark: 0, firstSequence: 0, bytes: 0 }, status: 'running' })
  controller.accept({ sessionId: 's1', sequence: 1, data: 'uno' })
  controller.accept({ sessionId: 's1', sequence: 2, data: 'due' })
  assert.deepEqual(acknowledgements, [])
  callbacks.shift()()
  assert.deepEqual(acknowledgements, [{ sessionId: 's1', sequence: 1 }])
  callbacks.shift()()
  assert.deepEqual(acknowledgements.at(-1), { sessionId: 's1', sequence: 2 })
})

test('scrive snapshot prima di dichiarare pronto il renderer', () => {
  const events = []
  const controller = createXtermOutputController({
    write: (data, done) => { events.push(['write', data]); done() },
    ack: () => {},
    ready: (message) => events.push(['ready', message.watermark]),
    onRendered: () => {},
    onWriteError: assert.fail,
  })
  controller.restore({ sessionId: 's2', snapshot: { data: 'storico', watermark: 7, firstSequence: 2, bytes: 7 }, status: 'running' })
  assert.deepEqual(events, [['write', 'storico'], ['ready', 7]])
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test test/xterm-output-controller.test.mjs`

Expected: FAIL con `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Add the serial renderer controller**

```js
// src/lib/xterm-output-controller.js
export function createXtermOutputController({ write, ack, ready, onRendered, onWriteError, now = performance.now.bind(performance) }) {
  let sessionId
  let disposed = false
  let writing = false
  let restoreCount = 0
  const queue = []
  const latencies = []

  function pump() {
    if (disposed || writing || queue.length === 0) return
    const block = queue[0]
    writing = true
    const startedAt = now()
    try {
      write(block.data, () => {
        if (disposed) return
        queue.shift()
        writing = false
        latencies.push(now() - startedAt)
        ack({ sessionId: block.sessionId, sequence: block.sequence })
        onRendered(block)
        pump()
      })
    } catch (error) {
      writing = false
      onWriteError(error)
    }
  }
  function accept(block) {
    if (disposed || block?.sessionId !== sessionId) return false
    queue.push(block)
    pump()
    return true
  }
  function restore(payload) {
    if (disposed) return false
    restoreCount += 1
    sessionId = payload.sessionId
    queue.length = 0
    writing = false
    const announceReady = () => ready({ sessionId, watermark: payload.snapshot.watermark })
    if (!payload.snapshot.data) announceReady()
    else {
      try { write(payload.snapshot.data, announceReady) }
      catch (error) { onWriteError(error) }
    }
    return true
  }
  function percentile(values, ratio) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
  }
  function metrics() {
    return {
      queuedBlocks: queue.length,
      ackP50Ms: percentile(latencies, 0.5),
      ackP95Ms: percentile(latencies, 0.95),
      ackP99Ms: percentile(latencies, 0.99),
      slowFrames: latencies.filter((value) => value > 16.7).length,
      restoreCount,
      mode: 'standard',
    }
  }
  function dispose() { disposed = true; queue.length = 0 }
  return { accept, restore, dispose, metrics }
}
```

- [ ] **Step 4: Add tests for obsolete sessions, disposal and write exceptions**

```js
test('ignora sessioni obsolete e conserva il blocco su errore sincrono', () => {
  let attempts = 0
  const errors = []
  const controller = createXtermOutputController({
    write: () => { attempts += 1; throw new Error('renderer unavailable') },
    ack: () => assert.fail('ACK non ammesso'),
    ready: () => {},
    onRendered: () => {},
    onWriteError: (error) => errors.push(error.message),
  })
  controller.restore({ sessionId: 'active', snapshot: { data: '', watermark: 0, firstSequence: 0, bytes: 0 }, status: 'running' })
  assert.equal(controller.accept({ sessionId: 'obsolete', sequence: 1, data: 'ignored' }), false)
  controller.accept({ sessionId: 'active', sequence: 1, data: 'x' })
  assert.equal(attempts, 1)
  assert.deepEqual(errors, ['renderer unavailable'])
  assert.equal(controller.metrics().queuedBlocks, 1)
})
```

- [ ] **Step 5: Run renderer controller tests**

Run: `node --test test/xterm-output-controller.test.mjs`

Expected: PASS con ACK ordinati e nessun dato di contenuto nelle metriche.

- [ ] **Step 6: Commit the renderer controller**

```bash
git add src/lib/xterm-output-controller.js src/lib/xterm-output-controller.d.ts test/xterm-output-controller.test.mjs
git commit -m "feat: serializza il rendering xterm con conferme"
```

### Task 5: Collegamento xterm della vista AI e recovery visibile

**Files:**
- Modify: `src/App.tsx:40-146,446-481,550-620,690-725`
- Modify: `src/styles/views/ai.css`
- Modify: `test/ui-design-system.test.cjs`
- Create: `test/terminal-ai-stream-ui.test.cjs`

**Interfaces:**
- Consumes: API preload Task 3 e `createXtermOutputController` Task 4.
- Produces: una sola pipeline xterm attiva, stato “Rendering rallentato”, restore dopo reload e metriche renderer pronte per il Task 7.

- [ ] **Step 1: Write source-level regression tests that forbid the lossy queue**

```js
// test/terminal-ai-stream-ui.test.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('la vista AI usa il controller sequenziale senza scarto locale', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(app, /createXtermOutputController/)
  assert.match(app, /terminal\.resume\(/)
  assert.match(app, /terminal\.onOutput\(/)
  assert.match(app, /Rendering rallentato/)
  assert.doesNotMatch(app, /MAX_PENDING_TERMINAL_OUTPUT|pendingOutputBytes|queueTerminalOutput/)
})
```

- [ ] **Step 2: Run the UI regression test and verify failure**

Run: `node --test test/terminal-ai-stream-ui.test.cjs`

Expected: FAIL perché la vecchia coda è ancora presente.

- [ ] **Step 3: Replace the App-level queue with one controller ref**

```tsx
// src/App.tsx
const outputController = useRef<ReturnType<typeof createXtermOutputController> | null>(null)
const [streamState, setStreamState] = useState<TerminalStreamState | null>(null)
const [terminalRendererGeneration, setTerminalRendererGeneration] = useState(0)

// After xterm.open:
const controller = createXtermOutputController({
  write: (data, done) => xterm.write(data, done),
  ack: window.vincodeLab.terminal.ack,
  ready: window.vincodeLab.terminal.ready,
  onRendered: () => {
    if (shouldFollowTerminalOutput({ viewportY: xterm.buffer.active.viewportY, baseY: xterm.buffer.active.baseY })) xterm.scrollToBottom()
    else setHasUnreadTerminalOutput(true)
  },
  onWriteError: () => setTerminalRendererGeneration((value) => value + 1),
})
outputController.current = controller
const offOutput = window.vincodeLab.terminal.onOutput((block) => controller.accept(block))
const offState = window.vincodeLab.terminal.onStreamState(setStreamState)
void window.vincodeLab.terminal.resume({}).then((snapshot) => controller.restore(snapshot))
```

Add `terminalRendererGeneration` to the xterm setup effect dependencies. Cleanup disposes controller and listeners but does not call `pi.restart`, `stopTerminal` or recreate the PTY. A write error increments only the renderer generation; the next handshake recovers the retained block from main. Remove `MAX_PENDING_TERMINAL_OUTPUT`, `pendingOutput`, `pendingOutputBytes`, `outputFrame`, `flushTerminalOutput`, `queueTerminalOutput` and `terminal.history()`.

- [ ] **Step 4: Render an accessible slow-rendering state without blocking controls**

```tsx
{(streamState?.status === 'paused' || streamState?.status === 'stalled') && (
  <div className="terminal-stream-status" role="status">
    <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
    Rendering rallentato · recupero automatico in corso
  </div>
)}
```

```css
/* src/styles/views/ai.css */
.terminal-stream-status {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--state-warning);
  font-size: var(--type-meta);
}
```

- [ ] **Step 5: Run focused UI tests, typecheck and lint**

Run: `node --test test/terminal-ai-stream-ui.test.cjs test/ui-design-system.test.cjs`

Run: `npm run build`

Run: `npm run lint`

Expected: PASS; nessun riferimento alla vecchia coda lossless compare in `src/App.tsx`.

- [ ] **Step 6: Manually exercise reload and tab preservation in dev**

Run: `npm run dev`

Expected: avviare output continuo, passare AI → Editor → AI e ricaricare il renderer; Pi mantiene la sessione, lo snapshot precede l'output live e la toolbar resta operativa.

- [ ] **Step 7: Commit the AI view migration**

```bash
git add src/App.tsx src/styles/views/ai.css test/terminal-ai-stream-ui.test.cjs test/ui-design-system.test.cjs
git commit -m "feat: rende recuperabile il rendering del Terminale AI"
```

### Task 6: Input interattivo a bassa latenza e incolla controllata da 5 MB

**Files:**
- Modify: `electron/terminal-input.cjs`
- Modify: `electron/main.cjs:1015-1018`
- Modify: `electron/preload.cjs:198-214`
- Modify: `src/vincode-lab.d.ts:1-25,371-379`
- Create: `src/lib/terminal-paste-controller.js`
- Create: `src/lib/terminal-paste-controller.d.ts`
- Create: `src/components/terminal-paste-status.tsx`
- Modify: `src/App.tsx:214-231,601-605,690-725`
- Modify: `src/styles/views/ai.css`
- Modify: `test/terminal-input.test.cjs`
- Create: `test/terminal-paste-controller.test.mjs`
- Modify: `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: `terminalStream.waitForInputCapacity()` dal Task 2.
- Produces: `writeTerminalKey(pty, data)`, `createTerminalInputController(options)`, preload `writeKey`, `startPaste`, `writePasteChunk`, `cancelPaste`; renderer `createTerminalPasteController(options)`.

- [ ] **Step 1: Replace 200 KB tests with explicit key and 5 MB paste contracts**

```js
// test/terminal-input.test.cjs
const { createTerminalInputController, writeTerminalKey } = require('../electron/terminal-input.cjs')

test('accetta una sequenza interattiva breve senza round-trip', () => {
  const writes = []
  assert.equal(writeTerminalKey({ write: (data) => writes.push(data) }, '\x1b[A'), true)
  assert.deepEqual(writes, ['\x1b[A'])
})

test('trasferisce al massimo 5 MB in blocchi ordinati e cancellabili', async () => {
  const writes = []
  const input = createTerminalInputController({ getPty: () => ({ write: (data) => writes.push(data) }), waitForCapacity: async () => {} })
  const transfer = input.start({ totalBytes: 12 })
  await input.chunk({ transferId: transfer.transferId, index: 0, data: 'Città ' })
  const result = input.cancel(transfer.transferId)
  assert.equal(result.cancelled, true)
  assert.equal(result.sentBytes, Buffer.byteLength('Città ', 'utf8'))
  assert.equal(writes.join(''), 'Città ')
})
```

- [ ] **Step 2: Run terminal input tests and verify failure**

Run: `node --test test/terminal-input.test.cjs`

Expected: FAIL perché le nuove funzioni non sono esportate.

- [ ] **Step 3: Add the main-process input controller**

```js
// electron/terminal-input.cjs
const { randomUUID } = require('node:crypto')
const MAX_PASTE_BYTES = 5 * 1024 * 1024
const MAX_PASTE_CHUNK_BYTES = 16 * 1024
const MAX_KEY_BYTES = 64 * 1024

function writeTerminalKey(pty, data) {
  if (!pty || typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > MAX_KEY_BYTES) return false
  pty.write(data)
  return true
}

function createTerminalInputController({ getPty, waitForCapacity, createId = randomUUID }) {
  const transfers = new Map()
  const metrics = { startedPastes: 0, completedPastes: 0, cancelledPastes: 0, rejectedPastes: 0, pasteAcceptedBytes: 0 }
  function start({ totalBytes }) {
    if (!Number.isInteger(totalBytes) || totalBytes < 0) { metrics.rejectedPastes += 1; return { accepted: false, reason: 'invalid', limit: MAX_PASTE_BYTES } }
    if (totalBytes > MAX_PASTE_BYTES) { metrics.rejectedPastes += 1; return { accepted: false, reason: 'too-large', totalBytes, limit: MAX_PASTE_BYTES } }
    if (!getPty()) { metrics.rejectedPastes += 1; return { accepted: false, reason: 'not-running', totalBytes, limit: MAX_PASTE_BYTES } }
    const transferId = createId()
    transfers.set(transferId, { totalBytes, sentBytes: 0, nextIndex: 0 })
    metrics.startedPastes += 1
    return { accepted: true, transferId, totalBytes }
  }
  async function chunk({ transferId, index, data }) {
    const transfer = transfers.get(transferId)
    if (!transfer) return { accepted: false, reason: 'not-found' }
    const bytes = typeof data === 'string' ? Buffer.byteLength(data, 'utf8') : -1
    if (index !== transfer.nextIndex || bytes < 0 || bytes > MAX_PASTE_CHUNK_BYTES || transfer.sentBytes + bytes > transfer.totalBytes) {
      transfers.delete(transferId)
      return { accepted: false, reason: 'invalid-chunk', sentBytes: transfer.sentBytes }
    }
    await waitForCapacity()
    if (!transfers.has(transferId)) return { accepted: false, reason: 'cancelled', sentBytes: transfer.sentBytes }
    const pty = getPty()
    if (!pty) { transfers.delete(transferId); return { accepted: false, reason: 'not-running', sentBytes: transfer.sentBytes } }
    pty.write(data)
    transfer.sentBytes += bytes
    metrics.pasteAcceptedBytes += bytes
    transfer.nextIndex += 1
    const complete = transfer.sentBytes === transfer.totalBytes
    if (complete) { transfers.delete(transferId); metrics.completedPastes += 1 }
    return { accepted: true, complete, sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
  }
  function cancel(transferId) {
    const transfer = transfers.get(transferId)
    if (!transfer) return { cancelled: false, sentBytes: 0 }
    transfers.delete(transferId)
    metrics.cancelledPastes += 1
    return { cancelled: true, sentBytes: transfer.sentBytes, totalBytes: transfer.totalBytes }
  }
  const getDiagnostics = () => ({ ...metrics })
  return { start, chunk, cancel, getDiagnostics }
}

module.exports = { MAX_PASTE_BYTES, MAX_PASTE_CHUNK_BYTES, createTerminalInputController, writeTerminalKey }
```

- [ ] **Step 4: Add typed IPC for keys and paste lifecycle**

```js
// electron/preload.cjs
writeKey: (data) => ipcRenderer.send('terminal:key', data),
startPaste: (input) => ipcRenderer.invoke('terminal:pasteStart', input),
writePasteChunk: (input) => ipcRenderer.invoke('terminal:pasteChunk', input),
cancelPaste: (transferId) => ipcRenderer.invoke('terminal:pasteCancel', transferId),
```

Main registers `terminal:key` with `ipcMain.on`, while paste start/chunk/cancel use `ipcMain.handle` for validation and progress results. Remove `terminal:input` and the old `write()` preload member in the same commit.

Create one `terminalInput` alongside `terminalStream` when Pi starts, using `getPty: () => ptyProcess` and `waitForCapacity: () => terminalStream.waitForInputCapacity()`. Clear its reference in `stopTerminal()` after invalidating active transfers. This keeps paste progress and diagnostics scoped to the same Pi session.

- [ ] **Step 5: Write failing UTF-8 renderer chunk tests**

```js
// test/terminal-paste-controller.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalPasteController, splitUtf8Chunks } from '../src/lib/terminal-paste-controller.js'

test('non spezza surrogate pair e rispetta il limite byte', () => {
  const chunks = [...splitUtf8Chunks('a🚀b'.repeat(20), 9)]
  assert.equal(chunks.join(''), 'a🚀b'.repeat(20))
  assert.ok(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 9))
})

test('consegna integralmente Unicode da 200 KB, 1 MB e 5 MB', async () => {
  for (const totalBytes of [200 * 1024, 1024 * 1024, 5 * 1024 * 1024]) {
    const text = 'è'.repeat(totalBytes / 2)
    let acceptedBytes = 0
    const received = []
    const controller = createTerminalPasteController({
      startPaste: async (input) => ({ accepted: true, transferId: `paste-${input.totalBytes}` }),
      writePasteChunk: async ({ data }) => {
        received.push(data)
        acceptedBytes += new TextEncoder().encode(data).byteLength
        return { accepted: true, complete: acceptedBytes === totalBytes, sentBytes: acceptedBytes }
      },
      cancelPaste: async () => ({ sentBytes: acceptedBytes }),
    })
    const result = await controller.send(text, () => {})
    assert.equal(result.status, 'complete')
    assert.equal(result.sentBytes, totalBytes)
    assert.equal(received.join(''), text)
  }
})
```

- [ ] **Step 6: Add renderer paste controller and status component**

```js
// src/lib/terminal-paste-controller.js
export function* splitUtf8Chunks(text, maxBytes = 16 * 1024) {
  let chunk = ''
  let bytes = 0
  for (const character of text) {
    const nextBytes = new TextEncoder().encode(character).byteLength
    if (chunk && bytes + nextBytes > maxBytes) { yield chunk; chunk = ''; bytes = 0 }
    chunk += character
    bytes += nextBytes
  }
  if (chunk) yield chunk
}

export function createTerminalPasteController({ startPaste, writePasteChunk, cancelPaste }) {
  let active = null
  async function send(text, onProgress) {
    const totalBytes = new TextEncoder().encode(text).byteLength
    if (active) {
      const failed = { status: 'failed', reason: 'busy', sentBytes: 0, totalBytes }
      onProgress(failed)
      return failed
    }
    const started = await startPaste({ totalBytes })
    if (!started.accepted) {
      const failed = { status: 'failed', reason: started.reason, sentBytes: 0, totalBytes, limit: started.limit }
      onProgress(failed)
      return failed
    }
    const transfer = { transferId: started.transferId, cancelled: false, sentBytes: 0, totalBytes }
    active = transfer
    onProgress({ status: 'running', sentBytes: 0, totalBytes })
    let index = 0
    for (const data of splitUtf8Chunks(text)) {
      if (transfer.cancelled) break
      const result = await writePasteChunk({ transferId: transfer.transferId, index, data })
      if (transfer.cancelled) break
      if (!result.accepted) {
        const failed = { status: 'failed', reason: result.reason, sentBytes: result.sentBytes ?? transfer.sentBytes, totalBytes }
        if (active === transfer) active = null
        onProgress(failed)
        return failed
      }
      transfer.sentBytes = result.sentBytes
      index += 1
      onProgress({ status: result.complete ? 'complete' : 'running', sentBytes: result.sentBytes, totalBytes })
    }
    if (transfer.cancelled) return { status: 'cancelled', sentBytes: transfer.sentBytes, totalBytes }
    const completed = { status: 'complete', sentBytes: transfer.sentBytes, totalBytes }
    if (active === transfer) active = null
    onProgress(completed)
    return completed
  }
  async function cancel(onProgress) {
    if (!active) return null
    const transfer = active
    transfer.cancelled = true
    const result = await cancelPaste(transfer.transferId)
    transfer.sentBytes = result.sentBytes
    const cancelled = { status: 'cancelled', sentBytes: result.sentBytes, totalBytes: transfer.totalBytes }
    if (active === transfer) active = null
    onProgress(cancelled)
    return cancelled
  }
  return { send, cancel }
}
```

```tsx
// src/components/terminal-paste-status.tsx
export function TerminalPasteStatus({ progress, onCancel, onClose }: Props) {
  if (!progress) return null
  return <div className="terminal-paste-status" role={progress.status === 'failed' ? 'alertdialog' : 'status'} aria-modal={progress.status === 'failed' || undefined}>
    <strong>{progress.status === 'failed' ? 'Contenuto non incollato' : 'Incolla nel Terminale AI'}</strong>
    <span>{progress.sentBytes.toLocaleString('it-IT')} / {progress.totalBytes.toLocaleString('it-IT')} byte</span>
    {progress.status === 'running' ? <button onClick={onCancel}>Annulla</button> : <button onClick={onClose}>Chiudi</button>}
  </div>
}
```

The controller above streams chunks sequentially, exposes `{ status, sentBytes, totalBytes }`, stops scheduling after cancel and returns the exact byte count already accepted by main.

- [ ] **Step 7: Connect xterm keys and clipboard paste in App**

```tsx
const inputDisposable = xterm.onData(window.vincodeLab.terminal.writeKey)

const pasteIntoTerminal = useCallback(async () => {
  const text = await navigator.clipboard.readText()
  await pasteController.current?.send(text, setPasteProgress)
  terminal.current?.focus()
}, [])
```

If UTF-8 size exceeds 5 MB, show the modal state with the actual size and limit; do not send a prefix. Attachments continue to call `writeKey(reference)` because they contain only the validated `@path` reference.

- [ ] **Step 8: Run input, preload, UI, build and lint checks**

Run: `node --test test/terminal-input.test.cjs test/terminal-paste-controller.test.mjs test/preload-surface.test.cjs test/terminal-ai-stream-ui.test.cjs`

Run: `npm run build`

Run: `npm run lint`

Expected: PASS; the old `terminal:input` invoke channel is absent.

- [ ] **Step 9: Commit the controlled input path**

```bash
git add electron/terminal-input.cjs electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts src/lib/terminal-paste-controller.js src/lib/terminal-paste-controller.d.ts src/components/terminal-paste-status.tsx src/App.tsx src/styles/views/ai.css test/terminal-input.test.cjs test/terminal-paste-controller.test.mjs test/preload-surface.test.cjs
git commit -m "feat: gestisce incolla Pi voluminosi con avanzamento"
```

### Task 7: Diagnostica tecnica privacy-safe nelle Impostazioni

**Files:**
- Create: `electron/terminal-diagnostics.cjs`
- Create: `test/terminal-diagnostics.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `src/App.tsx`
- Create: `src/components/terminal-diagnostics.tsx`
- Modify: `src/components/settings.tsx:1-20,154-170`
- Modify: `src/styles/views/settings.css`
- Modify: `test/settings-ui.test.cjs`
- Modify: `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: `terminalStream.getDiagnostics()` e metriche numeriche del controller renderer.
- Produces: `terminal.diagnostics()`, `terminal.reportRendererMetrics(metrics)`, `terminal.exportDiagnostics()` e `<TerminalDiagnostics />`.

- [ ] **Step 1: Write a failing allowlist/privacy test**

```js
// test/terminal-diagnostics.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalDiagnosticsReport } = require('../electron/terminal-diagnostics.cjs')

test('esporta solo metriche numeriche consentite', () => {
  const report = createTerminalDiagnosticsReport({
    sessionId: 'secret-session', queuedBytes: 12, peakQueuedBytes: 24,
    command: 'token=secret', output: 'password', renderer: { ackP95Ms: 7 },
  })
  const json = JSON.stringify(report)
  assert.equal(report.pipeline.queuedBytes, 12)
  assert.equal(report.renderer.ackP95Ms, 7)
  assert.doesNotMatch(json, /secret-session|token|password/)
})
```

- [ ] **Step 2: Run the diagnostic test and verify failure**

Run: `node --test test/terminal-diagnostics.test.cjs`

Expected: FAIL con `MODULE_NOT_FOUND`.

- [ ] **Step 3: Add an explicit report allowlist**

```js
// electron/terminal-diagnostics.cjs
function finite(value) { return Number.isFinite(value) ? value : 0 }

function createTerminalDiagnosticsReport(source = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pipeline: {
      receivedBytes: finite(source.receivedBytes),
      renderedBytes: finite(source.renderedBytes),
      averageBlockBytes: finite(source.averageBlockBytes),
      maxBlockBytes: finite(source.maxBlockBytes),
      queuedBytes: finite(source.queuedBytes),
      peakQueuedBytes: finite(source.peakQueuedBytes),
      pauseCount: finite(source.pauseCount),
      pausedMs: finite(source.pausedMs),
    },
    renderer: {
      ackP50Ms: finite(source.renderer?.ackP50Ms),
      ackP95Ms: finite(source.renderer?.ackP95Ms),
      ackP99Ms: finite(source.renderer?.ackP99Ms),
      slowFrames: finite(source.renderer?.slowFrames),
      restoreCount: finite(source.renderer?.restoreCount),
      mode: source.renderer?.mode === 'webgl' ? 'webgl' : 'standard',
    },
    paste: {
      started: finite(source.paste?.startedPastes),
      completed: finite(source.paste?.completedPastes),
      cancelled: finite(source.paste?.cancelledPastes),
      rejected: finite(source.paste?.rejectedPastes),
      acceptedBytes: finite(source.paste?.pasteAcceptedBytes),
    },
  }
}

module.exports = { createTerminalDiagnosticsReport }
```

- [ ] **Step 4: Add secure IPC and JSON export in main**

`terminal:rendererMetrics` accepts only the numeric keys above and updates the active controller. `terminal:diagnostics` returns the allowlisted report. `terminal:exportDiagnostics` opens `dialog.showSaveDialog`, writes the generated JSON through `node:fs/promises`, and returns `{ exported: boolean; filePath?: string }`; the renderer never supplies a destination path.

```js
ipcMain.handle('terminal:diagnostics', (event) => {
  assertTrustedSender(event)
  const pipeline = terminalStream?.getDiagnostics() ?? {}
  return createTerminalDiagnosticsReport({ ...pipeline, paste: terminalInput?.getDiagnostics() })
})
```

Report renderer metrics only while the AI terminal is visible; this interval transports numeric counters, never terminal content:

```tsx
// src/App.tsx
useEffect(() => {
  if (appSection !== 'ai' || aiTab !== 'terminal') return
  const report = () => {
    const metrics = outputController.current?.metrics()
    if (metrics) window.vincodeLab.terminal.reportRendererMetrics(metrics)
  }
  report()
  const intervalId = window.setInterval(report, 2_000)
  return () => window.clearInterval(intervalId)
}, [appSection, aiTab, terminalRendererGeneration])
```

- [ ] **Step 5: Add a compact on-demand Settings panel**

```tsx
// src/components/terminal-diagnostics.tsx
export function TerminalDiagnostics() {
  const [diagnostics, setDiagnostics] = useState<TerminalDiagnosticsReport | null>(null)
  return <section className="settings-terminal-diagnostics">
    <header><div><h3>Diagnostica Terminale AI</h3><span>Metriche tecniche senza contenuti della sessione.</span></div>
      <Button size="sm" variant="outline" onClick={() => void window.vincodeLab.terminal.diagnostics().then(setDiagnostics)}>Aggiorna</Button>
    </header>
    {diagnostics && <dl><div><dt>Coda</dt><dd>{diagnostics.pipeline.queuedBytes.toLocaleString('it-IT')} B</dd></div><div><dt>ACK p95</dt><dd>{diagnostics.renderer.ackP95Ms.toFixed(1)} ms</dd></div></dl>}
    <Button size="sm" variant="outline" onClick={() => void window.vincodeLab.terminal.exportDiagnostics()}>Esporta report</Button>
  </section>
}
```

Mount it in the General settings panel after the preference grid. Refresh only on user action and while the component is mounted; do not poll while Settings is hidden.

- [ ] **Step 6: Run diagnostic, settings and preload tests**

Run: `node --test test/terminal-diagnostics.test.cjs test/settings-ui.test.cjs test/preload-surface.test.cjs`

Run: `npm run build`

Run: `npm run lint`

Expected: PASS; exported JSON cannot contain arbitrary source keys.

- [ ] **Step 7: Commit diagnostics**

```bash
git add electron/terminal-diagnostics.cjs electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts src/App.tsx src/components/terminal-diagnostics.tsx src/components/settings.tsx src/styles/views/settings.css test/terminal-diagnostics.test.cjs test/settings-ui.test.cjs test/preload-surface.test.cjs
git commit -m "feat: aggiunge diagnostica sicura del Terminale AI"
```

### Task 8: Benchmark lossless, soak test e decisione WebGL

**Files:**
- Create: `scripts/benchmark-terminal-stream.mjs`
- Create: `test/terminal-stream-integration.test.cjs`
- Modify: `package.json`
- Modify: `package-lock.json` only if WebGL passes the decision gate
- Modify: `src/App.tsx` only if WebGL passes the decision gate
- Modify: `src/lib/xterm-output-controller.js` only if WebGL passes the decision gate
- Modify: `src/vincode-lab.d.ts` only if WebGL passes the decision gate
- Modify: `electron/app-preferences.cjs` only if WebGL passes the decision gate
- Modify: `test/app-preferences.test.cjs` only if WebGL passes the decision gate
- Modify: `docs/superpowers/specs/2026-08-21-terminale-ai-xterm-performance-design.md` with the measured renderer decision

**Interfaces:**
- Consumes: controller main, protocol renderer, incolla e diagnostica dei Task 1-7.
- Produces: `npm run benchmark:terminal`, prova lossless 100 MB e decisione registrata `standard` oppure `webgl`.

- [ ] **Step 1: Write a 100 MB byte-for-byte integration test with a fake PTY**

```js
// test/terminal-stream-integration.test.cjs
const assert = require('node:assert/strict')
const test = require('node:test')
const { createTerminalStreamController, TERMINAL_STREAM_LIMITS } = require('../electron/terminal-stream-controller.cjs')

function createHarnessController(overrides = {}) {
  const sent = []
  const pty = {
    pauses: 0,
    resumes: 0,
    pause() { this.pauses += 1 },
    resume() { this.resumes += 1 },
  }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'bench',
    sendBlock: (block) => sent.push(block),
    sendState: () => {},
    limits: overrides.limits ?? TERMINAL_STREAM_LIMITS,
  })
  controller.rendererReady({ sessionId: 'bench', watermark: 0 })
  return { controller, pty, sent }
}

function drainSent({ controller, sent }, onBlock = () => {}) {
  while (sent.length > 0) {
    const block = sent.shift()
    onBlock(block)
    assert.equal(controller.ack({ sessionId: block.sessionId, sequence: block.sequence }), true)
  }
}

test('consegna 100 MB senza perdita e con coda limitata', () => {
  const source = '0123456789abcdef'.repeat(6_553_600)
  const rendered = []
  const harness = createHarnessController()
  for (let offset = 0; offset < source.length; offset += 32_768) {
    harness.controller.push(source.slice(offset, offset + 32_768))
    drainSent(harness, (block) => rendered.push(block.data))
  }
  harness.controller.end({ exitCode: 0, signal: 0 })
  drainSent(harness, (block) => rendered.push(block.data))
  assert.equal(rendered.join(''), source)
  assert.ok(harness.controller.getDiagnostics().peakQueuedBytes <= 4 * 1024 * 1024 + 64 * 1024)
})

test('sospende il PTY con ACK ritardati e lo riprende dopo il drenaggio', () => {
  const limits = { ...TERMINAL_STREAM_LIMITS, blockBytes: 32, pauseBytes: 64, resumeBytes: 16 }
  const harness = createHarnessController({ limits })
  harness.controller.push('x'.repeat(256))
  assert.equal(harness.pty.pauses, 1)
  drainSent(harness)
  assert.equal(harness.pty.resumes, 1)
})
```

The test fixture generates the string in memory and does not write terminal content to disk or logs. Draining after every source chunk keeps the correctness run independent from machine speed; the second case deliberately retains ACKs until the pressure threshold is crossed.

- [ ] **Step 2: Run the integration test and fix only correctness failures**

Run: `node --test test/terminal-stream-integration.test.cjs`

Expected: PASS with exact string equality and at least one `pause()`/`resume()` in the delayed-ACK case.

- [ ] **Step 3: Add a repeatable benchmark command without hard timing assertions**

```js
// scripts/benchmark-terminal-stream.mjs
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const { createTerminalStreamController } = require('../electron/terminal-stream-controller.cjs')

async function runTerminalStreamBenchmark(totalBytes) {
  const sent = []
  const pty = { pause() {}, resume() {} }
  const controller = createTerminalStreamController({
    pty,
    sessionId: 'benchmark',
    sendBlock: (block) => sent.push(block),
    sendState: () => {},
  })
  controller.rendererReady({ sessionId: 'benchmark', watermark: 0 })
  const chunk = '0123456789abcdef'.repeat(2_048)
  let producedBytes = 0
  while (producedBytes < totalBytes) {
    const data = chunk.slice(0, Math.min(chunk.length, totalBytes - producedBytes))
    controller.push(data)
    producedBytes += Buffer.byteLength(data, 'utf8')
    while (sent.length > 0) {
      const block = sent.shift()
      controller.ack({ sessionId: block.sessionId, sequence: block.sequence })
    }
  }
  controller.end({ exitCode: 0, signal: 0 })
  while (sent.length > 0) {
    const block = sent.shift()
    controller.ack({ sessionId: block.sessionId, sequence: block.sequence })
  }
  const metrics = controller.getDiagnostics()
  return {
    receivedBytes: metrics.receivedBytes,
    renderedBytes: metrics.renderedBytes,
    peakQueuedBytes: metrics.peakQueuedBytes,
    exact: metrics.receivedBytes === totalBytes && metrics.renderedBytes === totalBytes,
  }
}

const sizes = [1, 10, 100].map((mb) => ({ mb, bytes: mb * 1024 * 1024 }))
for (const sample of sizes) {
  const started = performance.now()
  const result = await runTerminalStreamBenchmark(sample.bytes)
  process.stdout.write(`${JSON.stringify({ ...sample, elapsedMs: performance.now() - started, ...result })}\n`)
}
```

```json
// package.json scripts
"benchmark:terminal": "node scripts/benchmark-terminal-stream.mjs"
```

- [ ] **Step 4: Run the complete non-visual validation baseline**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run benchmark:terminal`

Expected: all gates PASS; benchmark reports 1/10/100 MB, exact bytes and bounded peak queue.

- [ ] **Step 5: Record standard renderer measurements in the diagnostic report**

Run: `npm run dev`

Use the same 100 MB fixture three times. Record median duration, p95 ACK, slow frames, peak queue and recovery results for: visible AI tab; AI tab hidden then restored; renderer reload during stream; resize and theme switch during stream; search, selection, copy and follow-output with a large scrollback; 5 MB Unicode paste.

Acceptance before any WebGL trial: no loss, duplicate or reorder; keyboard p95 below 50 ms; queue drains; memory returns within 10% of the post-start baseline after garbage collection opportunity and 30 seconds idle.

- [ ] **Step 6: Run an uncommitted WebGL trial and apply the decision gate**

Run: `npm install @xterm/addon-webgl`

Load `WebglAddon` dynamically after `xterm.open`, listen for context loss, dispose it and retain the standard renderer on failure. Repeat the exact five scenarios from Step 5 three times.

Decision gate: keep WebGL only if median p95 ACK or slow-frame count improves by at least 20%, all lossless/reload tests still pass and context loss falls back without restarting Pi. Otherwise remove the addon import, dependency and lockfile entry with `npm uninstall @xterm/addon-webgl` and retain `mode: 'standard'`.

- [ ] **Step 7: If WebGL passes, add the diagnostic preference and fallback test**

```js
// electron/app-preferences.cjs
'terminal.webgl': { section: 'terminal', label: 'Accelerazione grafica', type: 'boolean', default: true },
```

```js
// renderer setup after xterm.open
if (preferredTerminalWebgl) {
  void import('@xterm/addon-webgl').then(({ WebglAddon }) => {
    const addon = new WebglAddon()
    addon.onContextLoss(() => { addon.dispose(); reportRendererMode('standard') })
    xterm.loadAddon(addon)
    reportRendererMode('webgl')
  }).catch(() => reportRendererMode('standard'))
}
```

Run: `node --test test/app-preferences.test.cjs test/xterm-output-controller.test.mjs test/terminal-stream-integration.test.cjs`

Expected: PASS with preference validation and fallback to `standard` after simulated context loss.

- [ ] **Step 8: Record the measured decision in the design spec**

Append one subsection “Esito benchmark renderer — 2026-08-21” containing machine architecture, three-run medians, recovery outcome and the selected renderer. Do not include workspace paths, terminal content or commands.

- [ ] **Step 9: Run final gates and inspect repository state**

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Run: `npm run benchmark:terminal`

Run: `git diff --check`

Run: `git status --short`

Expected: all tests, lint, build and benchmark PASS; only Task 8 files are pending.

- [ ] **Step 10: Commit benchmark and selected renderer**

If WebGL is retained:

```bash
git add package.json package-lock.json electron/app-preferences.cjs src/App.tsx src/lib/xterm-output-controller.js src/vincode-lab.d.ts scripts/benchmark-terminal-stream.mjs test/app-preferences.test.cjs test/terminal-stream-integration.test.cjs docs/superpowers/specs/2026-08-21-terminale-ai-xterm-performance-design.md
git commit -m "perf: abilita rendering WebGL verificato per xterm"
```

If the standard renderer wins:

```bash
git add package.json scripts/benchmark-terminal-stream.mjs test/terminal-stream-integration.test.cjs docs/superpowers/specs/2026-08-21-terminale-ai-xterm-performance-design.md
git commit -m "perf: valida pipeline xterm lossless sotto carico"
```

## Final Verification and Rollback Check

- [ ] Confirm `git status --short` is clean and review the eight new commits.
- [ ] Confirm `rg -n "terminalOutputHistory|MAX_PENDING_TERMINAL_OUTPUT|terminal:history|terminal:input" electron src test` returns no production references to the removed pipeline.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, `npm run benchmark:terminal` once more after the final commit.
- [ ] Run the dev app for one continuous Pi session covering output stream, 5 MB paste, attachment path, tab switch, theme switch, resize, search, selection, copy, follow-output and renderer reload.
- [ ] Confirm no DMG, GitHub release or push is produced without a separate user request.
- [ ] If a regression blocks the Terminale AI, revert the newest self-contained commit; do not reintroduce both old and new PTY pipelines behind a permanent flag.
