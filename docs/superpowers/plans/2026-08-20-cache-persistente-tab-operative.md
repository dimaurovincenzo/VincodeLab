# Cache persistente delle tab operative Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere immediate le tab Git e GitHub del workspace con cache SQLite offline-first, TTL differenziati e freschezza esplicita.

**Architecture:** Il processo Electron principale mantiene cache per workspace in `vincodelab.sqlite`; il renderer riceve DTO cache-aware ma non conosce SQL o TTL. Le letture rendono subito cache e aggiornano dal remoto solo quando scadute o forzate; le mutazioni invalidano solo le chiavi dipendenti.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Node test runner, `better-sqlite3`, Git CLI, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-08-20-cache-persistente-tab-design.md`

## Global Constraints

- Riutilizzare `vincodelab.sqlite` in WAL; nessuna dipendenza o database aggiuntivo.
- Non salvare token, credenziali, segreti, comandi raw o output terminale.
- Cache solo stato Git, grafo, issue/Projects GitHub e board; escludere PTY Pi ed editor file.
- TTL: stato Git 10 s, issue/Projects e board 60 s, grafo 5 min.
- Cache isolata per percorso workspace e chiave; `Aggiorna` bypassa sempre TTL.
- Ogni IPC mantiene `assertTrustedSender` e `requireActiveWorkspace`.
- Prima dell’handoff eseguire `npm test && npm run lint && npm run build && git diff --check`.

---

## File structure

- Modify: `electron/workspace-store.cjs` — espone la connessione SQLite esistente solo ai moduli Electron.
- Create: `electron/workspace-cache.cjs` — schema, serializzazione, TTL, lettura/scrittura/invalidatione e cleanup.
- Modify: `electron/github-service.cjs` — letture cache-aware e invalidazione mutativa.
- Modify: `electron/main.cjs`, `electron/preload.cjs`, `src/vincode-lab.d.ts` — IPC e DTO cache-aware.
- Modify: `src/components/github-workspace.tsx`, `src/github.css` — cache-first, refresh in background e freschezza.
- Create: `test/workspace-cache.test.cjs` — contratti SQLite cache.
- Modify: `test/github-service.test.cjs`, `test/preload-surface.test.cjs`, `test/ui-design-system.test.cjs` — integrazione, IPC e UX.

### Task 1: Archivio SQLite cache per workspace

**Files:**
- Create: `electron/workspace-cache.cjs`
- Modify: `electron/workspace-store.cjs`
- Create: `test/workspace-cache.test.cjs`

**Interfaces:**
- Produces: `readCache(workspacePath, resourceKey, now)`, `writeCache(workspacePath, resourceKey, payload, ttlMs, now)`, `invalidateCache(workspacePath, keys)`, `purgeExpiredCache(now)`.
- Consumes: `getDatabase()` da `workspace-store.cjs`.

- [x] **Step 1: Scrivere il test RED per TTL e isolamento**

```js
writeCache('/tmp/a', 'github:data', { issues: [] }, 60_000, 1_000)
writeCache('/tmp/b', 'github:data', { issues: [{ number: 7 }] }, 60_000, 1_000)
assert.equal(readCache('/tmp/a', 'github:data', 61_001).cache.stale, true)
assert.deepEqual(readCache('/tmp/b', 'github:data', 1_001).data, { issues: [{ number: 7 }] })
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/workspace-cache.test.cjs`

Expected: FAIL perché il modulo cache non esiste.

- [x] **Step 3: Implementare schema e validazione**

```js
const MAX_CACHE_BYTES = 2 * 1024 * 1024
database.exec(`CREATE TABLE IF NOT EXISTS workspace_cache (workspace_path TEXT NOT NULL, resource_key TEXT NOT NULL, payload_json TEXT NOT NULL, fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (workspace_path, resource_key))`)
```

Serializzare JSON prima della write, rifiutare payload oltre limite e cancellare una riga con JSON corrotto durante read. Restituire `{ data, cache: { fetchedAt, expiresAt, stale } }` o `null`.

- [x] **Step 4: Implementare invalidazione e cleanup**

```js
function invalidateCache(workspacePath, keys) { const statement = getDatabase().prepare('DELETE FROM workspace_cache WHERE workspace_path = ? AND resource_key = ?'); getDatabase().transaction(() => keys.forEach((key) => statement.run(workspacePath, key)))() }
```

Chiamare `purgeExpiredCache(now)` in write; eliminare soltanto voci scadute da oltre 24 ore.

- [x] **Step 5: Eseguire il GREEN e commit**

Run: `node --test test/workspace-cache.test.cjs`

Expected: PASS per TTL, workspace separati, JSON corrotto, limite payload e invalidazione selettiva.

```bash
git add electron/workspace-store.cjs electron/workspace-cache.cjs test/workspace-cache.test.cjs && git commit -m "feat: aggiunge cache SQLite isolata per workspace"
```

### Task 2: Letture Git e GitHub cache-aware

**Files:**
- Modify: `electron/github-service.cjs`
- Modify: `test/github-service.test.cjs`

**Interfaces:**
- Produces: `getCachedGitStatus(workspacePath, { force, now })`, `getCachedGitHubData(workspacePath, { force, now })`, `getCachedProjectBoard(workspacePath, number, { force, now })`.
- Consumes: Task 1 e `getGitStatus`, `getGitHubData`, `getLinkedProjectBoard` esistenti.

- [x] **Step 1: Scrivere il test RED per cache e refresh forzato**

```js
writeCache(workspace, 'github:data', fixture, 60_000, 1_000)
const cached = await getCachedGitHubData(workspace, { force: false, now: 1_001 })
assert.equal(cached.cache.stale, false)
const forced = await getCachedGitHubData(workspace, { force: true, now: 1_001 })
assert.equal(fakeGhCallCount, 1)
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/github-service.test.cjs`

Expected: FAIL perché le letture cache-aware non esistono.

- [x] **Step 3: Definire chiavi e TTL chiusi**

```js
const CACHE_TTL = { gitStatus: 10_000, gitGraph: 300_000, githubData: 60_000, projectBoard: 60_000 }
const projectBoardCacheKey = (number) => `github:project-board:${number}`
```

Usare chiavi `git:status`, `git:graph`, `github:data` e `github:project-board:<numero>`; ricomporre `GitStatus` da stato e grafo senza modificare i DTO mutativi.

- [x] **Step 4: Implementare fallback offline**

```js
async function getCachedResource(workspacePath, key, ttlMs, load, { force = false } = {}) { const cached = readCache(workspacePath, key); if (cached && !cached.cache.stale && !force) return cached; try { return writeCache(workspacePath, key, await load(), ttlMs) } catch (error) { if (cached) return { ...cached, cache: { ...cached.cache, stale: true, refreshError: true } }; throw error } }
```

- [x] **Step 5: Eseguire il GREEN e commit**

Run: `node --test test/github-service.test.cjs`

Expected: PASS per cache valida, scaduta, force refresh e fallback offline.

```bash
git add electron/github-service.cjs test/github-service.test.cjs && git commit -m "feat: memorizza letture Git e GitHub con TTL"
```

### Task 3: Invalidazione precisa dopo mutazioni

**Files:**
- Modify: `electron/github-service.cjs`
- Modify: `test/github-service.test.cjs`

**Interfaces:**
- Produces: `invalidateGitCache(workspacePath)`, `invalidateGitHubDataCache(workspacePath)`, `invalidateProjectBoardCache(workspacePath, number)`.
- Consumes: `invalidateCache` Task 1 e mutazioni esistenti.

- [x] **Step 1: Scrivere i test RED mutazione→chiavi**

```js
await commit(workspace, 'Aggiorna cache')
assert.deepEqual(invalidatedKeys, ['git:status', 'git:graph'])
await updateWorkspaceProjectItem(workspace, 5, 'PVTI_a', 'PVTSSF_b', { type: 'clear' })
assert.deepEqual(invalidatedKeys, ['github:data', 'github:project-board:5'])
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/github-service.test.cjs`

Expected: FAIL perché le mutazioni non invalidano la cache.

- [x] **Step 3: Collegare le invalidazioni**

Dopo staging, commit, push, pull, fetch, cambio/creazione branch e remote invalidare `git:status` e `git:graph`. Dopo issue/Project create-update-close-archive invalidare `github:data`; se esiste `projectNumber`, invalidare anche la sua board. Nessuna invalidazione può usare un workspace differente.

- [x] **Step 4: Eseguire il GREEN e commit**

Run: `node --test test/github-service.test.cjs`

Expected: PASS; staging non invalida Projects e una mutazione Project non invalida board diverse.

```bash
git add electron/github-service.cjs test/github-service.test.cjs && git commit -m "feat: invalida cache operative dopo mutazioni"
```

### Task 4: IPC tipizzate e UX offline-first

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `src/components/github-workspace.tsx`
- Modify: `src/github.css`
- Modify: `test/preload-surface.test.cjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Produces: `window.vincodeLab.github.gitStatus({ force })`, `.data({ force })`, `.projectBoard(number, { force })` che restituiscono `CachedResult<T>`.
- Consumes: Task 2.

- [x] **Step 1: Scrivere i test RED per IPC e UX**

```js
assert.match(preload, /gitStatus: \(options\) => ipcRenderer\.invoke\('github:gitStatus', options\)/)
assert.match(github, /cache\.stale \? 'Dati non aggiornati'/)
assert.match(github, /void refreshGitHub\(true\)/)
```

- [x] **Step 2: Eseguire il RED**

Run: `node --test test/preload-surface.test.cjs test/ui-design-system.test.cjs`

Expected: FAIL perché IPC/UI non espongono la cache.

- [x] **Step 3: Definire DTO e handler chiusi**

```ts
interface CacheMetadata { fetchedAt: number; expiresAt: number; stale: boolean; refreshError?: boolean }
interface CachedResult<T> { data: T; cache: CacheMetadata }
type CacheReadOptions = { force?: boolean }
```

Validare `force` booleano nell’IPC, applicare sempre `assertTrustedSender` e `requireActiveWorkspace`; non esporre chiavi cache, path SQLite o SQL.

- [x] **Step 4: Rendere la UI cache-first**

All'ingresso tab chiamare `{ force: false }`; rendere `result.data` e, se `result.cache.stale`, richiamare `{ force: true }` in background. `Aggiorna` invoca sempre `{ force: true }` e un errore remoto non cancella dati cache.

- [x] **Step 5: Aggiungere la freschezza accessibile**

```tsx
<span aria-live="polite" className={`github-cache-state ${cache.stale ? 'github-cache-state-stale' : ''}`}>{cache.stale ? 'Dati non aggiornati' : `Aggiornato ${formatRelativeTime(cache.fetchedAt)}`}</span>
```

Usare `--surface-subtle`, `--text-secondary`, `--brand`, `--line`; nessuno spinner bloccante se esiste cache.

- [x] **Step 6: Eseguire il GREEN e commit**

Run: `node --test test/preload-surface.test.cjs test/ui-design-system.test.cjs && npm run build`

Expected: PASS senza API Node nel renderer.

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts src/components/github-workspace.tsx src/github.css test/preload-surface.test.cjs test/ui-design-system.test.cjs && git commit -m "feat: rende immediate le tab con cache offline"
```

### Task 5: Verifica completa e scenario Electron

**Files:**
- Modify: `test/workspace-cache.test.cjs`
- Modify: `test/github-service.test.cjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: contratti Tasks 1-4.
- Produces: evidenza ripetibile di TTL, fallback e invalidazione.

- [x] **Step 1: Scrivere scenario offline**

```js
writeCache(workspace, 'github:project-board:5', boardFixture, 60_000, 1_000)
const result = await getCachedProjectBoard(workspace, 5, { force: true, now: 61_001 })
assert.equal(result.cache.stale, true)
assert.deepEqual(result.data, boardFixture)
```

Configurare il fake `gh` per fallire: il test deve provare che non viene sollevato un errore quando esiste cache.

- [x] **Step 2: Eseguire scenario e GREEN**

Run: `node --test test/workspace-cache.test.cjs test/github-service.test.cjs`

Expected RED: FAIL senza fallback. Expected GREEN: PASS con dato cached e `stale: true`.

- [x] **Step 3: Eseguire controlli finali**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: test, lint, build e controllo whitespace verdi.

- [x] **Step 4: Collaudo dev manuale**

1. Aprire un workspace GitHub e visitare Modifiche, Grafo, Issue e Progetti.
2. Tornare sulle tab: cache immediata, senza spinner bloccante.
3. Simulare `gh` indisponibile: i dati restano visibili con “Dati non aggiornati”.
4. Premere `Aggiorna`: al ritorno del remoto si aggiorna la data di sincronizzazione.
5. Eseguire una mutazione controllata e verificare refresh della sola risorsa dipendente.

- [ ] **Step 5: Commit di verifica**

```bash
git add test/workspace-cache.test.cjs test/github-service.test.cjs test/ui-design-system.test.cjs && git commit -m "test: verifica fallback e invalidazione della cache"
```
