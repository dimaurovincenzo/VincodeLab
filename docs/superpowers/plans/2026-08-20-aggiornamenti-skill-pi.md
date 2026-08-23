# Aggiornamenti Skill e Pi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere disponibili in Impostazioni gli aggiornamenti verificati e reversibili delle skill Pi in `~/.pi/agent/skills`, delle estensioni Pi e del runtime Pi.

**Architecture:** Il main process mantiene lo stato globale in SQLite e divide controllo remoto, staging e attivazione in servizi senza superficie renderer. Il renderer riceve DTO privi di segreti tramite preload e gestisce solo presentazione, filtri, conferme e richieste per ID.

**Tech Stack:** Electron, Node.js CommonJS, `better-sqlite3`, React, TypeScript, CSS esistente, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-20-aggiornamenti-skill-pi-design.md`

## Global Constraints

- I canali `skill`, `pi-extension` e `pi-runtime` sono globali e indipendenti dal workspace; `skill` usa esclusivamente il catalogo Pi `~/.pi/agent/skills`, non `~/.agents/skills`.
- La policy iniziale è `manual`; l'automatico è opt-in e include le versioni major.
- Sorgente, proprietario, repository, ref e canale registrati non cambiano automaticamente.
- Il controllo non esegue codice; download e attivazione avvengono in fasi separate.
- Un aggiornamento pronto richiede riavvio; l'attivazione è atomica e conserva un solo backup ripristinabile.
- Ogni IPC verifica il sender; preload e DTO non espongono Node, token, percorsi sensibili o comandi.
- Sviluppo solo con hot reload, senza packaging macOS.

---

### Task 1: Store globale degli aggiornamenti

**Files:**
- Modify: `electron/workspace-store.cjs`
- Create: `electron/update-store.cjs`
- Create: `test/update-store.test.cjs`

**Interfaces:**
- Produces: `listManagedUpdates()`, `getManagedUpdate(id)`, `upsertManagedUpdate(input)`, `setManagedUpdatePolicy(id, policy)`, `recordAvailableUpdate(id, available)`, `recordStagedUpdate(id, staged)`, `listRestartRequiredUpdates()`, `recordActivationResult(id, result)`.
- Consumes: `getDatabase()` from `electron/workspace-store.cjs`.

- [ ] **Step 1: Write the failing store tests**

```js
test('isola stato e policy dei tre canali', () => {
  upsertManagedUpdate(skill)
  upsertManagedUpdate(extension)
  setManagedUpdatePolicy(skill.id, 'automatic')
  assert.equal(getManagedUpdate(skill.id).policy, 'automatic')
  assert.equal(getManagedUpdate(extension.id).policy, 'manual')
})

test('conserva solo il backup dell ultima attivazione riuscita', () => {
  recordActivationResult('skill-a', { activeVersion: '2', previousVersion: '1', success: true })
  recordActivationResult('skill-a', { activeVersion: '3', previousVersion: '2', success: true })
  assert.equal(getManagedUpdate('skill-a').rollbackVersion, '2')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test test/update-store.test.cjs`

Expected: FAIL because `electron/update-store.cjs` does not exist.

- [ ] **Step 3: Add schema and minimal store**

Create `managed_updates` in the existing local database with constrained `kind`, `policy`, status, active/available/rollback metadata and normalized error. Validate IDs, enum values and bounded text before SQL; store source metadata only in main-process records.

- [ ] **Step 4: Run focused and complete regression tests**

Run: `node --test test/update-store.test.cjs && npm test`

Expected: PASS with no pre-existing failure.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace-store.cjs electron/update-store.cjs test/update-store.test.cjs
git commit -m "feat: salva lo stato degli aggiornamenti globali"
```

### Task 2: Controllo remoto senza esecuzione

**Files:**
- Create: `electron/update-checker.cjs`
- Create: `test/update-checker.test.cjs`
- Modify: `electron/pi-system-service.cjs`

**Interfaces:**
- Consumes: record DTO da `getManagedUpdate()` e `resolvePiExecutable()`.
- Produces: `checkManagedUpdate(record, dependencies)` e `checkEligibleUpdates(records, now)` con risultato `{ available, checkedAt, changelog }` o errore normalizzato.

- [ ] **Step 1: Write failing checker tests**

```js
test('non segnala disponibilita quando commit e ref coincidono', async () => {
  const result = await checkManagedUpdate(githubSkill, { readRemoteRef: async () => 'abc' })
  assert.deepEqual(result, { available: false, checkedAt: NOW, changelog: null })
})

test('rifiuta una risposta GitHub che cambia proprietario o repository', async () => {
  await assert.rejects(() => checkManagedUpdate(githubSkill, { readRemoteRef: async () => ({ owner: 'altro', repository: 'repo', commit: 'def' }) }), /Sorgente.*autorizzata/)
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `node --test test/update-checker.test.cjs`

Expected: FAIL because `checkManagedUpdate` is absent.

- [ ] **Step 3: Implement bounded metadata checks**

Use argument arrays with `execFile`, bounded timeout/output and a 24-hour eligibility check. For GitHub compare only the approved owner/repository/ref; for Pi runtime inspect version metadata without modifying the executable. Map network, rate-limit and malformed metadata to Italian normalized errors.

- [ ] **Step 4: Verify focused and full tests**

Run: `node --test test/update-checker.test.cjs test/pi-system-service.test.cjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/update-checker.cjs electron/pi-system-service.cjs test/update-checker.test.cjs test/pi-system-service.test.cjs
git commit -m "feat: controlla gli aggiornamenti Pi senza eseguire contenuti"
```

### Task 3: Staging, attivazione atomica e rollback

**Files:**
- Create: `electron/update-downloader.cjs`
- Create: `electron/update-activation.cjs`
- Create: `test/update-lifecycle.test.cjs`
- Modify: `electron/system-skills.cjs`

**Interfaces:**
- Consumes: managed update records and `recordStagedUpdate()` / `recordActivationResult()`.
- Produces: `stageManagedUpdate(id)`, `activatePendingUpdates()` and `rollbackManagedUpdate(id)`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('uno staging incompleto non diventa attivabile', async () => {
  await assert.rejects(() => stageManagedUpdate(update, failingDownload), /integrita/)
  assert.equal(getManagedUpdate(update.id).restartRequired, false)
})

test('un health check fallito ripristina automaticamente la versione precedente', async () => {
  await activatePendingUpdates({ healthCheck: async () => false })
  assert.equal(getManagedUpdate(update.id).activeVersion, '1.0.0')
  assert.match(getManagedUpdate(update.id).lastError, /verifica/)
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `node --test test/update-lifecycle.test.cjs`

Expected: FAIL because lifecycle services are absent.

- [ ] **Step 3: Implement staging and activation boundaries**

Write only under the app data directory with restrictive permissions. Download to a temporary sibling, validate type-specific content, atomically rename into staging, and retain one rollback directory. At startup activate one record at a time, run type-specific health checks, and rollback automatically on failure; never replace the approved origin metadata.

- [ ] **Step 4: Verify focused and complete tests**

Run: `node --test test/update-lifecycle.test.cjs test/system-skills.test.cjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/update-downloader.cjs electron/update-activation.cjs electron/system-skills.cjs test/update-lifecycle.test.cjs test/system-skills.test.cjs
git commit -m "feat: attiva gli aggiornamenti con rollback automatico"
```

### Task 4: Orchestrazione main e IPC strettamente tipizzato

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `test/preload-surface.test.cjs`
- Create: `test/update-ipc.test.cjs`

**Interfaces:**
- Produces preload `updates.list()`, `updates.check(id?)`, `updates.download(id)`, `updates.downloadAll()`, `updates.setPolicy(id, policy)`, `updates.rollback(id)` and `updates.activatePending()`.
- Consumes `assertTrustedSender`, update store/checker/downloader/activation services.

- [ ] **Step 1: Write failing IPC and preload tests**

```js
test('preload espone solo operazioni update per id e policy', () => {
  assert.match(preload, /updates: \{[\s\S]*download: \(id\)/)
  assert.doesNotMatch(preload, /updates:[\s\S]*node:fs/)
})

test('ogni canale aggiornamenti verifica il sender prima del servizio', () => {
  for (const channel of ['updates:list', 'updates:check', 'updates:download', 'updates:rollback']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${channel}'[\\s\\S]{0,180}assertTrustedSender`))
  }
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `node --test test/update-ipc.test.cjs test/preload-surface.test.cjs`

Expected: FAIL because the `updates` preload surface does not exist.

- [ ] **Step 3: Add minimal DTO-only IPC orchestration**

Validate each ID and policy in main, call services by installed record rather than renderer input, and return sanitized DTOs. Schedule non-forced automatic checks only for records older than 24 hours. Run `activatePendingUpdates()` once during app startup after storage initialization; log lifecycle events without credentials, paths or raw command output.

- [ ] **Step 4: Verify IPC surface and full suite**

Run: `node --test test/update-ipc.test.cjs test/preload-surface.test.cjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs test/update-ipc.test.cjs
git commit -m "feat: espone gli aggiornamenti tramite IPC sicuro"
```

### Task 5: Tab Aggiornamenti nelle Impostazioni

**Files:**
- Modify: `src/components/settings.tsx`
- Modify: `src/settings.css`
- Modify: `test/settings-ui.test.cjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes `window.vincodeLab.updates` DTO only.
- Produces tab `updates` con lista, filtri, badge, azioni e banner di riavvio.

- [ ] **Step 1: Write failing UI structure tests**

```js
test('Impostazioni presenta la tab Aggiornamenti e filtri per canale', () => {
  assert.match(settings, /type SettingsTab = .*'updates'/)
  assert.match(settings, />Aggiornamenti</)
  for (const label of ['Skill', 'Estensioni Pi', 'Runtime Pi']) assert.match(settings, new RegExp(label))
})

test('il rollback richiede una conferma e lo stato pronto richiede riavvio', () => {
  assert.match(settings, /title: 'Ripristina versione precedente'/)
  assert.match(settings, /Aggiornamenti pronti.*riavvia per attivarli/)
})
```

- [ ] **Step 2: Run focused test and verify it fails**

Run: `node --test test/settings-ui.test.cjs test/ui-design-system.test.cjs`

Expected: FAIL because the updates tab is absent.

- [ ] **Step 3: Implement the responsive view**

Extend the current horizontal settings tab list. Render badge count, kind filter, active/available version, source label, last check and normalized status. Disable unavailable actions with their prerequisite explanation; use `ConfirmationDialog` for rollback; retain one page scroll and use design tokens, compact controls and accessible labels.

- [ ] **Step 4: Verify UI tests, lint and build**

Run: `node --test test/settings-ui.test.cjs test/ui-design-system.test.cjs && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings.tsx src/settings.css test/settings-ui.test.cjs test/ui-design-system.test.cjs
git commit -m "feat: mostra gli aggiornamenti globali nelle impostazioni"
```

### Task 6: Collaudo integrato e documentazione operativa

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-aggiornamenti-skill-pi-design.md` only if implementation reveals a required contract refinement.
- Modify: `docs/memory/project-summary.md` only if it exists and has active architecture content.

- [ ] **Step 1: Execute complete automated verification**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: all tests pass, lint/build pass and no whitespace errors.

- [ ] **Step 2: Perform hot-reload manual checks**

Use an installed skill, a Pi extension and the Pi runtime metadata only when locally available. Verify check, manual download to ready state, restart banner, disabled action prerequisite and rollback confirmation; do not package or use credentials.

- [ ] **Step 3: Reconcile the design document**

Add only an implementation clarification if a real constrained contract differs from the approved spec. Do not append logs or secrets.

- [ ] **Step 4: Commit verification/documentation delta if any**

```bash
git add docs/superpowers/specs/2026-08-20-aggiornamenti-skill-pi-design.md docs/memory/project-summary.md
git commit -m "docs: allinea la verifica degli aggiornamenti Pi"
```
