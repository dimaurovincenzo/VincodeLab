# Terminale e file remoti SSH — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** aggiungere al Terminale libero connessioni SSH OpenSSH multiplexate e una sotto-tab File remoti per scaricare, modificare nell’Editor, confrontare e ricaricare file in sicurezza.

**Architecture:** il renderer usa esclusivamente IPC tipizzato e ID opachi. Il main process gestisce `ssh`/`sftp`, socket ControlMaster, cache privata e metadati SQLite; Terminale ed Explorer remoto condividono la stessa connessione gestita senza interpretare l’output xterm.

**Tech Stack:** Electron 43, React 19, TypeScript 6, xterm 6, CodeMirror 6, better-sqlite3, OpenSSH di macOS (`ssh`, `sftp`), Node test runner, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-21-terminale-file-remoti-ssh-design.md`

## Global Constraints

- Sviluppare direttamente su `main`, preservando modifiche preesistenti e verificando allineamento con `origin/main` prima di ogni fase.
- Nessuna password o chiave SSH viene salvata; autenticazione, host verification, agent e `ProxyJump` restano a OpenSSH e `~/.ssh/config`.
- Non usare `shell: true`, concatenazione di comandi o parsing di comandi SSH liberi.
- Il renderer non riceve filesystem, processi, socket, percorsi cache o moduli Node.
- Ogni risorsa è isolata per `workspace_path`; gli ID del renderer non possono indirizzare risorse di altri workspace.
- Il salvataggio Editor non carica automaticamente il file remoto.
- Upload distruttivi richiedono controllo conflitto e conferma; la promozione finale usa temporaneo remoto e rinomina.
- File e output sono limitati e trasferiti in streaming; contenuti e comandi completi non entrano nei log.
- Il Terminale libero deve restare operativo quando OpenSSH non è disponibile o una connessione remota fallisce.
- Nessun DMG o release durante l’implementazione; packaging solo dopo collaudo remoto non produttivo.

## Impact Analysis

- **Breaking changes:** nessuno atteso; la migrazione SQLite è additiva e i comandi esistenti restano `shell`.
- **Dipendenze:** nessun client SSH JavaScript; si riusa OpenSSH di sistema. `@codemirror/merge` è l’unica dipendenza renderer nuova e resta confinata al confronto.
- **Prestazioni e scala:** una coda SFTP per connessione impedisce processi concorrenti incontrollati; limiti di dimensione/output e streaming proteggono main e renderer.
- **Sicurezza:** nessuna credenziale persistita, niente shell nel main, validazione sender/workspace/ID e cache privata `0700`/`0600`.
- **Operatività:** il Terminale libero continua a funzionare senza OpenSSH; errori e timeout SSH restano isolati nella sotto-tab remota.
- **Distribuzione:** nessun cambio di formato package in questa fase; il requisito OpenSSH dovrà essere verificato sul bundle macOS solo dopo il collaudo funzionale.
- **Rollback:** ogni task produce un commit autonomo. In caso di regressione si ripristina il singolo commit; le nuove colonne/tabelle SQLite possono restare inutilizzate senza invalidare i dati legacy.

---

## File Structure

### Main process

- `electron/workspace-commands.cjs`: migrazione additiva e validazione dei comandi `shell`/`ssh`.
- `electron/managed-ssh-service.cjs`: risoluzione OpenSSH, socket breve, comando PTY, stato e lifecycle ControlMaster.
- `electron/sftp-service.cjs`: quoting batch, parsing elenco, coda, timeout e operazioni SFTP.
- `electron/remote-file-store.cjs`: schema SQLite, cache privata, manifesto, hash e isolamento workspace.
- `electron/remote-file-service.cjs`: orchestration di browse/download/save/compare/upload e operazioni distruttive.
- `electron/main.cjs`: lifecycle e handler IPC con sender/workspace validation.
- `electron/preload.cjs`: superficie remota minima e serializzabile.
- `electron/context-menu.cjs`: template nativi per file/cartelle/copie remote.

### Renderer

- `src/components/terminal-workspace.tsx`: sotto-tab Terminale/File remoti mantenute montate.
- `src/components/free-terminal.tsx`: form connessione SSH e avvio gestito.
- `src/components/remote-files.tsx`: Explorer remoto, trasferimenti, stati e azioni.
- `src/components/remote-diff-dialog.tsx`: confronto CodeMirror read-only locale/remoto.
- `src/components/project-editor.tsx`: tab remote, salvataggio locale e badge di sincronizzazione.
- `src/App.tsx`: richiesta di apertura remota e navigazione verso Editor.
- `src/terminal.css`, `src/editor.css`: layout responsive, pannello ridimensionabile, stati e temi.
- `src/vincode-lab.d.ts`: DTO e API globali tipizzate.

### Test

- `test/workspace-commands.test.cjs`
- `test/managed-ssh-service.test.cjs`
- `test/sftp-service.test.cjs`
- `test/remote-file-store.test.cjs`
- `test/remote-file-service.test.cjs`
- `test/remote-files-ui.test.cjs`
- `test/editor-remote-files.test.cjs`
- `test/context-menu.test.cjs`
- `test/preload-surface.test.cjs`

---

### Task 1: Modello persistente dei comandi SSH gestiti

**Files:**
- Modify: `electron/workspace-commands.cjs`
- Modify: `src/vincode-lab.d.ts`
- Test: `test/workspace-commands.test.cjs`

**Interfaces:**
- Produces: `WorkspaceCommandKind = 'shell' | 'ssh'`.
- Produces: `WorkspaceCommandInput { categoryId, title, kind, command, note, sshDestination, remoteRoot }`.
- Produces: `assertSshDestination(value)` e `assertRemoteRoot(value)` esportate per i test.

- [x] **Step 1: scrivere i test RED della migrazione e validazione**

```js
test('mantiene shell i comandi esistenti e salva un profilo SSH separato', (t) => {
  withTemporaryDatabase(t)
  const category = createCommandCategory('/tmp/workspace-a', 'Server')
  const shell = createWorkspaceCommand('/tmp/workspace-a', { categoryId: category.id, title: 'Build', kind: 'shell', command: 'npm run build', note: '', sshDestination: '', remoteRoot: '' })
  const ssh = createWorkspaceCommand('/tmp/workspace-a', { categoryId: category.id, title: 'Produzione', kind: 'ssh', command: '', note: '', sshDestination: 'api-prod', remoteRoot: '/srv/api' })
  assert.equal(shell.kind, 'shell')
  assert.deepEqual({ kind: ssh.kind, sshDestination: ssh.sshDestination, remoteRoot: ssh.remoteRoot }, { kind: 'ssh', sshDestination: 'api-prod', remoteRoot: '/srv/api' })
  assert.throws(() => assertSshDestination('-oProxyCommand=evil'), /Destinazione SSH non valida/)
  assert.throws(() => assertRemoteRoot('/srv/api\nput x'), /Percorso remoto non valido/)
})
```

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/workspace-commands.test.cjs`

Expected: FAIL perché tipi, colonne e validator SSH non esistono.

- [x] **Step 3: implementare migrazione e DTO minimi**

```js
const COMMAND_KINDS = new Set(['shell', 'ssh'])

function ensureColumn(database, table, name, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all()
  if (!columns.some((column) => column.name === name)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
}

function assertSshDestination(value) {
  if (typeof value !== 'string' || !/^(?!-)[A-Za-z0-9._:@\[\]-]{1,255}$/.test(value)) throw new Error('Destinazione SSH non valida.')
  return value
}

function assertRemoteRoot(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\0\r\n]/.test(value) || (!value.startsWith('/') && value !== '~' && !value.startsWith('~/'))) throw new Error('Percorso remoto non valido.')
  return value
}
```

Aggiornare tutte le query `SELECT`, `INSERT` e `UPDATE`; `kind` deve avere default SQL `'shell'`. Per `shell`, `command` resta obbligatorio e i campi SSH diventano stringhe vuote. Per `ssh`, destinazione/root sono obbligatori e `command` è vuoto.

- [x] **Step 4: eseguire test mirato e suite workspace**

Run: `node --test test/workspace-commands.test.cjs test/workspace-store.test.cjs`

Expected: PASS, inclusi i record legacy creati prima delle nuove colonne.

- [x] **Step 5: committare**

```bash
git add electron/workspace-commands.cjs src/vincode-lab.d.ts test/workspace-commands.test.cjs
git commit -m "feat: aggiunge i profili SSH ai comandi workspace"
```

---

### Task 2: Lifecycle OpenSSH ControlMaster

**Files:**
- Create: `electron/managed-ssh-service.cjs`
- Create: `test/managed-ssh-service.test.cjs`
- Modify: `electron/main.cjs`

**Interfaces:**
- Consumes: `WorkspaceCommand` con `kind='ssh'`, `sshDestination`, `remoteRoot`.
- Produces: `createManagedSshService({ spawn, accessSync, tempRoot, sendStatus, log })`.
- Produces: metodi `buildTerminalCommand(workspacePath, command)`, `check(connectionId)`, `waitUntilConnected(connectionId, { timeoutMs })`, `get(connectionId)`, `list(workspacePath)`, `disconnect(connectionId)`, `closeWorkspace(workspacePath)`, `closeAll()`.
- Produces nel main: `ManagedSshConnection { id, commandId, title, destination, remoteRoot, socketPath, sshPath, sftpPath, state, error? }`; il DTO IPC elimina i tre percorsi operativi.

- [x] **Step 1: scrivere test RED per socket, quoting e stato**

```js
test('crea un socket breve privato e non interpola la destinazione', async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-ssh-'))
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  const service = createManagedSshService({
    spawn: () => { throw new Error('spawn non previsto durante la costruzione del comando') },
    accessSync: () => undefined,
    tempRoot,
    sendStatus: () => undefined,
    log: () => undefined,
  })
  const launch = service.buildTerminalCommand('/tmp/workspace-a', {
    id: 'command-a', categoryId: 'category-a', title: 'Produzione', kind: 'ssh',
    command: '', note: '', sshDestination: 'api-prod', remoteRoot: '/srv/api',
  })
  assert.match(launch.command, /^ssh -o ControlMaster=auto /)
  assert.ok(Buffer.byteLength(launch.socketPath) < 100)
  assert.equal(launch.connection.destination, 'api-prod')
  assert.equal(launch.command.includes('shell: true'), false)
})
```

Testare inoltre destinazione che inizia con `-`, check fallito, timeout di `waitUntilConnected`, due workspace, `disconnect` e `closeAll` idempotenti. `waitUntilConnected` esegue check brevi con backoff limitato e pubblica `connected`, `error` o `timeout`; il renderer non deve implementare polling proprio.

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/managed-ssh-service.test.cjs`

Expected: FAIL con modulo non trovato.

- [x] **Step 3: implementare il servizio con dipendenze iniettate**

```js
function createManagedSshService({ spawn = childProcess.spawn, accessSync = fs.accessSync, tempRoot = app.getPath('temp'), sendStatus, log }) {
  const connections = new Map()
  const root = path.join(tempRoot, `vincodelab-${process.getuid?.() ?? 'user'}`, 'ssh')
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  return { buildTerminalCommand, check, waitUntilConnected, get, list, disconnect, closeWorkspace, closeAll }
}
```

Usare hash brevi per directory/socket, `quoteShellArg` centralizzato e `spawn(sshPath, ['-S', socketPath, '-O', operation, '--', destination], { shell: false })` per check/exit. Il prompt di autenticazione resta nel PTY. Dopo l'avvio, il servizio chiama `waitUntilConnected` in background e notifica lo stato senza bloccare il terminale.

- [x] **Step 4: collegare chiusura shell/workspace/app**

In `main.cjs`, creare un'istanza del servizio; `restartShell`, cambio workspace e `before-quit` devono chiudere connessioni e trasferimenti associati prima di eliminare il PTY.

- [x] **Step 5: eseguire test e lint del main**

Run: `node --test test/managed-ssh-service.test.cjs test/terminal-session-history.test.cjs && npm run lint`

Expected: PASS senza regressioni sul restart della shell.

- [x] **Step 6: committare**

```bash
git add electron/managed-ssh-service.cjs electron/main.cjs test/managed-ssh-service.test.cjs
git commit -m "feat: gestisce connessioni SSH multiplexate"
```

---

### Task 3: Cache privata e manifesto dei file remoti

**Files:**
- Create: `electron/remote-file-store.cjs`
- Create: `test/remote-file-store.test.cjs`
- Modify: `electron/workspace-store.cjs`

**Interfaces:**
- Produces: `createRemoteFileStore({ dataRoot, database })`.
- Produces: `trackDownload(workspacePath, { connectionId, remotePath, localTempPath, size, modifiedAt, mode, baselineHash })`, `getTrackedFile(workspacePath, id)`, `markLocalSaved(...)`, `markConflict(...)`, `markSynced(...)`, `listTrackedFiles(...)`, `removeTrackedFile(...)`, `cleanup(...)`.
- Produces: `RemoteTrackedFile { id, connectionId, name, remotePath, localState, size, modifiedAt, mode, baselineHash, localHash, lastError }`.

- [x] **Step 1: scrivere test RED per isolamento e permessi**

```js
test('isola cache e manifesti per workspace', (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-store-'))
  const database = new Database(':memory:')
  const localTempPath = path.join(dataRoot, 'download.tmp')
  fs.writeFileSync(localTempPath, 'TOKEN=example\n', { mode: 0o600 })
  t.after(() => { database.close(); fs.rmSync(dataRoot, { recursive: true, force: true }) })
  const store = createRemoteFileStore({ dataRoot, database })
  const item = store.trackDownload('/tmp/a', {
    connectionId: 'connection-a', remotePath: '/srv/app/.env', localTempPath,
    size: 14, modifiedAt: 1_777_000_000_000, mode: 0o600,
    baselineHash: crypto.createHash('sha256').update('TOKEN=example\n').digest('hex'),
  })
  assert.equal(store.getTrackedFile('/tmp/a', item.id).localState, 'synced')
  assert.equal(store.getTrackedFile('/tmp/b', item.id), null)
  assert.equal(fs.statSync(path.dirname(item.localPath)).mode & 0o777, 0o700)
  assert.equal(fs.statSync(item.localPath).mode & 0o777, 0o600)
})
```

Testare transazione incompleta, hash, copie modificate non eliminabili senza `force`, cleanup dei temporanei e nessun percorso cache restituito nei DTO pubblici.

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/remote-file-store.test.cjs`

Expected: FAIL con modulo non trovato.

- [x] **Step 3: implementare schema e filesystem atomico**

```sql
CREATE TABLE IF NOT EXISTS remote_tracked_files (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_path TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  local_relative_path TEXT NOT NULL,
  baseline_hash TEXT NOT NULL,
  local_hash TEXT NOT NULL,
  remote_size INTEGER,
  remote_modified_at INTEGER,
  remote_mode INTEGER,
  local_state TEXT NOT NULL CHECK(local_state IN ('synced','modified','conflict','offline')),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(workspace_path, connection_id, remote_path)
);
```

Scrivere prima su `<working-copy>.tmp`, applicare `0600`, rinominare e aggiornare SQLite in transazione. Conservare percorsi relativi alla cache e ricostruirli soltanto nel main.

- [x] **Step 4: eseguire test store e database**

Run: `node --test test/remote-file-store.test.cjs test/workspace-store.test.cjs`

Expected: PASS.

- [x] **Step 5: committare**

```bash
git add electron/remote-file-store.cjs electron/workspace-store.cjs test/remote-file-store.test.cjs
git commit -m "feat: aggiunge la cache privata dei file remoti"
```

---

### Task 4: Adapter SFTP sicuro e serializzato

**Files:**
- Create: `electron/sftp-service.cjs`
- Create: `test/sftp-service.test.cjs`

**Interfaces:**
- Consumes: `{ sshPath, sftpPath, socketPath, destination }` dal servizio SSH.
- Produces: `createSftpService({ spawn, timeoutMs, maxOutputBytes, maxConcurrentPerConnection })`.
- Produces: `list(connection, path)`, `download(connection, remotePath, localTempPath, signal)`, `uploadTemp(...)`, `rename(...)`, `chmod(...)`, `mkdir(...)`, `remove(...)`, `rmdir(...)`, `closeConnection(id)`.
- Produces: `quoteSftpPath(path)` e `parseSftpList(output)`.

- [x] **Step 1: scrivere test RED di quoting, parser e coda**

```js
test('quota percorsi SFTP e rifiuta controlli', () => {
  assert.equal(quoteSftpPath('/srv/File prova.txt'), '"/srv/File prova.txt"')
  assert.equal(quoteSftpPath('/srv/a"b'), '"/srv/a\\"b"')
  assert.throws(() => quoteSftpPath('/srv/a\nrm x'), /Percorso remoto non valido/)
})

test('normalizza ls OpenSSH senza indovinare righe ambigue', () => {
  assert.deepEqual(parseSftpList('-rw-r----- 1 1000 1000 12 Aug 21 10:30 File prova.txt\n')[0], {
    name: 'File prova.txt', kind: 'file', size: 12, mode: 0o640, modifiedAt: null, linkTarget: null,
  })
})
```

Testare Unicode, link, riga sconosciuta read-only, stderr, exit non zero, timeout, limite output, abort e FIFO per connessione.

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/sftp-service.test.cjs`

Expected: FAIL con modulo non trovato.

- [x] **Step 3: implementare batch runner e parser**

```js
function runBatch(connection, commands, { signal } = {}) {
  return enqueue(connection.id, () => runProcess(connection.sftpPath, [
    '-q', '-b', '-', '-o', `ControlPath=${connection.socketPath}`, '--', connection.destination,
  ], `${commands.join('\n')}\n`, { env: { ...process.env, LC_ALL: 'C' }, signal }))
}
```

Non esportare `runBatch` verso IPC. Ogni metodo costruisce un insieme chiuso di comandi. Una voce non interpretabile ritorna `kind:'unknown'` e `destructiveAllowed:false`. Se `remoteRoot` vale `~` o inizia con `~/`, la prima operazione esegue `pwd`, risolve la parte relativa, conserva il percorso assoluto nella connessione e usa solo quel percorso canonico nelle operazioni successive; non quota `~` aspettandosi un'espansione implicita di SFTP.

- [x] **Step 4: eseguire test adapter**

Run: `node --test test/sftp-service.test.cjs`

Expected: PASS, inclusi timeout e concorrenza.

- [x] **Step 5: committare**

```bash
git add electron/sftp-service.cjs test/sftp-service.test.cjs
git commit -m "feat: aggiunge operazioni SFTP sicure"
```

---

### Task 5: Orchestrazione download, conflitto e upload atomico

**Files:**
- Create: `electron/remote-file-service.cjs`
- Create: `test/remote-file-service.test.cjs`

**Interfaces:**
- Consumes: managed SSH, SFTP e remote file store.
- Produces: `createRemoteFileService({ ssh, sftp, store, chooseFiles, chooseDestination, log, notify })`.
- Produces: `browse`, `downloadAndTrack`, `readLocal`, `readPreview`, `saveLocal`, `compare`, `upload`, `chooseAndUpload`, `cancelTransfer`, `createDirectory`, `rename`, `remove`, `discard`, `cleanup`, `closeWorkspace`.
- Produces: `RemoteCompareResult { baselineChanged, remoteContent?, localContent?, binary, remoteHash, baselineHash, localHash }`.

- [x] **Step 1: scrivere test RED del flusso completo**

```js
function createFixtureService(t, { baseline = 'prima', remoteNow = 'prima', localNow = 'locale', localState = 'modified' } = {}) {
  const calls = []
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-remote-service-'))
  const localPath = path.join(cacheRoot, 'working-copy')
  fs.writeFileSync(localPath, localNow, { mode: 0o600 })
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }))
  const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
  const tracked = {
    id: 'remote-file-1', connectionId: 'connection-a', remotePath: '/srv/app/config.json',
    localPath, baselineHash: hash(baseline), localHash: hash(localNow),
    mode: 0o640, localState,
  }
  const store = {
    getTrackedFile: (workspacePath, id) => workspacePath === '/tmp/workspace-a' && id === tracked.id ? tracked : null,
    markConflict: () => ({ status: 'conflict', uploaded: false }),
    markSynced: () => ({ status: 'synced', uploaded: true }),
    updateRemotePath: () => { calls.push({ name: 'updateRemotePath' }) },
    removeTrackedFile: (_workspacePath, _id, { force }) => {
      if (!force && tracked.localState !== 'synced') throw new Error('La copia contiene modifiche locali.')
      return { removed: true }
    },
  }
  const sftp = {
    download: async (_connection, _remotePath, localPath) => { calls.push({ name: 'download' }); fs.writeFileSync(localPath, remoteNow) },
    uploadTemp: async () => { calls.push({ name: 'uploadTemp' }) },
    chmod: async () => { calls.push({ name: 'chmod' }) },
    rename: async () => { calls.push({ name: 'rename' }) },
    remove: async () => { calls.push({ name: 'remove' }) },
  }
  const ssh = { get: () => ({ id: 'connection-a', socketPath: '/tmp/vl/socket', destination: 'api-test', state: 'connected' }) }
  const service = createRemoteFileService({ ssh, sftp, store, chooseFiles: async () => [], chooseDestination: async () => null, log: () => undefined, notify: () => undefined })
  return { ...service, calls, store }
}

test('blocca upload quando il server è cambiato', async (t) => {
  const service = createFixtureService(t, { baseline: 'prima', remoteNow: 'cambiato', localNow: 'locale' })
  const result = await service.upload('/tmp/workspace-a', 'remote-file-1', { force: false })
  assert.deepEqual(result, { status: 'conflict', uploaded: false })
  assert.equal(service.calls.some((call) => call.name === 'uploadTemp'), false)
})

test('carica temporaneo, ripristina mode e rinomina', async (t) => {
  const service = createFixtureService(t, { baseline: 'prima', remoteNow: 'prima', localNow: 'locale' })
  await service.upload('/tmp/workspace-a', 'remote-file-1', { force: false })
  assert.deepEqual(service.calls.map((call) => call.name), ['download', 'uploadTemp', 'chmod', 'rename'])
})
```

Testare remoto eliminato, forza sostituzione, annullamento, binario, file oltre limite, temporanei locali/remoti e isolamento workspace.

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/remote-file-service.test.cjs`

Expected: FAIL con modulo non trovato.

- [x] **Step 3: implementare orchestrazione senza buffer renderer**

```js
async function upload(workspacePath, fileId, { force = false } = {}) {
  const tracked = requireTrackedFile(workspacePath, fileId)
  const remoteTemp = `${tracked.remotePath}.vincodelab-${crypto.randomUUID()}.tmp`
  const current = await downloadForHash(tracked)
  if (!force && current.hash !== tracked.baselineHash) return markConflict(tracked)
  try {
    await sftp.uploadTemp(connection, tracked.localPath, remoteTemp)
    if (tracked.mode !== null) await sftp.chmod(connection, remoteTemp, tracked.mode)
    await sftp.rename(connection, remoteTemp, tracked.remotePath)
    return store.markSynced(workspacePath, fileId, tracked.localHash)
  } catch (error) {
    await sftp.remove(connection, remoteTemp).catch(() => undefined)
    throw normalizeRemoteError(error, 'upload')
  }
}
```

- [x] **Step 4: eseguire test servizi remoti**

Run: `node --test test/remote-file-service.test.cjs test/remote-file-store.test.cjs test/sftp-service.test.cjs test/managed-ssh-service.test.cjs`

Expected: PASS.

- [x] **Step 5: committare**

```bash
git add electron/remote-file-service.cjs test/remote-file-service.test.cjs
git commit -m "feat: sincronizza file remoti con controllo conflitti"
```

---

### Task 6: IPC tipizzato, lifecycle ed eventi

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `test/preload-surface.test.cjs`

**Interfaces:**
- Produces: `managedSsh.list/check/disconnect/onStatus`.
- Produces: `remoteFiles.browse/downloadAndTrack/read/preview/saveLocal/compare/upload/chooseAndUpload/cancelTransfer/createDirectory/rename/remove/discard/listTracked/cleanup/onTransfer`.
- Produces: `workspaceCommands.run(commandId): Promise<{ executed: true; managedConnectionId?: string }>`.

- [x] **Step 1: scrivere test RED della superficie IPC**

```js
for (const channel of [
  'managedSsh:list', 'managedSsh:check', 'managedSsh:disconnect',
  'remoteFiles:browse', 'remoteFiles:downloadAndTrack', 'remoteFiles:read',
  'remoteFiles:saveLocal', 'remoteFiles:compare', 'remoteFiles:upload',
]) assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'[\\s\\S]{0,260}assertTrustedSender`))

assert.doesNotMatch(remotePreload, /workspacePath|localPath|node:|require\(/)
```

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/preload-surface.test.cjs`

Expected: FAIL perché i canali non esistono.

- [x] **Step 3: registrare handler e cleanup**

Ogni handler chiama `assertTrustedSender(event)`, usa `requireActiveWorkspace()` e inoltra solo ID/DTO validati. `workspaceCommands:run` usa il percorso attuale per `shell`; per `ssh` chiama `buildTerminalCommand`, scrive il comando quotato nel PTY e restituisce `managedConnectionId`.

Gli eventi `managedSsh:status` e `remoteFiles:transfer` vengono inviati solo alla finestra attiva. `stopShell`, cambio workspace, `closed` e `before-quit` chiudono code, master e temporanei.

- [x] **Step 4: aggiungere preload e tipi esatti**

```ts
interface ManagedSshConnection {
  id: string; commandId: string; title: string; destination: string; remoteRoot: string
  state: 'connecting' | 'connected' | 'disconnected' | 'error'; error?: string
}
interface RemoteEntry {
  id: string; name: string; kind: 'file' | 'directory' | 'link' | 'unknown'
  displayPath: string; size: number | null; modifiedAt: number | null; mode: number | null; destructiveAllowed: boolean
}
interface RemoteTransfer {
  id: string; direction: 'download' | 'upload'; name: string
  state: 'queued' | 'running' | 'completed' | 'cancelled' | 'error'; bytes: number | null; total: number | null; error?: string
}
```

- [x] **Step 5: eseguire test IPC e servizi**

Run: `node --test test/preload-surface.test.cjs test/managed-ssh-service.test.cjs test/remote-file-service.test.cjs`

Expected: PASS.

- [x] **Step 6: committare**

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs
git commit -m "feat: espone le API dei file remoti al renderer"
```

---

### Task 7: Sotto-tab e connessioni gestite nel Terminale

**Files:**
- Create: `src/components/terminal-workspace.tsx`
- Modify: `src/components/free-terminal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/terminal.css`
- Create: `test/remote-files-ui.test.cjs`

**Interfaces:**
- Consumes: `workspaceCommands.run` e `managedSsh` IPC.
- Produces: `TerminalWorkspace({ active, workspace, onOpenRemoteFile })`.
- Produces: `FreeTerminal({ active, workspace, onManagedConnection })`.

- [x] **Step 1: scrivere test RED di struttura e accessibilità**

```js
assert.match(workspace, /role="tablist"[^]*Terminale[^]*File remoti/)
assert.match(workspace, /aria-controls="terminal-panel-shell"/)
assert.match(workspace, /aria-controls="terminal-panel-remote"/)
assert.match(workspace, /<FreeTerminal[^]*active=\{active && tab === 'shell'\}/)
assert.match(workspace, /<RemoteFiles[^]*active=\{active && tab === 'remote'\}/)
assert.match(freeTerminal, /kind[^]*sshDestination[^]*remoteRoot/)
```

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/remote-files-ui.test.cjs`

Expected: FAIL perché wrapper e sotto-tab non esistono.

- [x] **Step 3: creare il wrapper mantenendo entrambe le viste montate**

```tsx
export function TerminalWorkspace({ active, workspace, onOpenRemoteFile }: Props) {
  const [tab, setTab] = useState<'shell' | 'remote'>('shell')
  const [connectionId, setConnectionId] = useState<string | null>(null)
  return <section className="terminal-workspace">
    <div className="secondary-tabs" role="tablist" aria-label="Strumenti terminale">
      <button type="button" role="tab" aria-selected={tab === 'shell'} aria-controls="terminal-panel-shell" onClick={() => setTab('shell')}>Terminale</button>
      <button type="button" role="tab" aria-selected={tab === 'remote'} aria-controls="terminal-panel-remote" onClick={() => setTab('remote')}>File remoti</button>
    </div>
    <section id="terminal-panel-shell" role="tabpanel" hidden={tab !== 'shell'} inert={tab !== 'shell'}>
      <FreeTerminal active={active && tab === 'shell'} workspace={workspace} onManagedConnection={(id) => { setConnectionId(id); setTab('remote') }} />
    </section>
    <section id="terminal-panel-remote" role="tabpanel" hidden={tab !== 'remote'} inert={tab !== 'remote'}>
      <RemoteFiles active={active && tab === 'remote'} workspace={workspace} preferredConnectionId={connectionId} onOpenRemoteFile={onOpenRemoteFile} />
    </section>
  </section>
}
```

Usare `inert` oltre a `aria-hidden`; non smontare xterm durante il cambio tab.

- [x] **Step 4: estendere il form comandi e lo stato SSH**

Il form mostra un selettore `Comando libero / Connessione SSH`. Per SSH mostra destinazione e root, nasconde il textarea comando e visualizza il comando generato in sola lettura. Dopo conferma, `run` restituisce l'ID; la UI mostra `Connessione SSH in corso…` finché l'evento/check non conferma lo stato.

- [x] **Step 5: applicare layout responsive e testare**

Run: `node --test test/remote-files-ui.test.cjs test/ui-design-system.test.cjs test/terminal-session-history.test.cjs && npm run build`

Expected: PASS; il cambio sotto-tab non ricrea `Terminal` né chiama `shell.restart`.

- [x] **Step 6: committare**

```bash
git add src/components/terminal-workspace.tsx src/components/free-terminal.tsx src/App.tsx src/terminal.css test/remote-files-ui.test.cjs
git commit -m "feat: separa terminale e file remoti in sotto-tab"
```

---

### Task 8: Explorer remoto, trasferimenti e menu contestuale

**Files:**
- Create: `src/components/remote-files.tsx`
- Modify: `src/components/terminal-workspace.tsx`
- Modify: `electron/context-menu.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `src/terminal.css`
- Modify: `test/context-menu.test.cjs`
- Modify: `test/remote-files-ui.test.cjs`

**Interfaces:**
- Consumes: `managedSsh.*`, `remoteFiles.*`, `useResizablePanel`.
- Produces: `RemoteFiles({ active, workspace, preferredConnectionId, onOpenRemoteFile })`.
- Produces: evento `contextMenu:action` con `{ command, contextId }` per target remoti.

- [x] **Step 1: scrivere test RED di Explorer e menu nativo**

```js
assert.match(remoteFiles, /useResizablePanel/)
assert.match(remoteFiles, /Caricamento file remoti/)
assert.match(remoteFiles, /Nessun file nella cartella/)
assert.match(remoteFiles, /Trasferimenti/)
assert.deepEqual(remoteFileActions, ['Scarica e apri', 'Scarica in…', 'Copia percorso remoto', 'Rinomina…', 'Elimina…'])
```

- [x] **Step 2: eseguire test e verificare il fallimento**

Run: `node --test test/remote-files-ui.test.cjs test/context-menu.test.cjs`

Expected: FAIL.

- [x] **Step 3: implementare Explorer e coda**

La vista carica connessioni, poi `browse(connectionId)`; la navigazione usa esclusivamente `entry.id`. Mostrare skeleton/loader, empty state, errore locale con Riprova e stato Offline senza propagare all'error boundary globale. Ricerca solo sull'elenco caricato. Il pannello usa `useResizablePanel` e supporta tastiera/doppio clic.

Ogni trasferimento mantiene una riga con nome, direzione, byte/total quando disponibili, stato, Annulla o Riprova. Annulla chiama `remoteFiles.cancelTransfer(transferId)` e propaga `AbortSignal` fino al processo SFTP. Un download completato chiama `onOpenRemoteFile(remoteFileId)`.

- [x] **Step 4: estendere il menu contestuale senza fidarsi del renderer**

```js
const REMOTE_CONTEXT_ACTIONS = {
  'remote-file': [
    { label: 'Scarica e apri', command: 'remote.downloadOpen' },
    { label: 'Scarica in…', command: 'remote.downloadAs' },
    { type: 'separator' },
    { label: 'Copia percorso remoto', command: 'remote.copyPath' },
    { label: 'Rinomina…', command: 'remote.rename' },
    { label: 'Elimina…', command: 'remote.delete' },
  ],
}
```

Il main accetta solo kind noti e un `contextId` UUID limitato. Per target remoti invia l'azione al renderer; il servizio rilegge comunque la risorsa per workspace prima di ogni mutazione.

- [x] **Step 5: eseguire test UI, contesto e build**

Run: `node --test test/remote-files-ui.test.cjs test/context-menu.test.cjs test/preload-surface.test.cjs && npm run build`

Expected: PASS in tema chiaro/scuro e viewport minimo 900×600.

- [x] **Step 6: committare**

```bash
git add src/components/remote-files.tsx src/components/terminal-workspace.tsx electron/context-menu.cjs electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts src/terminal.css test/context-menu.test.cjs test/remote-files-ui.test.cjs
git commit -m "feat: aggiunge l'explorer dei file remoti"
```

---

### Task 9: Editor remoto, diff e upload esplicito

**Files:**
- Create: `src/components/remote-diff-dialog.tsx`
- Modify: `src/components/project-editor.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/terminal-workspace.tsx`
- Modify: `src/editor.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `test/editor-remote-files.test.cjs`

**Interfaces:**
- Consumes: `RemoteOpenRequest { id, nonce }` da `App`.
- Consumes: `remoteFiles.read/preview/saveLocal/compare/upload/discard`.
- Produces: `ProjectEditor({ remoteOpenRequest })` e tab `source:'workspace'|'remote'`.
- Produces: `RemoteDiffDialog({ file, comparison, onUpload, onForceUpload, onClose })`.

- [x] **Step 1: aggiungere `@codemirror/merge` e scrivere test RED**

Run: `npm install @codemirror/merge`

```js
assert.match(editor, /source: 'workspace' \| 'remote'/)
assert.match(editor, /window\.vincodeLab\.remoteFiles\.saveLocal/)
assert.match(editor, /Remoto · Modificato/)
assert.match(diff, /MergeView/)
assert.match(diff, /Carica sul server/)
assert.match(diff, /Forza sostituzione/)
```

- [x] **Step 2: eseguire il test e verificare il fallimento**

Run: `node --test test/editor-remote-files.test.cjs`

Expected: FAIL perché Editor e dialog non gestiscono risorse remote.

- [x] **Step 3: introdurre richiesta di apertura controllata da App**

```tsx
const [remoteOpenRequest, setRemoteOpenRequest] = useState<RemoteOpenRequest | null>(null)
const openRemoteInEditor = (id: string) => {
  setRemoteOpenRequest({ id, nonce: Date.now() })
  selectAppSection('editor')
}
```

Passare la callback a `TerminalWorkspace` e la richiesta a `ProjectEditor`. L'Editor apre una sola tab per ID anche se cambia `nonce`.

- [x] **Step 4: separare salvataggio workspace e remoto**

```ts
type EditorTab = {
  id: string; name: string; source: 'workspace' | 'remote'
  content: string; savedContent: string; preview?: PreviewKind
  remote?: { connectionTitle: string; remotePath: string; syncState: 'synced' | 'modified' | 'conflict' | 'offline' }
}
```

`saveActive` chiama `files.save` per `workspace` e `remoteFiles.saveLocal` per `remote`; soltanto il primo aggiorna Git. Il toolbar remoto offre Confronta e Carica, mostra connessione/percorso e non presenta lo stato Git.

- [x] **Step 5: implementare diff e conferme upload**

`RemoteDiffDialog` crea `MergeView` read-only con remoto a sinistra e locale a destra. File binari mostrano hash, dimensione e messaggio “Confronto testuale non disponibile”. Upload normale richiede conferma; conflitto mantiene il dialog aperto e abilita `Forza sostituzione` con una seconda conferma distruttiva.

- [x] **Step 6: eseguire test Editor, build e lint**

Run: `node --test test/editor-remote-files.test.cjs test/editor-ux.test.cjs test/project-files.test.cjs && npm run lint && npm run build`

Expected: PASS; salvataggio remoto non chiama `github.gitStatus` e non invoca upload.

- [x] **Step 7: committare**

```bash
git add package.json package-lock.json src/components/remote-diff-dialog.tsx src/components/project-editor.tsx src/App.tsx src/components/terminal-workspace.tsx src/editor.css test/editor-remote-files.test.cjs
git commit -m "feat: modifica e confronta file remoti nell'editor"
```

---

### Task 10: Operazioni cartella, pulizia cache e resilienza

**Files:**
- Modify: `src/components/remote-files.tsx`
- Modify: `electron/remote-file-service.cjs`
- Modify: `electron/remote-file-store.cjs`
- Modify: `electron/sftp-service.cjs`
- Modify: `src/terminal.css`
- Modify: `test/remote-file-service.test.cjs`
- Modify: `test/remote-files-ui.test.cjs`

**Interfaces:**
- Consumes: API definite nei Task 4–8.
- Produces: creazione cartella, upload picker, rename/delete, elenco copie locali, spazio cache e cleanup selettivo.

- [x] **Step 1: scrivere test RED di operazioni e cleanup**

```js
test('non elimina una copia modificata senza force', (t) => {
  const service = createFixtureService(t, { baseline: 'prima', remoteNow: 'prima', localNow: 'locale', localState: 'modified' })
  assert.throws(() => service.store.removeTrackedFile('/tmp/workspace-a', 'remote-file-1', { force: false }), /modifiche locali/)
})

test('un rename remoto aggiorna il manifesto solo dopo successo SFTP', async (t) => {
  const service = createFixtureService(t)
  await service.rename('/tmp/workspace-a', 'entry-1', 'nuovo nome.txt')
  assert.deepEqual(service.calls.map((call) => call.name), ['rename', 'updateRemotePath'])
})
```

- [x] **Step 2: eseguire test e verificare il fallimento**

Run: `node --test test/remote-file-service.test.cjs test/remote-files-ui.test.cjs`

Expected: FAIL sulle nuove operazioni.

- [x] **Step 3: implementare operazioni con conferme e refresh mirato**

Nuova cartella, upload in cartella, rename e delete lavorano su ID correnti e aggiornano soltanto la directory coinvolta. Link e `unknown` non espongono mutazioni. Delete distingue file/cartella vuota e non offre cancellazione ricorsiva nella prima versione.

- [x] **Step 4: implementare pannello Copie locali**

Mostrare conteggio e spazio, filtro per stato, Mostra nel Finder, Scarta copia e Pulisci sincronizzati. `modified`/`conflict` richiedono selezione esplicita e conferma; cleanup automatico elimina solo temporanei e copie `synced` oltre il limite configurato.

- [x] **Step 5: testare disconnessione e cambio tab**

Run: `node --test test/remote-file-service.test.cjs test/remote-file-store.test.cjs test/remote-files-ui.test.cjs test/terminal-session-history.test.cjs`

Expected: PASS; copie modificate persistono dopo chiusura master e riavvio app.

- [x] **Step 6: committare**

```bash
git add src/components/remote-files.tsx electron/remote-file-service.cjs electron/remote-file-store.cjs electron/sftp-service.cjs src/terminal.css test/remote-file-service.test.cjs test/remote-files-ui.test.cjs
git commit -m "feat: completa la gestione dei file remoti"
```

---

### Task 11: Verifica integrata e collaudo non produttivo

**Files:**
- Modify only if failures require fixes: files introduced in Tasks 1–10
- Update: `docs/superpowers/plans/2026-08-21-terminale-file-remoti-ssh.md` checkboxes

**Interfaces:**
- Consumes: feature completa.
- Produces: evidenza test, collaudo runtime e repository pulito; nessun package.

- [x] **Step 1: eseguire la suite completa**

Run: `npm test`

Expected: tutti i test PASS, zero failure/cancelled/skipped inattesi.

- [x] **Step 2: eseguire controlli statici e build**

Run: `npm run lint`

Expected: exit 0.

Run: `npm run build`

Expected: TypeScript e Vite exit 0.

Run: `git diff --check`

Expected: nessun output.

- [ ] **Step 3: collaudare in hot reload con host non produttivo**

Run: `npm run dev`

Verificare manualmente:

1. comando libero invariato;
2. connessione gestita con prompt host/auth nel PTY;
3. `ssh -O check` e apertura File remoti senza seconda autenticazione;
4. navigazione, ricerca, resize e menu contestuale;
5. download testo/binario, apertura Editor e salvataggio locale;
6. diff e upload atomico;
7. conflitto remoto bloccato e forza sostituzione confermata;
8. interruzione/reconnect e recupero modifiche locali;
9. cambio ripetuto Terminale/File remoti/Editor senza schermate nere;
10. tema chiaro/scuro e finestra 900×600.

- [x] **Step 4: controllare log e dati sensibili**

Run: `rg -n "password|PRIVATE KEY|BEGIN OPENSSH|contenuto" "$HOME/Library/Logs/VincodeLab/VincodeLab/app.log"`

Expected: nessuna credenziale, chiave o contenuto file; gli eventi mostrano solo ID, fase, durata, byte ed esito.

- [x] **Step 5: aggiornare checkboxes, committare eventuali fix e pubblicare**

```bash
git status --short
git add electron/managed-ssh-service.cjs electron/sftp-service.cjs electron/remote-file-store.cjs electron/remote-file-service.cjs electron/main.cjs electron/preload.cjs electron/context-menu.cjs src/components/terminal-workspace.tsx src/components/free-terminal.tsx src/components/remote-files.tsx src/components/remote-diff-dialog.tsx src/components/project-editor.tsx src/App.tsx src/terminal.css src/editor.css src/vincode-lab.d.ts test/workspace-commands.test.cjs test/managed-ssh-service.test.cjs test/sftp-service.test.cjs test/remote-file-store.test.cjs test/remote-file-service.test.cjs test/remote-files-ui.test.cjs test/editor-remote-files.test.cjs test/context-menu.test.cjs test/preload-surface.test.cjs docs/superpowers/plans/2026-08-21-terminale-file-remoti-ssh.md
git diff --cached --quiet || git commit -m "fix: stabilizza il flusso dei file remoti SSH"
git push origin main
```

Se non emergono fix, non creare un commit vuoto. Confermare `git status --short`, `git rev-list --left-right --count origin/main...HEAD` uguale a `0 0` e lasciare il server hot reload attivo per il test utente. Non creare DMG, tag o release.
