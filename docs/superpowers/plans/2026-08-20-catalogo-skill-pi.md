# Catalogo Skill Pi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere visibili in Impostazioni tutte le skill globali realmente caricate dai pacchetti Pi, separandole dalle skill manuali e senza alcuna sorgente Codex.

**Architecture:** Il main process legge le radici dei pacchetti solo dall'output di `pi list` e ispeziona in sola lettura manifest `package.json` e directory skill. Il renderer riceve DTO serializzabili: skill manuali modificabili e skill dei pacchetti read-only. La tab Pacchetti Pi usa sorgenti npm, Git e locali.

**Tech Stack:** Electron main/preload, Node.js `fs`/`path`, React, TypeScript, Node test runner, oxlint, Vite.

**Spec:** `docs/superpowers/specs/2026-08-20-pacchetti-pi-sorgenti-design.md`

## Global Constraints

- Leggere solo risorse Pi sotto `~/.pi/agent` o radici restituite da `pi list`; nessun fallback Codex.
- Renderer privo di Node; ogni IPC verifica `assertTrustedSender`.
- Nessuna modifica ai file interni dei pacchetti; il catalogo dei pacchetti e' read-only.
- `execFile`, un solo argomento sorgente, nessuna shell interpolation.
- Validazione in sviluppo con test, lint e build; nessun packaging macOS.

---

### Task 1: Catalogo read-only delle skill dei pacchetti Pi

**Files:**
- Create: `electron/pi-package-skills.cjs`
- Modify: `electron/pi-system-service.cjs`
- Create: `test/pi-package-skills.test.cjs`
- Modify: `test/pi-system-service.test.cjs`

**Interfaces:**
- Produces: `parsePiPackageList(output): Array<{ source: string, root: string }>`.
- Produces: `listPiPackageSkills(packages): Array<{ id, name, description, valid, issues, source, packageName, relativePath }>`.

- [ ] **Step 1: Scrivere il test rosso per il parser**

```js
test('parsePiPackageList associa source e radice', () => {
  const output = 'User packages:\n  npm:@scope/skill\n    /tmp/pi/npm/node_modules/@scope/skill\n'
  assert.deepEqual(parsePiPackageList(output), [{ source: 'npm:@scope/skill', root: '/tmp/pi/npm/node_modules/@scope/skill' }])
})
```

- [ ] **Step 2: Eseguire il test rosso**

Run: `node --test test/pi-package-skills.test.cjs`

Expected: FAIL perché `parsePiPackageList` non esiste.

- [ ] **Step 3: Scrivere il test rosso per la discovery da manifest**

```js
test('listPiPackageSkills legge skill dichiarate in pi.skills', () => {
  const skills = listPiPackageSkills([{ source: 'npm:workflow', root }])
  assert.deepEqual(skills.map(({ name, source }) => ({ name, source })), [{ name: 'review', source: 'npm:workflow' }])
})
```

La fixture contiene `package.json` con `{ pi: { skills: ['./workflow-skills'] } }` e `workflow-skills/review/SKILL.md` valido.

- [ ] **Step 4: Eseguire il test rosso**

Run: `node --test test/pi-package-skills.test.cjs`

Expected: FAIL perché `listPiPackageSkills` non esiste.

- [ ] **Step 5: Implementare il catalogo**

```js
function parsePiPackageList(output) { /* accetta solo source + percorso assoluto */ }
function listPiPackageSkills(packages) { /* pi.skills oppure directory ./skills */ }
```

Usare `validateSkill`; ignorare manifest non validi, directory assenti, symlink e traversal senza fermare gli altri pacchetti. Raccogliere `SKILL.md` e `.md` diretti, massimo 500 voci per pacchetto. Restituire ID `<source>::<relativePath>` deduplicati.

- [ ] **Step 6: Collegare il servizio Pi**

```js
async function listPiPackageSkills(resolveExecutable, run = defaultRun) {
  const packages = await listPiPackages(resolveExecutable, run)
  return discoverPiPackageSkills(packages)
}
```

`listPiPackages` restituisce ora record source/root analizzando `pi list`; il test mantiene il caso `No packages installed.` e verifica `['list']` come unico argomento.

- [ ] **Step 7: Verificare e committare Task 1**

Run: `node --test test/pi-package-skills.test.cjs test/pi-system-service.test.cjs`

Expected: PASS.

Commit: `git add electron/pi-package-skills.cjs electron/pi-system-service.cjs test/pi-package-skills.test.cjs test/pi-system-service.test.cjs && git commit -m "feat: legge le skill dai pacchetti Pi"`

### Task 2: IPC tipizzato per il catalogo Pi

**Files:**
- Modify: `electron/main.cjs:513-517`
- Modify: `electron/preload.cjs:45-47`
- Modify: `src/vincode-lab.d.ts:149-150`
- Modify: `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: `listPiPackageSkills(resolvePiExecutable)`.
- Produces: `window.vincodeLab.piSystem.listSkills(): Promise<PiPackageSkill[]>`.

- [ ] **Step 1: Scrivere il test rosso della superficie preload**

```js
assert.match(source, /listSkills: \(\) => ipcRenderer\.invoke\('piSystem:listSkills'\)/)
```

- [ ] **Step 2: Eseguire il test rosso**

Run: `node --test test/preload-surface.test.cjs`

Expected: FAIL perché API e handler non esistono.

- [ ] **Step 3: Implementare handler, preload e tipo**

```js
ipcMain.handle('piSystem:listSkills', (event) => {
  assertTrustedSender(event)
  return listPiPackageSkills(resolvePiExecutable)
})
```

Aggiungere `PiPackageSkill` ai type declaration. Non esporre contenuti, radici assolute o API di scrittura.

- [ ] **Step 4: Verificare e committare Task 2**

Run: `node --test test/preload-surface.test.cjs`

Expected: PASS.

Commit: `git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs && git commit -m "feat: espone il catalogo skill dei pacchetti Pi"`

### Task 3: Catalogo Skill Pi e tab Pacchetti Pi

**Files:**
- Modify: `src/components/settings.tsx`
- Modify: `src/settings.css`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `systemSkills.list()` e `piSystem.listSkills()`.
- Produces: gruppi **Manuali** editabili e **Da pacchetti Pi** read-only; selettore sorgente pacchetto.

- [ ] **Step 1: Scrivere il test rosso della UI**

```js
assert.match(settings, /window\.vincodeLab\.piSystem\.listSkills\(\)/)
assert.match(settings, />Manuali</)
assert.match(settings, />Da pacchetti Pi</)
assert.match(settings, /source=\{packageSource\}/)
assert.doesNotMatch(settings, /\.codex\/skills/)
```

- [ ] **Step 2: Eseguire il test rosso**

Run: `node --test test/ui-design-system.test.cjs`

Expected: FAIL perché la UI usa un solo elenco e la vecchia terminologia Estensioni Pi.

- [ ] **Step 3: Implementare i gruppi Skill Pi**

```tsx
const [packageSkills, setPackageSkills] = useState<PiPackageSkill[]>([])
const [nextStatus, nextSkills, nextPackages, nextPackageSkills] = await Promise.all([
  window.vincodeLab.piSystem.status(), window.vincodeLab.systemSkills.list(),
  window.vincodeLab.piSystem.list(), window.vincodeLab.piSystem.listSkills(),
])
```

Il gruppo Manuali mantiene create/select/edit/delete. Il gruppo Da pacchetti Pi mostra nome, descrizione, sorgente e avvisi, senza textarea o azioni distruttive. Mantenere un unico scroll, ellipsis e tooltip per sorgenti lunghe.

- [ ] **Step 4: Rinominare e normalizzare Pacchetti Pi**

```tsx
<select value={packageSource} onChange={...} aria-label="Sorgente pacchetto Pi">
  <option value="npm">Catalogo Pi (npm)</option>
  <option value="git">Git</option>
  <option value="local">Locale</option>
</select>
```

Per npm aggiungere un solo prefisso `npm:` prima della conferma. Git e Locale passano inalterati. Aggiornare titoli, placeholder e conferme a “pacchetto Pi”.

- [ ] **Step 5: Verificare e committare Task 3**

Run: `node --test test/ui-design-system.test.cjs`

Expected: PASS.

Commit: `git add src/components/settings.tsx src/settings.css test/ui-design-system.test.cjs && git commit -m "feat: mostra le skill globali dei pacchetti Pi"`

### Task 4: Collaudo integrato

**Files:**
- Modify: `test/pi-package-skills.test.cjs` solo per un formato documentato di `pi list` emerso nel collaudo.

- [ ] **Step 1: Verifica completa**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: tutti i test passano, lint e build codice 0, nessun errore whitespace.

- [ ] **Step 2: Riavviare Electron in sviluppo**

Riavviare il solo main process contro Vite gia' attivo; non creare un pacchetto macOS.

- [ ] **Step 3: Collaudare Skill Pi**

Verificare il gruppo Manuali e una skill da `git:github.com/obra/superpowers`, senza percorsi Codex e senza modifica/cancellazione degli elementi di pacchetto.

- [ ] **Step 4: Collaudare Pacchetti Pi**

Verificare i tre selettori, il prefisso npm e le conferme; non installare, aggiornare o rimuovere pacchetti reali senza richiesta esplicita.
