# Material Design 3 — Evoluzione completa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere VincodeLab un’app desktop coerente con Material Design 3, densa ma leggibile, verificata nelle aree operative e pronta al beta testing.

**Architecture:** Il renderer conserva React, shadcn e Lucide. Un unico strato CSS (`design-system.css`) diventa la sorgente dei ruoli semantici e dei token M3; le aree di prodotto consumano solo tali token. Motion for React viene incapsulato in componenti/layout leggeri, senza animare xterm, CodeMirror o griglie.

**Tech Stack:** Electron, React 19, TypeScript, shadcn, Lucide, CSS custom properties, Motion for React, Node test runner, oxlint, Vite.

**Spec:** documento obiettivo originale della sessione di progettazione (non incluso nel repository).

## Global Constraints

- Sviluppare e committare direttamente su `main`; non creare worktree o branch.
- Conservare shadcn come sola base componentistica e Lucide come sola libreria di icone.
- Non introdurre dynamic color; tema chiaro e scuro mappano gli stessi ruoli semantici.
- Nessun accesso Node dal renderer; nuove operazioni mantengono l’IPC ristretto esistente.
- Non animare xterm, CodeMirror, tabelle, diff, preview o griglie durante rendering e resize.
- Tutte le mutazioni remote/database restano confermate e restituiscono un esito leggibile.
- Verificare `npm test`, `npm run lint`, `npm run build`, `git diff --check`; il package è un gate finale, non un passaggio per ogni modifica.

---

### Task 1: Audit M3 e matrice QA tracciabile

**Files:**
- Create: `docs/qa/material3-beta-qa.md`
- Modify: `test/ui-design-system.test.cjs`
- Modify: `docs/memory/risks.md` solo se l’audit individua un rischio stabile non già documentato.

**Interfaces:**
- Consumes: sezioni e criteri del documento obiettivo.
- Produces: checklist per ogni area e test statici contro regressioni di token, feedback e accessibilità.

- [ ] **Step 1: Scrivere i test inizialmente fallenti per i requisiti fondanti**

```js
test('il design system espone ruoli M3 per superficie, stato, elevazione, densità e motion', () => {
  for (const token of ['--surface-canvas', '--state-success', '--elevation-1', '--control-height-md', '--motion-standard']) {
    assert.match(styles, new RegExp(token))
  }
})
```

- [ ] **Step 2: Eseguire il test e verificare il RED**

Run: `node --test test/ui-design-system.test.cjs`

Expected: FAIL per token non ancora centralizzati.

- [ ] **Step 3: Creare la matrice QA**

Documentare per AI, Editor, Terminale, Terminale AI, GitHub, Database e Impostazioni: flusso, stati, viewport, tema, evidenza eseguita e difetti nel formato `Problema → Riproduzione → Attuale → Atteso → Gravità → Correzione`.

- [ ] **Step 4: Rieseguire test e commit**

Run: `node --test test/ui-design-system.test.cjs`

Commit: `docs: definisce la matrice QA Material 3`

### Task 2: Consolidare token, tema e densità M3

**Files:**
- Modify: `src/design-system.css`
- Modify: `src/dark-theme.css`
- Modify: `src/index.css`
- Modify: `src/App.css`, `src/editor.css`, `src/terminal.css`, `src/github.css`, `src/database.css`, `src/settings.css`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: token del Task 1.
- Produces: ruoli CSS comuni `surface`, `on-surface`, `outline`, `state-*`, `elevation-*`, `motion-*` e `control-height-*` usabili senza palette hard-coded nelle pagine.

- [ ] **Step 1: Scrivere test fallenti per i ruoli mancanti e per il tema scuro semantico**

```js
assert.match(styles, /--state-success:/)
assert.match(styles, /--elevation-1:/)
assert.match(styles, /--motion-standard:/)
assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/)
```

- [ ] **Step 2: Verificare il RED**

Run: `node --test test/ui-design-system.test.cjs`

- [ ] **Step 3: Implementare il set token e sostituire le regole locali duplicate**

Definire ruoli per canvas, superfici, contenitori, testo, outline, focus, selezione, successo, warning, errore, informazione, Git e transazione. Aggiungere scale di typo, spacing 4/8, shape, elevazione, z-index, densità e motion. Mappare tema scuro sugli stessi nomi e sostituire nella CSS di area solo i valori che duplicano quei ruoli.

- [ ] **Step 4: Verificare test, lint e build**

Run: `node --test test/ui-design-system.test.cjs && npm run lint && npm run build`

- [ ] **Step 5: Commit**

Commit: `feat: centralizza il sistema visivo Material 3`

### Task 3: Motion accessibile e transizioni delle superfici

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/components/motion-presence.tsx`
- Modify: `src/App.tsx`, `src/components/confirmation-dialog.tsx`
- Modify: `src/persistent-tabs.css`, `src/design-system.css`
- Test: `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: `--motion-standard`, `--motion-emphasized`, `--z-*` del Task 2.
- Produces: `MotionPresence` per pannelli, dialog e tab non critiche, con rispetto di reduced motion.

- [ ] **Step 1: Scrivere test fallente per Motion for React e reduced motion**

```js
assert.match(packageJson, /"motion"/)
assert.match(component, /useReducedMotion/)
assert.match(app, /MotionPresence/)
```

- [ ] **Step 2: Verificare il RED**

Run: `node --test test/ui-design-system.test.cjs`

- [ ] **Step 3: Installare `motion` e introdurre un wrapper minimale**

Usare `useReducedMotion()` per eliminare movimento quando richiesto. Applicare la presenza soltanto a pannelli secondari, tab e dialog; nessun wrapper attorno alle superfici xterm/CodeMirror/griglia.

- [ ] **Step 4: Verificare e commit**

Run: `npm test && npm run lint && npm run build`

Commit: `feat: aggiunge motion accessibile alle superfici`

### Task 4: Navigazione principale, contesto e layout adattivo

**Files:**
- Modify: `src/App.tsx`, `src/App.css`, `src/persistent-tabs.css`
- Modify: `src/components/app-error-boundary.tsx`
- Test: `test/ui-design-system.test.cjs`, `test/terminal-resize.test.mjs`

**Interfaces:**
- Consumes: componenti Motion e token centrali.
- Produces: tab principali persistenti con contesto workspace, focus coerente, empty state azionabile e nessun overflow nei breakpoint.

- [ ] **Step 1: Scrivere test fallente per contesto tab, focus e fallback ripristinabile**

```js
assert.match(app, /aria-current|aria-selected/)
assert.match(app, /workspace \? workspaceName\(workspace\)/)
assert.match(boundary, /Riprova/)
```

- [ ] **Step 2: Verificare il RED**

Run: `node --test test/ui-design-system.test.cjs test/terminal-resize.test.mjs`

- [ ] **Step 3: Implementare list-detail/supporting pane responsive**

Rendere collassabili o sovrapponibili i supporting pane, senza rimuovere il ritorno al contenuto principale. Mantenere stato di tab e terminale nel cambio sezione.

- [ ] **Step 4: Verificare e commit**

Run: `npm test && npm run lint && npm run build`

Commit: `feat: allinea navigazione e layout al sistema M3`

### Task 5: Editor, terminali e AI ad alta densità

**Files:**
- Modify: `src/components/project-editor.tsx`, `src/editor.css`
- Modify: `src/App.tsx`, `src/components/free-terminal.tsx`, `src/components/terminal-toolbar.tsx`, `src/terminal.css`
- Test: `test/editor-ux.test.cjs`, `test/terminal-resize.test.mjs`, `test/ui-design-system.test.cjs`

**Interfaces:**
- Consumes: densità, stati e superfici del Task 2.
- Produces: aree operative dense, focus visibile, pane ridimensionabili e feedback per ricerca, salvataggio, allegati e comandi.

- [ ] **Step 1: Scrivere test fallenti per stati selected/modified, toolbar e overflow terminale**
- [ ] **Step 2: Verificare il RED**

Run: `node --test test/editor-ux.test.cjs test/terminal-resize.test.mjs test/ui-design-system.test.cjs`

- [ ] **Step 3: Implementare le correzioni di area senza cambiare i contratti IPC**

Mantenere `.env` visibili e il solo `node_modules` escluso. Rendere azioni frequenti esplicite, azioni rare contestuali, e usare token per Git/status/file. Non animare né comprimere il PTY.

- [ ] **Step 4: Verificare e commit**

Run: `npm test && npm run lint && npm run build`

Commit: `feat: rifinisce editor e terminali con densità M3`

### Task 6: GitHub, Database, Pi e Impostazioni

**Files:**
- Modify: `src/components/github-workspace.tsx`, `src/github.css`
- Modify: `src/components/database-workspace.tsx`, `src/components/database-table-grid.tsx`, `src/database.css`
- Modify: `src/components/settings.tsx`, `src/settings.css`, `src/components/project-skills.tsx`
- Test: `test/github-projects.test.cjs`, `test/database-service.test.cjs`, `test/ui-design-system.test.cjs`, `test/preload-surface.test.cjs`

**Interfaces:**
- Consumes: token/stati/Motion e layout del Task 2–4.
- Produces: feedback coerente per operazioni remote, query e configurazioni; list-detail leggibile senza overflow.

- [ ] **Step 1: Scrivere test fallenti per loading, errore recuperabile, conferma e dati modificati**
- [ ] **Step 2: Verificare il RED**

Run: `node --test test/github-projects.test.cjs test/database-service.test.cjs test/ui-design-system.test.cjs test/preload-surface.test.cjs`

- [ ] **Step 3: Applicare ruoli M3 e feedback espliciti**

GitHub separa sempre grafo, repository, issue e Project del workspace. Database rende visibili connessione/transazione/salvataggio/conflict. Pi e Impostazioni distinguono con testo e icona risorse globali, workspace e stato di installazione.

- [ ] **Step 4: Verificare e commit**

Run: `npm test && npm run lint && npm run build`

Commit: `feat: uniforma le superfici operative M3`

### Task 7: QA beta, regressioni e package gate

**Files:**
- Modify: `docs/qa/material3-beta-qa.md`
- Modify: test mirati emersi dall’audit.

**Interfaces:**
- Consumes: tutte le aree completate.
- Produces: evidenza dei flussi eseguiti, difetti chiusi o esplicitamente classificati; nessun Critical/High noto.

- [ ] **Step 1: Eseguire test automatici completi**

Run: `npm test && npm run lint && npm run build && git diff --check`

- [ ] **Step 2: Eseguire smoke test manuale in dev**

Verificare tema chiaro/scuro/ridotto, resize stretto/largo, ogni tab, dialog, toolbar e flusso principale con dati reali senza mutare produzione non necessaria.

- [ ] **Step 3: Registrare ogni difetto e correggere Critical/High**

Per ogni difetto usare il formato della matrice QA, aggiungere un test di regressione e rieseguire i flussi correlati.

- [ ] **Step 4: Eseguire il gate di packaging solo a fine ciclo**

Run: `npm run package && codesign --verify --deep --strict --verbose=2 dist/mac-arm64/VincodeLab.app`

- [ ] **Step 5: Commit finale**

Commit: `test: completa il gate QA Material 3`

## Self-review

- Copertura spec: token/temi (Task 2), superfici e densità (Task 2, 5, 6), layout/navigazione (Task 4), stati/accessibilità/feedback (Task 1, 4–6), Motion (Task 3), tutte le aree nominate (Task 5–6), QA e package (Task 7).
- Placeholder scan: nessun TBD/TODO; i test da scrivere sono associati ad azioni e comandi concreti.
- Coerenza: tutti i task assumono `design-system.css` come unica sorgente dei token; gli interventi di area non modificano contratti IPC.
