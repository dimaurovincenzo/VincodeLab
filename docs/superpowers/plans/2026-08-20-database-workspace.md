# Database workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere la tab principale Database con profili SQL isolati per workspace, editor SQL, risultati, transazioni, query salvate e cronologia.

**Architecture:** Il renderer usa esclusivamente DTO tipizzati e CodeMirror; il main process valida sender e workspace, legge il profilo locale per ID e delega ai driver. SQLite locale è il primo driver completo e il riferimento per i contratti; PostgreSQL, MySQL e SQL Server adottano la stessa superficie senza esporre socket o password al renderer.

**Tech Stack:** Electron 43, React 19, TypeScript 6, CodeMirror 6, `better-sqlite3`, `pg`, `mysql2`, `tedious`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-database-workspace-design.md`

## Global Constraints

- Tutte le risorse Database sono filtrate dal solo `workspace_path` attivo; il renderer non passa mai un percorso di workspace.
- Password e SQL restano in chiaro nelle sole tabelle locali previste, senza log applicativi né sincronizzazione Git.
- Il main process riclassifica il SQL e rifiuta query mutative senza `confirmed: true`, anche durante una transazione.
- Limite SQL 65.536 caratteri, timeout per driver, massimo 500 righe per risposta e paginazione esplicita.
- Le sessioni remote si chiudono su cambio workspace, rimozione profilo, errore fatale e chiusura app.
- Nessun accesso Node, driver, socket o SQLite dal renderer; mantenere `contextIsolation` e `assertTrustedSender`.
- Durante lo sviluppo usare `npm run dev`; non eseguire package macOS.

## File structure

- Create: `electron/database-store.cjs` — schema SQLite locale, CRUD e isolamento di connessioni/query/cronologia.
- Create: `electron/database-service.cjs` — classificazione SQL, driver, timeout, sessioni, introspezione e transazioni.
- Modify: `electron/main.cjs` — IPC vincolate a sender e workspace, lifecycle sessioni.
- Modify: `electron/preload.cjs` — superficie `database` minimale e tipizzata.
- Modify: `src/vincode-lab.d.ts` — DTO database e API preload.
- Create: `src/components/database-workspace.tsx` — interfaccia tab Database e CodeMirror SQL.
- Create: `src/database.css` — layout a tre aree, risultati e responsive.
- Modify: `src/App.tsx` — tab principale lazy-loaded Database e persistenza della vista.
- Modify: `package.json`, `package-lock.json` — driver remoti e linguaggio SQL CodeMirror.
- Create: `test/database-store.test.cjs`, `test/database-service.test.cjs`.
- Modify: `test/preload-surface.test.cjs`, `test/ui-design-system.test.cjs`.

### Task 1: Archivio locale isolato per connessioni, query e cronologia

**Files:**
- Create: `electron/database-store.cjs`
- Create: `test/database-store.test.cjs`

**Interfaces:**
- Produces: `listConnections(workspacePath)`, `createConnection(workspacePath, input)`, `updateConnection(workspacePath, id, input)`, `deleteConnection(workspacePath, id)`, `getConnection(workspacePath, id)`, `listSavedQueries(workspacePath, connectionId)`, `saveQuery(workspacePath, input)`, `recordHistory(workspacePath, input)`.

- [ ] **Step 1: Scrivere test RED per CRUD, cascata e isolamento**

```js
const local = createConnection('/tmp/a', { name: 'Locale', driver: 'sqlite', sqlitePath: '/tmp/a/data.sqlite' })
saveQuery('/tmp/a', { connectionId: local.id, name: 'Elenco', sql: 'SELECT 1' })
assert.equal(getConnection('/tmp/b', local.id), null)
deleteConnection('/tmp/a', local.id)
assert.deepEqual(listSavedQueries('/tmp/a', local.id), [])
```

- [ ] **Step 2: Eseguire il RED**

Run: `node --test test/database-store.test.cjs`

Expected: FAIL perché `database-store.cjs` non esiste.

- [ ] **Step 3: Implementare schema e validazione strutturale**

```sql
CREATE TABLE database_connections (
  id TEXT PRIMARY KEY NOT NULL, workspace_path TEXT NOT NULL,
  name TEXT NOT NULL, driver TEXT NOT NULL, config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE database_saved_queries (
  id TEXT PRIMARY KEY NOT NULL, workspace_path TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL, sql TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE database_query_history (
  id TEXT PRIMARY KEY NOT NULL, workspace_path TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
  sql TEXT NOT NULL, executed_at INTEGER NOT NULL, duration_ms INTEGER NOT NULL, affected_rows INTEGER
);
```

Accettare solo UUID, path assoluti, driver `sqlite|postgres|mysql|mssql`, nome non vuoto e SQL entro 65.536 caratteri. Le config restano opache al renderer e sono lette solo dopo filtro `workspace_path`.

- [ ] **Step 4: Eseguire GREEN e commit**

Run: `node --test test/database-store.test.cjs && git diff --check`

```bash
git add electron/database-store.cjs test/database-store.test.cjs
git commit -m "feat: aggiunge archivio database per workspace"
```

### Task 2: Servizio SQLite con limiti, classificazione e transazioni

**Files:**
- Create: `electron/database-service.cjs`
- Create: `test/database-service.test.cjs`

**Interfaces:**
- Produces: `classifySql(sql)`, `executeQuery(workspacePath, connectionId, sql, options)`, `beginTransaction(workspacePath, connectionId)`, `commitTransaction(workspacePath, connectionId)`, `rollbackTransaction(workspacePath, connectionId)`, `inspectSchema(workspacePath, connectionId)`.

- [ ] **Step 1: Scrivere RED per lettura, mutazione confermata, paginazione e rollback**

```js
assert.equal(classifySql('SELECT * FROM users').mutative, false)
assert.equal(classifySql('  /* nota */ UPDATE users SET name = 1').mutative, true)
await assert.rejects(() => executeQuery('/tmp/a', id, 'CREATE TABLE users(id INTEGER)', { confirmed: false }), /Conferma richiesta/)
await beginTransaction('/tmp/a', id)
await executeQuery('/tmp/a', id, 'INSERT INTO users VALUES (1)', { confirmed: true })
await rollbackTransaction('/tmp/a', id)
```

- [ ] **Step 2: Eseguire RED**

Run: `node --test test/database-service.test.cjs`

- [ ] **Step 3: Implementare driver SQLite e DTO risultati**

`executeQuery` restituisce `{ columns, rows, affectedRows, durationMs, hasMore }`; applica `LIMIT 501` solo alle query di lettura quando non è già limitata, restituisce al massimo 500 righe e normalizza gli errori senza SQL/password. `classifySql` ignora spazi e commenti iniziali e riconosce `INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|EXEC`.

- [ ] **Step 4: Implementare schema SQLite e lifecycle sessione**

Usare `sqlite_master` e `PRAGMA table_info`; memorizzare cache schema solo in memoria. Invalidarla dopo DDL/DML e `refreshSchema`. Chiudere handle e transazioni su `closeWorkspaceSessions(workspacePath)`.

- [ ] **Step 5: Eseguire GREEN e commit**

Run: `node --test test/database-service.test.cjs && git diff --check`

```bash
git add electron/database-service.cjs test/database-service.test.cjs
git commit -m "feat: esegue query SQLite del workspace"
```

### Task 3: Driver PostgreSQL, MySQL e SQL Server nel main process

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron/database-service.cjs`
- Modify: `test/database-service.test.cjs`

**Interfaces:**
- Extends: `executeQuery` e `inspectSchema` con `postgres|mysql|mssql` senza cambiare DTO o IPC.

- [ ] **Step 1: Scrivere RED per configurazione driver e timeout normalizzato**

```js
assert.throws(() => validateConnectionConfig({ driver: 'postgres', host: '', port: 5432, database: 'app', user: 'u', password: 'p' }), /Host non valido/)
assert.equal(buildDriverConfig({ driver: 'mysql', host: '127.0.0.1', port: 3306, database: 'app', user: 'u', password: 'p' }).port, 3306)
```

- [ ] **Step 2: Eseguire RED**

Run: `node --test test/database-service.test.cjs`

- [ ] **Step 3: Installare i driver e il linguaggio SQL**

Run: `npm install pg mysql2 tedious @codemirror/lang-sql`

Aggiornare `asarUnpack` se un driver nativo lo richiede; non eseguire package macOS.

- [ ] **Step 4: Implementare adapter per driver**

Ogni adapter espone `connect`, `execute`, `begin`, `commit`, `rollback`, `inspectSchema`, `close`. Applicare timeout nativo/abort controller dove disponibile; per SQL Server annullare la richiesta `tedious` al timeout. Non costruire URL con interpolazione né registrare config o SQL.

- [ ] **Step 5: Eseguire GREEN e commit**

Run: `node --test test/database-service.test.cjs && npm run build`

```bash
git add package.json package-lock.json electron/database-service.cjs test/database-service.test.cjs
git commit -m "feat: aggiunge driver database remoti"
```

### Task 4: IPC tipizzate e confine di esecuzione sicuro

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`
- Modify: `test/preload-surface.test.cjs`

**Interfaces:**
- Produces: `window.vincodeLab.database.{listConnections,createConnection,updateConnection,deleteConnection,execute,begin,commit,rollback,inspectSchema,listSavedQueries,saveQuery,listHistory}`.

- [ ] **Step 1: Scrivere RED per superficie preload e conferma main**

```js
assert.match(preload, /database: \{[\s\S]*execute: \(connectionId, sql, options\) => ipcRenderer\.invoke\('database:execute', connectionId, sql, options\)/)
assert.match(main, /if \(classification\.mutative && !options\?\.confirmed\) throw new Error\('Conferma richiesta per la query mutativa\.'/)
assert.doesNotMatch(preload, /database:[\s\S]*require\(/)
```

- [ ] **Step 2: Eseguire RED**

Run: `node --test test/preload-surface.test.cjs`

- [ ] **Step 3: Registrare handler e lifecycle**

Ogni handler invoca `assertTrustedSender(event)` e `requireActiveWorkspace()`. `database:execute` riceve solo `connectionId`, SQL e `{ confirmed?: boolean, offset?: number }`; rilegge il profilo attraverso il servizio. Chiudere le sessioni nel percorso già esistente di cambio workspace e in `before-quit`.

- [ ] **Step 4: Esporre DTO renderer**

Definire `DatabaseConnection`, `DatabaseConnectionInput`, `DatabaseSchema`, `DatabaseQueryResult`, `DatabaseHistoryEntry` e `DatabaseSavedQuery` senza tipi driver, errori raw o password nei risultati.

- [ ] **Step 5: Eseguire GREEN e commit**

Run: `node --test test/preload-surface.test.cjs && npm run build`

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs
git commit -m "feat: espone operazioni database del workspace"
```

### Task 5: Tab Database, editor SQL, risultati e query salvate

**Files:**
- Create: `src/components/database-workspace.tsx`
- Create: `src/database.css`
- Modify: `src/App.tsx`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: tutte le API `window.vincodeLab.database` di Task 4.
- Produces: tab principale `Database`, editor SQL CodeMirror e azioni accessibili.

- [ ] **Step 1: Scrivere RED UX**

```js
assert.match(app, /appSection.*'database'/)
assert.match(app, /workspace-tab-database/)
assert.match(component, /aria-label="Nuova connessione database"/)
assert.match(component, /ConfirmationDialog/)
assert.match(component, /@codemirror\/lang-sql/)
assert.match(styles, /\.database-workspace\{[^}]*min-width:0/)
```

- [ ] **Step 2: Eseguire RED**

Run: `node --test test/ui-design-system.test.cjs`

- [ ] **Step 3: Implementare layout e profili**

Creare sidebar connessioni/esplora schema, editor centrale e pannello risultati inferiore. Il form seleziona driver e visualizza solo i campi pertinenti; mantiene password leggibile e modificabile come deciso dalla specifica. Cancellazione profilo passa da `ConfirmationDialog` e informa che elimina query/cronologia locali.

- [ ] **Step 4: Implementare editor e azioni**

Configurare `sql({ dialect })`, completamenti da schema e selezione editor. `Esegui` usa la selezione se presente; query mutativa mostra il testo SQL nel dialog e passa `{ confirmed: true }` solo dopo conferma. Aggiungere transazione, commit, rollback, salva query, aggiorna schema e cronologia.

- [ ] **Step 5: Implementare risultati accessibili**

Renderizzare tabella con colonne, righe, contatore, durata, righe coinvolte e caricamento pagina successiva. Errori normalizzati diventano messaggi in italiano; non ristampare automaticamente SQL o password nei toast.

- [ ] **Step 6: Eseguire GREEN e commit**

Run: `node --test test/ui-design-system.test.cjs && npm run lint && npm run build`

```bash
git add src/App.tsx src/components/database-workspace.tsx src/database.css test/ui-design-system.test.cjs
git commit -m "feat: aggiunge workspace database"
```

### Task 6: Verifica integrata in sviluppo

**Files:**
- Modify: `test/database-store.test.cjs`
- Modify: `test/database-service.test.cjs`
- Modify: `test/ui-design-system.test.cjs`

- [ ] **Step 1: Aggiungere regressioni workspace e mutazioni**

```js
await assert.rejects(() => executeQuery('/tmp/b', connectionA.id, 'SELECT 1', {}), /Connessione del workspace non trovata/)
await assert.rejects(() => executeQuery('/tmp/a', connectionA.id, 'DELETE FROM items', {}), /Conferma richiesta/)
```

- [ ] **Step 2: Eseguire verifica completa**

Run: `npm test && npm run lint && npm run build && git diff --check`

Expected: tutte le verifiche verdi.

- [ ] **Step 3: Collaudo manuale con SQLite temporaneo**

1. Aprire un workspace e creare un profilo SQLite sotto `/tmp`.
2. Eseguire `SELECT 1`, `CREATE TABLE`, `INSERT`, inizio transazione e rollback.
3. Verificare che `CREATE TABLE` e `INSERT` mostrino la conferma con SQL.
4. Cambiare workspace e verificare assenza di profili/query del precedente.
5. Aprire e chiudere la tab Database ripetutamente verificando che non alteri terminali già attivi.

- [ ] **Step 4: Commit finale**

```bash
git add test/database-store.test.cjs test/database-service.test.cjs test/ui-design-system.test.cjs
git commit -m "test: verifica workspace database"
```
