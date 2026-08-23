# Database griglia dati Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare e modificare in transazione le righe della tabella selezionata con una griglia stile Excel.

**Architecture:** Il main process estende lo schema con PK e fornisce lettura/update parametrizzati. Il renderer gestisce ricerca, pagine e bozze, ma non SQL mutativo.

**Tech Stack:** Electron 43, React 19, TypeScript 6, better-sqlite3, pg, mysql2, tedious, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-20-database-griglia-design.md`

## Global Constraints

- Nessuna dipendenza data-grid; usare React/CSS esistenti.
- Renderer senza socket, SQL mutativo, password o dettagli driver.
- Identificatori validati contro schema; tutti i valori parametrizzati.
- Pagine da 100 righe, massimo 500; update solo con transazione, PK e conferma.
- Commit/Rollback ricaricano dati/schema e svuotano le bozze.
- Usare `npm run dev`, senza package durante i task.

## File structure

- `electron/database-service.cjs`: PK, pagina/filtro, update transazionale.
- `electron/main.cjs`, `electron/preload.cjs`, `src/vincode-lab.d.ts`: IPC e DTO.
- `src/components/database-table-grid.tsx`: griglia accessibile e bozze.
- `src/components/database-workspace.tsx`, `src/database.css`: ricerca/lifecycle.
- `test/database-service.test.cjs`, `test/preload-surface.test.cjs`, `test/ui-design-system.test.cjs`: contratti.

### Task 1: Metadati PK ed editabilità

**Files:** modify `electron/database-service.cjs`, `test/database-service.test.cjs`.

**Produces:** `DatabaseTableSchema { name, primaryKey, columns }`, con `primaryKeyPosition` ed `editable`.

- [ ] **Step 1: Scrivere il RED**

```js
const schema = await inspectSchema(workspace, connection.id, { force: true })
const users = schema.tables.find((table) => table.name === 'users')
const logs = schema.tables.find((table) => table.name === 'logs')
assert.deepEqual(users.primaryKey, ['id'])
assert.equal(users.columns.find((column) => column.name === 'name').editable, true)
assert.deepEqual(logs.primaryKey, [])
assert.equal(logs.columns.every((column) => column.editable === false), true)
```

- [ ] **Step 2: Verificare RED**

Run: `node --test test/database-service.test.cjs`
Expected: FAIL perché PK/editabilità non sono nel DTO.

- [ ] **Step 3: Implementare introspezione**

```js
function makeTableSchema(name, columns) {
  const primaryKey = columns.filter((column) => column.primaryKeyPosition > 0)
    .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition).map((column) => column.name)
  return { name, primaryKey, columns: columns.map((column) => ({ ...column,
    editable: primaryKey.length > 0 && !primaryKey.includes(column.name) && isEditableColumn(column),
  })) }
}
```

SQLite legge `pk` da `PRAGMA table_info`; gli altri driver aggiungono l'ordine del vincolo PK. Rifiutare PK, identity/generate, blob, XML, JSON complesso e geometry.

- [ ] **Step 4: GREEN e commit**

Run: `node --test test/database-service.test.cjs && git diff --check`

```bash
git add electron/database-service.cjs test/database-service.test.cjs
git commit -m "feat: rileva chiavi primarie nello schema database"
```

### Task 2: Paging, filtro e update sicuro

**Files:** modify `electron/database-service.cjs`, `test/database-service.test.cjs`.

**Produces:** `readTableRows(workspacePath, connectionId, tableName, options)` e `updateTableRows(workspacePath, connectionId, tableName, changes)`.

- [ ] **Step 1: Scrivere il RED**

```js
const page = await readTableRows(workspace, connection.id, 'users', { limit: 100, filter: 'ada' })
assert.equal(page.rows[0].name, 'Ada')
await assert.rejects(() => updateTableRows(workspace, connection.id, 'users', [{ key: { id: 1 }, values: { name: 'Grace' } }]), /Transazione attiva richiesta/)
await beginTransaction(workspace, connection.id)
await updateTableRows(workspace, connection.id, 'users', [{ key: { id: 1 }, values: { name: 'Grace' } }])
await rollbackTransaction(workspace, connection.id)
```

- [ ] **Step 2: Verificare RED e implementare**

Run: `node --test test/database-service.test.cjs`
Expected: FAIL perché le API non esistono.

Validare tabella/colonne nel DTO schema, limiti 1..500, offset non negativo e filtro massimo 128. Quotare solo identificatori validati; filtro solo su colonne testuali con parametri. Leggere 101 righe per `hasMore`, esporne 100. Update richiede transazione, PK completa e colonne `editable`; `WHERE` include tutte le PK. Se righe aggiornate non è 1, restituire `La riga è cambiata o non è più disponibile.`. Testare PK composta, no-PK e `users; DROP TABLE users`.

- [ ] **Step 3: GREEN e commit**

Run: `node --test test/database-service.test.cjs && git diff --check`

```bash
git add electron/database-service.cjs test/database-service.test.cjs
git commit -m "feat: aggiunge aggiornamenti transazionali alle tabelle"
```

### Task 3: Contratto IPC minimale

**Files:** modify `electron/main.cjs`, `electron/preload.cjs`, `src/vincode-lab.d.ts`, `test/preload-surface.test.cjs`.

**Produces:** `database.tableRows(id, tableName, options)` e `database.updateTableRows(id, tableName, changes)`.

- [ ] **Step 1: Scrivere RED IPC**

```js
assert.match(preload, /tableRows: \(id, tableName, options\) => ipcRenderer\.invoke\('database:tableRows', id, tableName, options\)/)
assert.match(preload, /updateTableRows: \(id, tableName, changes\) => ipcRenderer\.invoke\('database:updateTableRows', id, tableName, changes\)/)
assert.match(main, /ipcMain\.handle\('database:tableRows'/)
```

- [ ] **Step 2: Verificare RED e implementare**

Run: `node --test test/preload-surface.test.cjs`
Expected: FAIL.

```js
ipcMain.handle('database:tableRows', (event, id, tableName, options) => {
  assertTrustedSender(event)
  return readTableRows(requireActiveWorkspace(), id, tableName, options)
})
ipcMain.handle('database:updateTableRows', (event, id, tableName, changes) => {
  assertTrustedSender(event)
  return updateTableRows(requireActiveWorkspace(), id, tableName, changes)
})
```

Definire `DatabaseColumn`, `DatabaseTableSchema`, `DatabaseTablePage`, `DatabaseTableChange`; nessun driver/config nel DTO.

- [ ] **Step 3: GREEN e commit**

Run: `node --test test/preload-surface.test.cjs && npm run build`

```bash
git add electron/main.cjs electron/preload.cjs src/vincode-lab.d.ts test/preload-surface.test.cjs
git commit -m "feat: espone la griglia database nel preload"
```

### Task 4: Griglia accessibile e ricerca schema

**Files:** create `src/components/database-table-grid.tsx`; modify `src/components/database-workspace.tsx`, `src/database.css`, `test/ui-design-system.test.cjs`.

**Consumes:** pagina e update Task 3; espone `onSave(changes)` e `onDiscard()`.

- [ ] **Step 1: Scrivere RED UX**

```js
assert.match(grid, /aria-label="Cerca nelle righe della tabella"/)
assert.match(grid, /aria-label="Griglia dati tabella"/)
assert.match(grid, /Salva modifiche/)
assert.match(workspace, /aria-label="Cerca nello schema"/)
assert.match(workspace, /<DatabaseTableGrid/)
assert.match(styles, /\.database-cell-dirty\{[^}]*var\(--brand-soft\)/)
```

- [ ] **Step 2: Verificare RED e implementare**

Run: `node --test test/ui-design-system.test.cjs`
Expected: FAIL.

La sidebar filtra in memoria tabelle/colonne. Il click seleziona la tabella, aggiorna `schemaTablePreviewSql` e carica la prima pagina con request-id. La griglia conserva bozze in `Map` indicizzata dai valori PK; Click/Invio modifica, Esc annulla la cella, Tab prosegue. Mostrare `Imposta NULL` solo su nullable e sola lettura senza PK. Salva apre `ConfirmationDialog` con tabella e conteggio righe. Commit/Rollback svuotano bozze e ricaricano pagina/schema; il cambio tabella/connessione chiede conferma se esistono bozze.

- [ ] **Step 3: Verifica completa e commit**

Run: `npm test && npm run lint && npm run build && git diff --check`

Manuale dev: SQLite con `users(id INTEGER PRIMARY KEY, name TEXT, age INTEGER)` e `logs(message TEXT)`; cercare, aggiornare, Rollback e Commit; verificare logs sola lettura, oltre 100 righe, Tab/Esc e nessun overflow.

```bash
git add src/components/database-table-grid.tsx src/components/database-workspace.tsx src/database.css test/ui-design-system.test.cjs
git commit -m "feat: integra la griglia dati nel workspace database"
```

## Plan self-review

- Copertura: PK/editabilità (Task 1), paging/filtro/update (Task 2), IPC (Task 3), UX/transazioni/regressioni (Task 4).
- Nessun `TODO`/`TBD`; DTO e firme sono identici in tutti i task.
