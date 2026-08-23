# Impostazioni di sistema e risorse Pi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere disponibili in VincodeLab le preferenze app, la diagnostica Pi, le skill globali e la gestione sicura delle estensioni Pi.

**Architecture:** Le operazioni globali rimangono nel main process. `system-skills` confina le letture e le scritture a `~/.agents/skills`; `pi-system-service` esegue solo sottocomandi Pi consentiti tramite `execFile`. Un PTY separato ospita la TUI `pi config`, mentre React espone una sezione Impostazioni disponibile anche senza workspace.

**Tech Stack:** Electron main/preload con context isolation, Node.js `child_process` e `node-pty`, React 19, TypeScript, xterm.js, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-impostazioni-sistema-pi-design.md`

## Global Constraints

- Le risorse workspace restano in `.agents/skills` e `.pi/APPEND_SYSTEM.md`; le risorse sistema agiscono su tutti i workspace.
- Non leggere, persistere, registrare o rendere accessibili credenziali Pi, token OAuth o chiavi API.
- Ogni installazione, aggiornamento o rimozione di un'estensione richiede conferma nel renderer.
- `pi-system-service` usa un allowlist di `--version`, `list`, `install`, `update` e `remove`, senza shell e con timeout/output limitati.
- Le skill globali sono limitate a `~/.agents/skills`, senza traversal o symlink.
- Nessuna scrittura diretta in `~/.pi/agent/settings.json`; abilitazione e disabilitazione usano solo la TUI nativa `pi config` embedded.

---

## Struttura dei file

- `electron/skill-validation.cjs`: parser e validazione YAML condivisi da skill workspace e globali.
- `electron/system-skills.cjs`: CRUD confinato delle skill in `~/.agents/skills`.
- `electron/pi-system-service.cjs`: diagnostica e gestione pacchetti Pi tramite processi senza shell.
- `electron/main.cjs`: IPC, lifecycle del PTY `pi config` e terminate alla chiusura.
- `electron/preload.cjs` e `src/vincode-lab.d.ts`: contratti IPC minimi e tipizzati.
- `src/components/settings.tsx` e `src/settings.css`: UI Impostazioni, conferme e terminale configurazione Pi.
- `src/App.tsx` e `src/App.css`: tab principale disponibile senza workspace e stile della navigazione.
- `test/system-skills.test.cjs` e `test/pi-system-service.test.cjs`: regressioni dei confini filesystem/processo.
- `test/preload-surface.test.cjs`: verifica statica della superficie IPC esposta.

### Task 1: Estrarre la validazione skill condivisa

**Files:**
- Create: `electron/skill-validation.cjs`
- Modify: `electron/project-skills.cjs`
- Test: `test/project-skills.test.cjs`

**Interfaces:**
- Produces: `NAME_PATTERN`, `extractFrontmatter(content)`, `validateSkill(content, directoryName)`.
- Consumes: `yaml` e il formato `SKILL.md` già in uso.

- [ ] **Step 1: Scrivere il test fallente per una skill valida e una malformata**

```js
const { validateSkill } = require('../electron/skill-validation.cjs')

test('validateSkill segnala frontmatter mancante e accetta una skill valida', () => {
  assert.equal(validateSkill('contenuto', 'demo').valid, false)
  assert.equal(validateSkill('---\nname: demo\ndescription: Skill demo\n---\n', 'demo').valid, true)
})
```

- [ ] **Step 2: Eseguire il test e verificarne il fallimento**

Run: `node --test test/project-skills.test.cjs`

Expected: FAIL con `Cannot find module '../electron/skill-validation.cjs'`.

- [ ] **Step 3: Creare il modulo ed eliminare la duplicazione da `project-skills.cjs`**

```js
// electron/skill-validation.cjs
const YAML = require('yaml')
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function validateSkill(content, directoryName) {
  const { attributes, issue } = extractFrontmatter(content)
  const issues = []
  if (issue) return { valid: false, issues: [{ level: 'error', message: issue }], attributes: null }
  if (typeof attributes?.name !== 'string' || !NAME_PATTERN.test(attributes.name) || attributes.name.length > 64) issues.push({ level: 'error', message: 'name deve contenere 1-64 caratteri lowercase, numeri o trattini.' })
  if (typeof attributes?.description !== 'string' || !attributes.description.trim() || attributes.description.length > 1024) issues.push({ level: 'error', message: 'description è obbligatoria e non può superare 1024 caratteri.' })
  if (attributes?.name && attributes.name !== directoryName) issues.push({ level: 'warning', message: 'Il nome non coincide con la directory; Pi lo accetta, altri harness potrebbero no.' })
  return { valid: !issues.some((entry) => entry.level === 'error'), issues, attributes }
}

module.exports = { NAME_PATTERN, extractFrontmatter, validateSkill }
```

- [ ] **Step 4: Eseguire il test mirato e la suite skill**

Run: `node --test test/project-skills.test.cjs`

Expected: PASS.

### Task 2: Implementare il servizio per skill di sistema confinato

**Files:**
- Create: `electron/system-skills.cjs`
- Test: `test/system-skills.test.cjs`

**Interfaces:**
- Produces: `listSystemSkills(root)`, `getSystemSkill(root, id)`, `createSystemSkill(root, name)`, `updateSystemSkill(root, id, content)`, `deleteSystemSkill(root, id)`.
- Consumes: `validateSkill` e `writeFileAtomic`; il parametro `root` è fornito dal main process come `path.join(os.homedir(), '.agents', 'skills')`.

- [ ] **Step 1: Scrivere i test fallenti di confinamento**

```js
test('rifiuta traversal e directory symlink per le skill di sistema', () => {
  assert.throws(() => getSystemSkill(root, '../esterna'), /Percorso skill non valido/)
  fs.symlinkSync(external, path.join(root, 'linked'), 'dir')
  assert.throws(() => getSystemSkill(root, 'linked'), /non è sicura/)
})
```

- [ ] **Step 2: Eseguire il test e verificarne il fallimento**

Run: `node --test test/system-skills.test.cjs`

Expected: FAIL con modulo/funzione inesistente.

- [ ] **Step 3: Implementare CRUD con root immutabile e file regolari**

```js
function getSystemSkill(root, skillId) {
  const candidate = getSkillPath(root, skillId)
  assertRegularFile(candidate, 'Skill non trovata.')
  return toSkill(root, candidate, true)
}
```

Riutilizzare i limiti: massimo 500 skill, profondità 8, contenuto massimo 200.000 caratteri, directory `0700` e file `0600`.

- [ ] **Step 4: Eseguire i test del servizio**

Run: `node --test test/system-skills.test.cjs test/project-skills.test.cjs`

Expected: PASS.

### Task 3: Implementare diagnostica e gestione pacchetti Pi

**Files:**
- Create: `electron/pi-system-service.cjs`
- Test: `test/pi-system-service.test.cjs`

**Interfaces:**
- Produces: `getPiSystemStatus(resolveExecutable, run)`, `listPiPackages(resolveExecutable, run)`, `installPiPackage(source, resolveExecutable, run)`, `updatePiPackage(source, resolveExecutable, run)`, `removePiPackage(source, resolveExecutable, run)`.
- `run(executable, args)` restituisce `{ stdout, stderr }`; in produzione usa `execFile` con `timeout: 30_000` e `maxBuffer: 1_048_576`.

- [ ] **Step 1: Scrivere i test fallenti per allowlist e parser `pi list`**

```js
test('installPiPackage rifiuta sorgenti con controlli e usa argomenti non shell', async () => {
  await assert.rejects(() => installPiPackage('x\n--flag', resolve, run), /Sorgente estensione non valida/)
  await installPiPackage('owner/plugin', resolve, run)
  assert.deepEqual(calls[0].args, ['install', 'owner/plugin'])
})

test('listPiPackages trasforma "No packages installed." in un elenco vuoto', async () => {
  assert.deepEqual(await listPiPackages(resolve, async () => ({ stdout: 'No packages installed.\n', stderr: '' })), [])
})
```

- [ ] **Step 2: Eseguire il test e verificarne il fallimento**

Run: `node --test test/pi-system-service.test.cjs`

Expected: FAIL con modulo non trovato.

- [ ] **Step 3: Implementare il servizio con `execFile`, validazione e parsing conservativo**

```js
const { execFile } = require('node:child_process')

function assertPackageSource(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 2048 || /[\0-\x1f]/.test(source)) {
    throw new Error('Sorgente estensione non valida.')
  }
  return source.trim()
}
```

Non estrarre dati da `settings.json`; restituire righe pacchetto come testo normalizzato se il formato futuro di Pi non è strutturato.

- [ ] **Step 4: Eseguire il test del servizio**

Run: `node --test test/pi-system-service.test.cjs`

Expected: PASS.

### Task 4: Esporre IPC sicuro e PTY `pi config`

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Test: `test/preload-surface.test.cjs`

**Interfaces:**
- Produces: `window.vincodeLab.systemSkills`, `window.vincodeLab.piSystem` e `window.vincodeLab.piConfig`.
- `piConfig` espone solo `start`, `write(data)`, `resize(dimensions)`, `close`, `onData(listener)`, `onExit(listener)`.

- [ ] **Step 1: Scrivere il test fallente della superficie preload**

```js
test('preload espone soltanto le API delle impostazioni previste', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  assert.match(source, /systemSkills:/)
  assert.match(source, /piSystem:/)
  assert.match(source, /piConfig:/)
  assert.doesNotMatch(source, /require\(['"]node:fs/)
})
```

- [ ] **Step 2: Eseguire il test e verificarne il fallimento**

Run: `node --test test/preload-surface.test.cjs`

Expected: FAIL perché le API non sono ancora esposte.

- [ ] **Step 3: Collegare IPC con `assertTrustedSender` e lifecycle PTY**

```js
function startPiConfig() {
  if (piConfigProcess) return { started: false, reused: true }
  const executable = resolvePiExecutable()
  if (!executable) throw new Error('Pi non è stato trovato.')
  piConfigProcess = pty.spawn(executable, ['config'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 34,
    cwd: app.getPath('home'),
    env: { ...process.env, TERM: 'xterm-256color' },
  })
  return { started: true, reused: false }
}
```

Aggiungere `stopPiConfig()` alla chiusura finestra/app e convalidare input/resize con gli stessi limiti della sessione Pi esistente.

- [ ] **Step 4: Eseguire il test preload e i controlli di sintassi**

Run: `node --test test/preload-surface.test.cjs && node --check electron/main.cjs && node --check electron/preload.cjs`

Expected: PASS senza errori di sintassi.

### Task 5: Costruire la sezione Impostazioni

**Files:**
- Create: `src/components/settings.tsx`
- Create: `src/settings.css`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Test: `test/settings-ui.test.cjs`

**Interfaces:**
- Consumes: le API tipizzate da Task 4 e `ConfirmationDialog`/`Button` già presenti.
- Produces: tab principale `Impostazioni`, accessibile anche senza workspace.

- [ ] **Step 1: Scrivere un test di compilazione UI che fallisce senza il componente**

```js
test('la navigazione principale dichiara la sezione Impostazioni', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  assert.match(source, /Impostazioni/)
  assert.match(source, /<Settings/)
})
```

- [ ] **Step 2: Eseguire il test e verificarne il fallimento**

Run: `node --test test/settings-ui.test.cjs`

Expected: FAIL con assenza di `Impostazioni`.

- [ ] **Step 3: Implementare la UI senza dati simulati**

```tsx
<button aria-controls="app-panel-settings" aria-selected={appSection === 'settings'} role="tab">
  <Settings aria-hidden="true" size={14} /> Impostazioni
</button>
```

Implementare pannelli Generali, Pi, Skill di sistema ed Estensioni. Usare `ConfirmationDialog` per installazione, aggiornamento, rimozione e cancellazione skill. Visualizzare "Nessuna estensione installata" solo quando `pi list` restituisce davvero un elenco vuoto. Il terminale `pi config` deve apparire solo dopo **Configura in Pi** e offrire chiusura esplicita.

- [ ] **Step 4: Eseguire build e lint**

Run: `npm run lint && npm run build`

Expected: PASS.

### Task 6: Verifica integrata e documentazione operativa

**Files:**
- Modify: `README.md`
- Modify: `docs/PRD/VincodeLab_Fase1_PRD.md`
- Test: `test/pi-system-service.test.cjs`, `test/system-skills.test.cjs`, `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: tutti i contratti precedenti.
- Produces: documentazione aggiornata sul perimetro globale e sulla conferma delle mutazioni.

- [ ] **Step 1: Aggiornare README e PRD con i confini reali**

Documentare i percorsi delle skill di progetto/sistema, la gestione estensioni via Pi, il PTY `pi config` e il divieto di gestione credenziali.

- [ ] **Step 2: Eseguire l'intera suite**

Run: `npm test`

Expected: PASS senza test omessi o falliti.

- [ ] **Step 3: Eseguire verifiche statiche e packaging**

Run: `npm run lint && npm run build && git diff --check && npm run package`

Expected: tutti i comandi completano con exit code `0`.

- [ ] **Step 4: Verificare manualmente la build macOS**

Aprire `dist/mac-arm64/VincodeLab.app`; verificare Impostazioni senza workspace, inventario reale delle estensioni, conferma prima di una mutazione (senza eseguirla), apertura/chiusura di `pi config` e assenza di dati sensibili nell'interfaccia.

- [ ] **Step 5: Creare il commit solo dopo l'inizializzazione del repository**

Il checkout non ha un commit iniziale. Quando il repository sarà inizializzato, usare:

```bash
git add electron src test docs README.md package.json package-lock.json
git commit -m "feat: aggiunge impostazioni sistema e gestione risorse Pi"
```
