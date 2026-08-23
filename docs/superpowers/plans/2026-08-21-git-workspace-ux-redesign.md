# Git Workspace UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare Modifiche e Issue in superfici operative compatte, con master-detail Git e ricerca issue per numero.

**Architecture:** Le callback Git/GitHub esistenti restano immutate. Il componente `GitHubWorkspace` riordina lo stato e il markup; `github.css` definisce un layout master-detail responsive e un elenco Issue a tutta larghezza.

**Tech Stack:** React 19, TypeScript, CSS, Lucide, Node test runner, Electron/Vite.

**Spec:** `docs/superpowers/specs/2026-08-21-git-workspace-ux-redesign-design.md`

## Global Constraints

- Nessuna modifica ai contratti IPC, ai servizi Git/GitHub o ai dati persistenti.
- Le azioni mutative continuano a usare la conferma interna all'app.
- I modal trattengono e ripristinano il focus e si chiudono con Escape.
- Il layout deve restare utilizzabile a viewport ampio e sotto 900 px.

---

### Task 1: Ricerca issue e compositore modale

**Files:**
- Modify: `src/components/github-workspace.tsx`
- Modify: `src/github.css`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `GitHubIssue.number`, `GitHubIssue.title`, `GitHubIssue.body`, `GitHubIssue.labels`.
- Produces: `matchesIssueSearch(issue: GitHubIssue, query: string): boolean` e modal `github-issue-create-modal`.

- [x] **Step 1: Scrivere il test fallente**

Verificare che il componente normalizzi `#175`/`175`, confronti `issue.number`, esponga `Nuova issue` nella toolbar e renda il form soltanto nel modal.

- [x] **Step 2: Eseguire il test mirato e verificare il fallimento**

Run: `node --test --test-name-pattern="Issue GitHub usa ricerca numerica" test/ui-design-system.test.cjs`

- [x] **Step 3: Implementare ricerca e modal**

```ts
function matchesIssueSearch(issue: GitHubIssue, query: string) {
  const normalized = query.trim().toLocaleLowerCase('it-IT')
  const numeric = normalized.match(/^#?(\d+)$/)?.[1]
  if (numeric) return issue.number === Number(numeric)
  return !normalized || [issue.title, issue.body ?? '', ...issue.labels.map((label) => label.name)]
    .some((value) => value.toLocaleLowerCase('it-IT').includes(normalized))
}
```

Il pulsante `Nuova issue` apre il dialog; creazione riuscita chiude il dialog e svuota il form.

- [x] **Step 4: Rieseguire il test mirato**

Run: `node --test --test-name-pattern="Issue GitHub usa ricerca numerica" test/ui-design-system.test.cjs`

---

### Task 2: Flusso Modifiche master-detail

**Files:**
- Modify: `src/components/github-workspace.tsx`
- Modify: `src/github.css`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `staged`, `unstaged`, `selectedDiff`, callback Git esistenti.
- Produces: `github-changes-workbench`, `github-change-sidebar`, `github-diff-workspace`.

- [x] **Step 1: Scrivere il test fallente**

Verificare che la scheda Modifiche contenga workbench master-detail, gruppi `details`, compositore nel pannello file e nessuna cronologia duplicata.

- [x] **Step 2: Eseguire il test mirato e verificare il fallimento**

Run: `node --test --test-name-pattern="Modifiche GitHub usa un workbench" test/ui-design-system.test.cjs`

- [x] **Step 3: Riordinare il markup senza cambiare callback**

La barra branch diventa compatta. I file sono raggruppati con `details open`; il diff occupa il pannello principale e mostra istruzioni quando nessun file e selezionato. La cronologia viene rimossa da Modifiche e resta nel Grafo.

- [x] **Step 4: Applicare il layout responsive**

```css
.github-changes-workbench {
  display: grid;
  grid-template-columns: minmax(300px, 36%) minmax(0, 1fr);
  min-height: 0;
}

@media (max-width: 900px) {
  .github-changes-workbench { grid-template-columns: 1fr; }
}
```

- [x] **Step 5: Rieseguire il test mirato**

Run: `node --test --test-name-pattern="Modifiche GitHub usa un workbench" test/ui-design-system.test.cjs`

---

### Task 3: Regressione e verifica runtime

**Files:**
- Modify: `test/ui-design-system.test.cjs`
- Verify: `src/components/github-workspace.tsx`
- Verify: `src/github.css`

**Interfaces:**
- Consumes: markup e stili prodotti dai task precedenti.
- Produces: evidenza di regressione completa.

- [x] **Step 1: Eseguire la suite completa**

Run: `npm test`

- [x] **Step 2: Verificare lint, build e whitespace**

Run: `npm run lint && npm run build && git diff --check`

- [x] **Step 3: Controllare la sessione hot reload**

Verificare assenza di errori Electron/Vite e rendering delle due schede a viewport ampio e ristretto.
