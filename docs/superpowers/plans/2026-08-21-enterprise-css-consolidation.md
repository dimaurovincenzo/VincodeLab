# Enterprise CSS Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidare il CSS di VincodeLab in un Workbench enterprise compatto, coerente in chiaro e scuro, migrando e verificando una vista alla volta.

**Architecture:** Un solo entrypoint CSS importa token, temi, base, primitive, shell e viste con responsabilita non sovrapposte. Un audit PostCSS impedisce nuove collisioni, palette locali e `!important`; i fogli legacy vengono ridotti e rimossi soltanto quando la vista proprietaria e migrata.

**Tech Stack:** React 19, TypeScript 6, CSS, Tailwind 4/Shadcn adapter, PostCSS 8 come dipendenza di sviluppo, Electron 43, Vite 8, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-21-enterprise-css-consolidation-design.md`

## Global Constraints

- Il linguaggio visuale e un Workbench enterprise compatto: superfici continue, bordi e split pane; niente dashboard di card.
- I controlli ordinari hanno altezza 28-32 px; i raggi standard sono 2 px e 4 px; modali e popover possono usare 6 px.
- Le ombre sono riservate a modali, menu, tooltip e superfici realmente sovrapposte.
- `system`, `light` e `dark` hanno una sola fonte di verita; le viste consumano token e non contengono palette o selettori di tema.
- Nessuna nuova libreria visuale e consentita. PostCSS e solo uno strumento di audit in sviluppo e non entra nel renderer.
- Callback, contratti IPC, persistenza, sessioni PTY e formati dati non cambiano.
- Le azioni mutative e remote mantengono conferme e feedback esistenti.
- A fine task collisioni e `!important` non possono aumentare rispetto all'ultimo checkpoint approvato.
- Il main JavaScript parte dalla baseline dichiarata di 454,20 kB e dalla misura corrente di 463,98 kB raw / 142,48 kB gzip; il CSS parte da 181,17 kB raw / 28,04 kB gzip.
- Il bundle viene misurato ma non ottimizzato senza superamento della soglia stabilita o un problema prestazionale riproducibile.
- Sviluppo sul ramo `main`, con commit piccoli e descrittivi in italiano, come richiesto dal progetto.

---

## Mappa dei file target

**Nuovi file condivisi**

- `src/styles/index.css`: unico entrypoint e ordine dichiarativo dei layer.
- `src/styles/tokens.css`: scale non cromatiche e ruoli semantici comuni.
- `src/styles/themes.css`: valori chiaro/scuro e adattamento `system`.
- `src/styles/base.css`: reset, tipografia, focus, scrollbar e adapter Shadcn/Tailwind.
- `src/styles/primitives.css`: button, input, tab, toolbar, badge, dialog, toast, empty/loading/error state.
- `src/styles/shell.css`: finestra, header, navigazione, contenuto, boundary e resize handle.
- `src/styles/views/home.css`: Home e workspace recenti.
- `src/styles/views/ai.css`: Terminale AI, Skill progetto e Istruzioni.
- `src/styles/views/terminal.css`: Terminale libero, drawer Comandi e File remoti.
- `src/styles/views/editor.css`: explorer, tab, CodeMirror e preview.
- `src/styles/views/database.css`: explorer, editor SQL, griglia e split pane.
- `src/styles/views/github.css`: Modifiche, Grafo, Issue e Project.
- `src/styles/views/settings.css`: Impostazioni globali e override workspace.

**Audit e prove**

- `scripts/lib/css-audit.mjs`: parser e modello del report.
- `scripts/audit-css.mjs`: CLI leggibile e modalita `--check`.
- `scripts/css-audit.config.mjs`: proprietari, eccezioni e budget decrescenti.
- `test/css-architecture.test.mjs`: test dei confini CSS.
- `test/ui-design-system.test.cjs`: migrazione dei test strutturali esistenti.
- `docs/qa/enterprise-css-visual-baseline.md`: matrice delle verifiche visive.
- `docs/qa/bundle-trend.md`: misure confrontabili raw/gzip.

**File legacy da eliminare solo nell'ultimo task**

- `src/App.css`
- `src/design-system.css`
- `src/dark-theme.css`
- `src/skills.css`
- `src/terminal.css`
- `src/editor.css`
- `src/persistent-tabs.css`
- `src/github.css`
- `src/database.css`
- `src/settings.css`
- `src/index.css`

---

### Task 1: Audit CSS riproducibile e guardrail

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/lib/css-audit.mjs`
- Create: `scripts/audit-css.mjs`
- Create: `scripts/css-audit.config.mjs`
- Create: `test/css-architecture.test.mjs`

**Interfaces:**
- Produces: `collectCssFiles(rootDir: string): string[]`.
- Produces: `auditCssArchitecture(options: { rootDir: string, files?: string[] }): CssAuditReport`.
- Produces: `CssAuditReport` con `files`, `selectorCount`, `collisions`, `collisionSelectorCount`, `importantOccurrences`, `hardcodedColors`, `viewThemeSelectors`.
- Produces: comandi `npm run audit:css` e `npm run audit:css:check`.

- [ ] **Step 1: Aggiungere PostCSS come dipendenza diretta di sviluppo**

Run: `npm install --save-dev postcss@8.5.26`

Expected: `package.json` contiene `"postcss": "^8.5.26"`; nessuna dipendenza runtime viene aggiunta.

- [ ] **Step 2: Scrivere il test fallente del parser**

Creare `test/css-architecture.test.mjs` con fixture temporanee:

```js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { auditCssArchitecture } from '../scripts/lib/css-audit.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const read = (file) => fs.readFileSync(path.join(repoRoot, file), 'utf8')
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('audit CSS rileva collisioni, important, palette locali e temi nelle viste', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-css-'))
  fs.mkdirSync(path.join(rootDir, 'src/styles/views'), { recursive: true })
  fs.writeFileSync(path.join(rootDir, 'src/a.css'), '.toolbar { color: var(--text-primary) !important; }')
  fs.writeFileSync(path.join(rootDir, 'src/styles/views/editor.css'), '.toolbar { color: #fff; } [data-theme="dark"] .panel { color: var(--text-primary); } @media (prefers-color-scheme: dark) { .panel { background: var(--surface-panel); } }')

  const report = auditCssArchitecture({ rootDir })

  assert.equal(report.collisions.length, 1)
  assert.equal(report.importantOccurrences.length, 1)
  assert.equal(report.hardcodedColors.length, 1)
  assert.equal(report.viewThemeSelectors.length, 2)
})
```

- [ ] **Step 3: Eseguire il test e verificare il fallimento previsto**

Run: `node --test test/css-architecture.test.mjs`

Expected: FAIL con modulo `scripts/lib/css-audit.mjs` non trovato.

- [ ] **Step 4: Implementare il modello di audit**

Creare `scripts/lib/css-audit.mjs` usando `postcss.parse`. Normalizzare ogni selettore rimuovendo spazi ripetuti; una collisione e la stessa coppia `selector + property` dichiarata in almeno due file differenti. Conservare file, linea e valore di ogni occorrenza.

```js
import fs, { globSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'

const COLOR = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i

export function collectCssFiles(rootDir) {
  return globSync('src/**/*.css', { cwd: rootDir, absolute: true }).sort()
}

function location(file, node, value) {
  return { file, line: node.source?.start?.line ?? 0, value }
}

function recordDeclaration({ declarations, report, file, selector, declaration }) {
  const item = { ...location(file, declaration, declaration.value), selector, property: declaration.prop }
  const key = `${selector}\0${declaration.prop}`
  const occurrences = declarations.get(key) ?? []
  occurrences.push(item)
  declarations.set(key, occurrences)
  if (declaration.important) report.importantOccurrences.push(item)
  const owner = path.basename(file)
  if (!['tokens.css', 'themes.css'].includes(owner) && COLOR.test(declaration.value)) report.hardcodedColors.push(item)
}

export function auditCssArchitecture({ rootDir, files = collectCssFiles(rootDir) }) {
  const declarations = new Map()
  const report = {
    files,
    selectorCount: 0,
    collisions: [],
    importantOccurrences: [],
    hardcodedColors: [],
    viewThemeSelectors: [],
  }

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const root = postcss.parse(source, { from: file })
    root.walkRules((rule) => {
      const selectors = rule.selectors.map((value) => value.replace(/\s+/g, ' ').trim())
      report.selectorCount += selectors.length
      for (const selector of selectors) {
        if (file.includes('/styles/views/') && /data-theme|prefers-color-scheme/.test(selector)) {
          report.viewThemeSelectors.push(location(file, rule, selector))
        }
        rule.walkDecls((declaration) => recordDeclaration({ declarations, report, file, selector, declaration }))
      }
    })
    if (file.includes('/styles/views/')) {
      root.walkAtRules('media', (rule) => {
        if (/prefers-color-scheme/.test(rule.params)) report.viewThemeSelectors.push(location(file, rule, rule.params))
      })
    }
  }

  report.collisions = [...declarations.values()].filter((items) => new Set(items.map((item) => item.file)).size > 1)
  return report
}
```

I colori hard-coded da rilevare sono `#rgb`, `#rrggbb`, `rgb()`, `rgba()`, `hsl()`, `hsla()` e `oklch()` fuori da `tokens.css` e `themes.css`.

- [ ] **Step 5: Implementare configurazione e CLI**

Creare `scripts/css-audit.config.mjs`:

```js
export const cssAuditBudget = {
  maxCollisionSelectors: 147,
  maxCollisionProperties: 268,
  maxImportantOccurrences: 140,
  maxHardcodedColors: 0,
  maxViewThemeSelectors: 0,
}
```

`scripts/audit-css.mjs` stampa un riepilogo e termina con codice 1 in `--check` soltanto quando un valore supera il budget. Aggiungere:

```json
{
  "audit:css": "node scripts/audit-css.mjs",
  "audit:css:check": "node scripts/audit-css.mjs --check"
}
```

- [ ] **Step 6: Verificare parser e baseline corrente**

Run: `node --test test/css-architecture.test.mjs && npm run audit:css:check`

Expected: PASS; il report espone conteggi, file e posizioni senza modificare sorgenti.

- [ ] **Step 7: Committare il guardrail**

```bash
git add package.json package-lock.json scripts test/css-architecture.test.mjs
git commit -m "test: introduce l'audit dell'architettura CSS"
```

---

### Task 2: Token, temi e singolo entrypoint

**Files:**
- Create: `src/styles/index.css`
- Create: `src/styles/tokens.css`
- Create: `src/styles/themes.css`
- Create: `src/styles/base.css`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/xterm-theme.ts`
- Modify: `src/components/free-terminal.tsx`
- Modify: `src/design-system.css`
- Modify: `src/dark-theme.css`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Produces: `data-theme="system|light|dark"` su `document.documentElement`.
- Produces: token `--surface-*`, `--text-*`, `--line-*`, `--state-*`, `--code-*`, `--git-*`, `--space-*`, `--radius-*`, `--control-height-*`.
- Consumes: `appearance` persistita da Electron e `readXtermTheme()` esistente.

- [ ] **Step 1: Scrivere i test fallenti dei confini del tema**

Aggiungere a `test/css-architecture.test.mjs`:

```js
test('temi e token sono separati dalle viste', () => {
  const tokens = read('src/styles/tokens.css')
  const themes = read('src/styles/themes.css')
  const app = read('src/App.tsx')
  const main = read('src/main.tsx')

  for (const token of ['--radius-sm: 2px', '--radius-md: 4px', '--control-height-sm: 28px', '--control-height-md: 32px']) {
    assert.match(tokens, new RegExp(escapeRegExp(token)))
  }
  assert.match(themes, /:root\[data-theme="dark"\]/)
  assert.match(themes, /:root\[data-theme="light"\]/)
  assert.match(themes, /:root\[data-theme="system"\]/)
  assert.match(app, /document\.documentElement\.dataset\.theme = appearance/)
  assert.match(main, /\.\/styles\/index\.css/)
})
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento**

Run: `node --test --test-name-pattern="temi e token" test/css-architecture.test.mjs`

Expected: FAIL per file `src/styles/tokens.css` assente.

- [ ] **Step 3: Creare token geometrici e semantici**

`src/styles/tokens.css` deve contenere almeno:

```css
:root {
  --space-0-5: 2px;
  --space-1: 4px;
  --space-1-5: 6px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-overlay: 6px;
  --radius-lg: var(--radius-overlay);
  --control-height-sm: 28px;
  --control-height-md: 32px;
  --control-height-lg: 36px;
  --type-body: 13px;
  --type-meta: 11px;
  --type-section: 14px;
  --type-page: 16px;
  --elevation-overlay: 0 12px 32px rgb(0 0 0 / 22%);
  --motion-fast: 100ms;
  --motion-standard: 160ms;
  --surface-container: var(--surface-subtle);
  --surface-container-high: var(--surface-hover);
  --surface-inverse: var(--code-surface);
  --text-inverse: var(--code-text);
  --focus: var(--focus-ring);
  --selection: var(--surface-selected);
  --brand: var(--accent);
  --brand-hover: var(--accent-hover);
  --brand-soft: var(--accent-soft);
  --danger: var(--state-error);
  --danger-soft: var(--state-error-soft);
  --success: var(--state-success);
  --success-soft: var(--state-success-soft);
  --warning: var(--state-warning);
  --warning-soft: var(--state-warning-soft);
  --error: var(--state-error);
  --error-soft: var(--state-error-soft);
  --info: var(--state-info);
  --info-soft: var(--state-info-soft);
  --git-added: var(--state-success);
  --git-modified: var(--state-warning);
  --git-deleted: var(--state-error);
  --git-renamed: var(--state-info);
  --git-graph-lane-0: var(--accent);
  --git-graph-lane-1: var(--state-success);
  --git-graph-lane-2: var(--state-warning);
  --git-graph-lane-3: var(--state-error);
  --git-graph-lane-4: var(--state-info);
  --git-graph-lane-5: var(--state-inactive);
  --elevation-0: none;
  --elevation-1: none;
  --elevation-2: var(--elevation-overlay);
  --shadow-sm: var(--elevation-1);
  --shadow-md: var(--elevation-2);
  --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-body: var(--font-display);
  --font-code: "SF Mono", Menlo, Monaco, Consolas, monospace;
  --type-title: 18px;
  --line-height-body: 1.4;
  --line-height-code: 1.45;
}
```

Trasferire tutti i ruoli semantici gia consumati dall'app; nessun selettore applicativo entra in questo file.

- [ ] **Step 4: Creare le palette equivalenti**

`src/styles/themes.css` definisce light come default esplicito, dark esplicito e system tramite media query:

```css
:root,
:root[data-theme="light"] {
  color-scheme: light;
  --surface-canvas: #edf1f5;
  --surface-panel: #f7f9fb;
  --surface-raised: #ffffff;
  --surface-subtle: #e5eaf0;
  --surface-hover: #dce5ee;
  --surface-selected: #d4e6f4;
  --text-primary: #17212e;
  --text-secondary: #526174;
  --text-tertiary: #718095;
  --line: #c7d0da;
  --line-strong: #aab6c4;
  --focus-ring: #0078b8;
  --accent: #006fae;
  --accent-hover: #005f96;
  --accent-soft: #dceef8;
  --state-success: #237a45;
  --state-success-soft: #e1f1e7;
  --state-warning: #8a5a00;
  --state-warning-soft: #f7ecd2;
  --state-error: #b13b48;
  --state-error-soft: #f7e3e6;
  --state-info: #126fa5;
  --state-info-soft: #deedf6;
  --state-inactive: #6d7887;
  --state-inactive-soft: #e7eaee;
  --code-surface: #111820;
  --code-text: #d8e2ed;
  --code-muted: #8190a3;
  --code-line: #293849;
  --code-selection: #214b67;
  --scrim: rgb(7 13 21 / 58%);
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-canvas: #0e1621;
  --surface-panel: #131e2b;
  --surface-raised: #192534;
  --surface-subtle: #1d2a3a;
  --surface-hover: #25374a;
  --surface-selected: #183c56;
  --text-primary: #e7edf5;
  --text-secondary: #aab6c5;
  --text-tertiary: #7f8da0;
  --line: #314255;
  --line-strong: #465a70;
  --focus-ring: #54bdf2;
  --accent: #45afe7;
  --accent-hover: #67c3ef;
  --accent-soft: #15384d;
  --state-success: #58c985;
  --state-success-soft: #173827;
  --state-warning: #e4b052;
  --state-warning-soft: #3d2e14;
  --state-error: #ef7580;
  --state-error-soft: #422129;
  --state-info: #62bce9;
  --state-info-soft: #17364a;
  --state-inactive: #8794a5;
  --state-inactive-soft: #273240;
  --code-surface: #0a1119;
  --code-text: #dce6f1;
  --code-muted: #7f8ea1;
  --code-line: #263647;
  --code-selection: #1f4a65;
  --scrim: rgb(0 0 0 / 66%);
}

:root[data-theme="system"] { color-scheme: light dark; }

@media (prefers-color-scheme: dark) {
  :root[data-theme="system"] {
    --surface-canvas: #0e1621;
    --surface-panel: #131e2b;
    --surface-raised: #192534;
    --surface-subtle: #1d2a3a;
    --surface-hover: #25374a;
    --surface-selected: #183c56;
    --text-primary: #e7edf5;
    --text-secondary: #aab6c5;
    --text-tertiary: #7f8da0;
    --line: #314255;
    --line-strong: #465a70;
    --focus-ring: #54bdf2;
    --accent: #45afe7;
    --accent-hover: #67c3ef;
    --accent-soft: #15384d;
    --state-success: #58c985;
    --state-success-soft: #173827;
    --state-warning: #e4b052;
    --state-warning-soft: #3d2e14;
    --state-error: #ef7580;
    --state-error-soft: #422129;
    --state-info: #62bce9;
    --state-info-soft: #17364a;
    --state-inactive: #8794a5;
    --state-inactive-soft: #273240;
    --code-surface: #0a1119;
    --code-text: #dce6f1;
    --code-muted: #7f8ea1;
    --code-line: #263647;
    --code-selection: #1f4a65;
    --scrim: rgb(0 0 0 / 66%);
  }
}
```

La variante esplicita dark e il blocco system scuro assegnano gli stessi ruoli semantici. Questa duplicazione e confinata a `themes.css`; non inserire classi di componenti. Rimuovere contestualmente da `design-system.css` le definizioni dei token e da `dark-theme.css` le assegnazioni di palette gia trasferite, lasciando temporaneamente soltanto regole di compatibilita dei componenti non migrati.

- [ ] **Step 5: Creare base e entrypoint**

`src/styles/index.css` centralizza subito gli import. Nel Task 2 importa la fondazione e, in un blocco esplicitamente temporaneo, i fogli legacy ancora necessari:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "./tokens.css";
@import "./themes.css";
@import "./base.css";
/* legacy-bridge: tutte le viste — rimuovere nel Task 8 */
@import "../App.css";
@import "../skills.css";
@import "../terminal.css";
@import "../editor.css";
@import "../persistent-tabs.css";
@import "../github.css";
@import "../database.css";
@import "../dark-theme.css";
@import "../design-system.css";
@import "../settings.css";
```

I Task successivi aggiungono `primitives.css`, `shell.css` e i fogli vista dopo il blocco legacy, così il nuovo proprietario prevale durante la transizione. Ogni Task rimuove dal foglio vecchio i selettori appena migrati; l'ordine smette quindi di essere rilevante al completamento del Task 8. Rimuovere tutti gli import CSS applicativi da `App.tsx` e sostituire `./index.css` con `./styles/index.css` in `main.tsx`.

- [ ] **Step 6: Collegare la preferenza al nodo radice**

In `src/App.tsx` aggiungere un effect prima dell'aggiornamento xterm:

```ts
useEffect(() => {
  const root = document.documentElement
  root.dataset.theme = appearance
  root.style.colorScheme = appearance === 'system' ? 'light dark' : appearance
}, [appearance])
```

Spostare l'import globale da `src/main.tsx` a `./styles/index.css`; mantenere il CSS xterm importato una volta.

- [ ] **Step 7: Allineare xterm alla nuova sorgente di tema**

Rimuovere dal Terminale libero listener duplicati che servono solo a scegliere la palette. Conservare il refit esistente e aggiornare `options.theme = readXtermTheme()` quando cambia `data-theme` o la media query di sistema.

- [ ] **Step 8: Verificare tema e regressioni automatiche**

Run: `node --test test/css-architecture.test.mjs test/ui-design-system.test.cjs && npm run audit:css:check`

Expected: PASS; nessun token richiesto manca e nessun file vista contiene nuova palette.

- [ ] **Step 9: Committare la fondazione tema**

```bash
git add src/styles src/main.tsx src/App.tsx src/lib/xterm-theme.ts src/components/free-terminal.tsx test
git commit -m "refactor: unifica token e temi del workbench"
```

---

### Task 3: Primitive desktop e shell applicativa

**Files:**
- Create: `src/styles/primitives.css`
- Create: `src/styles/shell.css`
- Modify: `src/components/ui/button.tsx`
- Modify: `src/components/confirmation-dialog.tsx`
- Modify: `src/components/empty-state.tsx`
- Modify: `src/components/view-error-boundary.tsx`
- Modify: `src/App.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/ui-design-system.test.cjs`

**Interfaces:**
- Produces: `.ui-toolbar`, `.ui-tablist`, `.ui-panel`, `.ui-badge`, `.ui-empty-state`, `.ui-loading-state`, `.ui-error-state`.
- Produces: shell con `.app-shell`, `.window-toolbar`, `.app-section-tabs`, `.app-section-page` e `.panel-resize-handle`.
- Consumes: token dei Task 2 e callback esistenti.

- [ ] **Step 1: Scrivere il test fallente delle primitive enterprise**

```js
test('primitive e shell rispettano la geometria enterprise', () => {
  const primitives = read('src/styles/primitives.css')
  const shell = read('src/styles/shell.css')
  const button = read('src/components/ui/button.tsx')

  assert.match(primitives, /\.ui-toolbar\s*\{[^}]*min-height:\s*var\(--control-height-md\)/s)
  assert.match(primitives, /\.ui-panel\s*\{[^}]*border:\s*1px solid var\(--line\)/s)
  assert.doesNotMatch(primitives, /linear-gradient|radial-gradient/)
  assert.doesNotMatch(shell, /box-shadow:\s*var\(--elevation-overlay\)/)
  assert.match(button, /rounded-\[var\(--radius-sm\)\]/)
  assert.doesNotMatch(button, /rounded-lg|translate-y-px/)
})
```

- [ ] **Step 2: Verificare che il test fallisca**

Run: `node --test --test-name-pattern="geometria enterprise" test/css-architecture.test.mjs`

Expected: FAIL per primitive non ancora implementate.

- [ ] **Step 3: Implementare primitive senza override globali**

Definire controlli per ruolo e stato. Il focus usa `box-shadow: 0 0 0 2px var(--focus-ring)` senza `!important`; disabled mantiene contrasto e cursore. Le tab usano fondo continuo e indicatore inferiore di 2 px, non pill.

```css
.ui-panel { min-width: 0; min-height: 0; border: 1px solid var(--line); background: var(--surface-panel); }
.ui-toolbar { display: flex; min-height: var(--control-height-md); align-items: center; gap: var(--space-1); border-bottom: 1px solid var(--line); }
.ui-tablist { display: flex; min-height: var(--control-height-md); align-items: stretch; border-bottom: 1px solid var(--line); }
.ui-tab[aria-selected="true"] { color: var(--text-primary); box-shadow: inset 0 -2px var(--accent); }
```

Aggiungere `@import "./primitives.css";` e `@import "./shell.css";` in fondo a `src/styles/index.css`, dopo il blocco legacy.

- [ ] **Step 4: Ridurre la geometria del componente Button**

In `src/components/ui/button.tsx` sostituire i raggi Tailwind con `rounded-[var(--radius-sm)]`, mantenere altezze 24/28/32/36 coerenti per `xs`, `sm`, `default`, `lg`, rimuovere la traslazione verticale e usare stati cromatici derivati dai token.

- [ ] **Step 5: Migrare dialog, empty state e boundary**

Assegnare le primitive condivise ai componenti senza cambiare testi o callback. `ViewErrorBoundary` resta interno a `.app-section-page`; la toolbar globale non deve essere discendente del boundary.

- [ ] **Step 6: Migrare la shell e rimuovere i duplicati proprietari**

Spostare da `App.css` e `design-system.css` soltanto i selettori di shell e resize. Il bridge legacy non puo ridefinire le stesse proprieta nel nuovo layer; rimuovere la regola vecchia appena migrata.

- [ ] **Step 7: Verificare shell, menu e boundary**

Run: `node --test --test-name-pattern="geometria enterprise|errore di vista|notifiche|navigazione principale" test/css-architecture.test.mjs test/ui-design-system.test.cjs`

Expected: PASS.

- [ ] **Step 8: Verificare l'app in chiaro e scuro**

Avviare `npm run dev`; controllare Home e Impostazioni con `Sistema`, `Chiaro`, `Scuro`, una larghezza ampia e una inferiore a 900 px. Verificare header, tab, focus, toast, modal e boundary senza overflow.

- [ ] **Step 9: Committare primitive e shell**

```bash
git add src/styles src/components src/App.tsx test
git commit -m "refactor: introduce primitive e shell desktop enterprise"
```

---

### Task 4: Terminale AI, Terminale libero e File remoti

**Files:**
- Create: `src/styles/views/ai.css`
- Create: `src/styles/views/terminal.css`
- Modify: `src/App.tsx`
- Modify: `src/components/terminal-workspace.tsx`
- Modify: `src/components/terminal-toolbar.tsx`
- Modify: `src/components/terminal-attachments.tsx`
- Modify: `src/components/free-terminal.tsx`
- Modify: `src/components/remote-files.tsx`
- Modify: `src/components/remote-diff-dialog.tsx`
- Modify: `src/components/project-skills.tsx`
- Modify: `src/components/project-instructions.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/terminal-resize.test.mjs`
- Modify: `test/remote-files-ui.test.cjs`

**Interfaces:**
- Consumes: `.ui-toolbar`, `.ui-tablist`, `.ui-panel` e token codice.
- Produces: layout proprietari `.ai-workbench`, `.terminal-workbench`, `.remote-files-workbench`.
- Preserves: PTY, ricerca xterm, allegati, drawer Comandi, profili SSH e trasferimenti.

- [ ] **Step 1: Scrivere il test fallente della proprieta CSS Terminale**

```js
test('Terminale e AI possiedono stili isolati e senza palette locale', () => {
  const ai = read('src/styles/views/ai.css')
  const terminal = read('src/styles/views/terminal.css')
  for (const source of [ai, terminal]) {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i)
    assert.doesNotMatch(source, /!important|data-theme|prefers-color-scheme/)
  }
  assert.match(terminal, /\.terminal-workbench\s*\{[^}]*min-width:\s*0/s)
  assert.match(terminal, /\.remote-files-workbench\s*\{[^}]*grid-template-columns:/s)
})
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test --test-name-pattern="Terminale e AI" test/css-architecture.test.mjs`

Expected: FAIL per fogli vista assenti o incompleti.

- [ ] **Step 3: Migrare Terminale AI, Skill e Istruzioni**

Sostituire card e grandi spazi con toolbar, tab e pannelli continui. Il terminale conserva `min-width: 0`, `min-height: 0`, `overflow: hidden`; solo `.xterm-viewport` gestisce lo scroll verticale del terminale.

Aggiungere `@import "./views/ai.css";` e `@import "./views/terminal.css";` in fondo a `src/styles/index.css`.

- [ ] **Step 4: Migrare Terminale libero e drawer Comandi**

Il drawer usa larghezza variabile esistente, header non sovrapposto, righe comando compatte e form espandibile. I controlli zoom restano nell'ordine `-`, valore, `+` e non possono sovrapporsi.

- [ ] **Step 5: Migrare File remoti**

Rendere tab principali e secondarie coerenti con `.ui-tablist`; mantenere sidebar connessioni ridimensionabile, toolbar nel proprio pannello, stato vuoto operativo e footer trasferimenti. Nessun pulsante deve uscire dal pannello a 900 px.

- [ ] **Step 6: Rimuovere regole Terminale/AI dai fogli legacy**

Eliminare i selettori migrati da `terminal.css`, `skills.css`, `persistent-tabs.css`, `App.css`, `design-system.css` e `dark-theme.css`. Aggiornare il budget audit al nuovo valore misurato, esclusivamente in diminuzione.

- [ ] **Step 7: Eseguire regressione automatica Terminale**

Run: `node --test test/terminal-*.test.mjs test/terminal-*.test.cjs test/remote-files-ui.test.cjs test/remote-file-service.test.cjs test/sftp-service.test.cjs test/css-architecture.test.mjs`

Expected: PASS.

- [ ] **Step 8: Eseguire regressione runtime Terminale**

In hot reload verificare: AI → Editor → AI, Terminale → File remoti → Terminale, reload PTY, resize finestra, apertura/chiusura Comandi, zoom, ricerca, SSH attivo e stato vuoto senza SSH. Ripetere chiaro/scuro.

- [ ] **Step 9: Committare la tranche Terminale**

```bash
git add src/styles/views src/App.tsx src/components src/*.css test scripts/css-audit.config.mjs
git commit -m "refactor: migra terminali e AI al workbench enterprise"
```

---

### Task 5: Editor progetto

**Files:**
- Create: `src/styles/views/editor.css`
- Modify: `src/components/project-editor.tsx`
- Modify: `src/components/markdown-preview.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/editor-ux.test.cjs`

**Interfaces:**
- Consumes: primitive condivise, token codice e token Git.
- Produces: `.editor-workbench`, `.editor-explorer`, `.editor-document` e integrazioni CodeMirror confinate.
- Preserves: resize explorer, stato Git, ricerca, salvataggio, immagini, PDF, CSV e Markdown preview.

- [ ] **Step 1: Scrivere il test fallente dell'isolamento Editor**

```js
test('Editor usa token e confina le integrazioni CodeMirror', () => {
  const editor = read('src/styles/views/editor.css')
  assert.match(editor, /\.editor-workbench\s*\{[^}]*grid-template-columns:/s)
  assert.match(editor, /\.codemirror-host \.cm-editor/)
  assert.doesNotMatch(editor, /#[0-9a-f]{3,8}\b|!important|data-theme|prefers-color-scheme/i)
  for (const token of ['--code-surface', '--code-text', '--git-added', '--git-modified', '--git-deleted']) {
    assert.match(editor, new RegExp(token))
  }
})
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test --test-name-pattern="Editor usa token" test/css-architecture.test.mjs`

Expected: FAIL per foglio vista assente.

- [ ] **Step 3: Migrare struttura e explorer**

Applicare pannello continuo, intestazione compatta, righe file da 24-28 px, rientri gerarchici e badge Git allineati. Il resize conserva `--editor-explorer-width` e limiti esistenti.

Aggiungere `@import "./views/editor.css";` in fondo a `src/styles/index.css`.

- [ ] **Step 4: Migrare editor, ricerca e preview**

Confinare le eccezioni CodeMirror sotto `.codemirror-host`; usare token del codice per gutters, pannelli e selezione. Preview immagini/PDF/CSV/Markdown usa lo stesso pannello documento, senza card annidate.

- [ ] **Step 5: Rimuovere regole Editor legacy**

Eliminare i selettori migrati da `editor.css`, `App.css`, `design-system.css` e `dark-theme.css`; ridurre il budget audit ai valori misurati.

- [ ] **Step 6: Eseguire regressione Editor**

Run: `node --test test/editor-ux.test.cjs test/editor-remote-files.test.cjs test/project-files.test.cjs test/css-architecture.test.mjs`

Expected: PASS.

- [ ] **Step 7: Verificare runtime Editor**

Aprire un file testo, modificare e salvare, verificare `M` sul file e sulla cartella, usare ricerca, ridimensionare explorer e aprire immagine, PDF, CSV e preview Markdown in chiaro/scuro.

- [ ] **Step 8: Committare la tranche Editor**

```bash
git add src/styles/views/editor.css src/components/project-editor.tsx src/components/markdown-preview.tsx src/*.css test scripts/css-audit.config.mjs
git commit -m "refactor: migra l'editor al workbench enterprise"
```

---

### Task 6: Database workspace

**Files:**
- Create: `src/styles/views/database.css`
- Modify: `src/components/database-workspace.tsx`
- Modify: `src/components/database-table-grid.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/ui-design-system.test.cjs`
- Verify: `test/database-*.test.cjs`

**Interfaces:**
- Consumes: primitive pannello, toolbar, tab, loading e dialog.
- Produces: `.database-workbench`, `.database-explorer`, `.database-sql-pane`, `.database-result-pane`.
- Preserves: connessioni, schema, tabelle, procedure, funzioni, query, transazioni, griglia modificabile e split pane.

- [ ] **Step 1: Scrivere il test fallente del workbench Database**

```js
test('Database usa explorer e split pane enterprise senza palette locale', () => {
  const database = read('src/styles/views/database.css')
  assert.match(database, /\.database-workbench\s*\{[^}]*grid-template-columns:/s)
  assert.match(database, /\.database-editor-split\s*\{[^}]*grid-template-rows:/s)
  assert.doesNotMatch(database, /#[0-9a-f]{3,8}\b|!important|data-theme|prefers-color-scheme/i)
})
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test --test-name-pattern="Database usa explorer" test/css-architecture.test.mjs`

Expected: FAIL per foglio vista assente.

- [ ] **Step 3: Migrare explorer e toolbar Database**

Usare righe compatte per connessioni, tabelle, procedure e funzioni; ricerca e tab restano sticky nel pannello. Loading iniziale occupa il pannello oggetti e comunica la risorsa caricata senza bloccare la toolbar globale.

Aggiungere `@import "./views/database.css";` in fondo a `src/styles/index.css`.

- [ ] **Step 4: Migrare editor SQL, griglia e split**

Editor e risultato condividono separatore orizzontale accessibile; fullscreen agisce solo sul pannello scelto. La griglia usa righe dense, header sticky, stato bozza/modificato/salvato e scroll interno.

- [ ] **Step 5: Rimuovere regole Database legacy**

Eliminare i selettori migrati da `database.css`, `design-system.css`, `dark-theme.css` e `App.css`; ridurre il budget audit.

- [ ] **Step 6: Eseguire regressione Database**

Run: `node --test test/database-*.test.cjs test/css-architecture.test.mjs`

Expected: PASS, inclusi guard mutazioni, store, query e service.

- [ ] **Step 7: Verificare runtime Database**

Aprire una connessione reale disponibile, attendere loader, aggiornare schema, aprire tabella/procedura/funzione, evidenziare SQL, eseguire query, ridimensionare e portare entrambi i pannelli in fullscreen. Per una tabella modificabile, doppio click, bozza, conferma e salvataggio. Ripetere chiaro/scuro senza effettuare modifiche distruttive non necessarie.

- [ ] **Step 8: Committare la tranche Database**

```bash
git add src/styles/views/database.css src/components/database-*.tsx src/*.css test scripts/css-audit.config.mjs
git commit -m "refactor: migra il database al workbench enterprise"
```

---

### Task 7: GitHub workspace

**Files:**
- Create: `src/styles/views/github.css`
- Modify: `src/components/github-workspace.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/ui-design-system.test.cjs`
- Verify: `test/git-graph.test.mjs`
- Verify: `test/github-*.test.cjs`
- Verify: `test/github-project-status.test.mjs`

**Interfaces:**
- Consumes: primitive toolbar, tab, panel, badge, dialog, loading e empty state.
- Produces: `.github-workbench`, `.github-changes-layout`, `.github-graph-layout`, `.github-issues-layout`, `.github-project-layout`.
- Preserves: Git locale, grafo, issue, Project, gruppi, sub-issue, stati, ricerca numerica e conferme remote.

- [ ] **Step 1: Scrivere il test fallente della vista GitHub**

```js
test('GitHub usa layout operativi continui e stati semantici', () => {
  const github = read('src/styles/views/github.css')
  for (const layout of ['changes', 'graph', 'issues', 'project']) {
    assert.match(github, new RegExp(`\\.github-${layout}-layout`))
  }
  for (const state of ['--state-success', '--state-warning', '--state-error', '--state-info']) {
    assert.match(github, new RegExp(state))
  }
  assert.doesNotMatch(github, /linear-gradient|radial-gradient|#[0-9a-f]{3,8}\b|!important|data-theme/i)
})
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test --test-name-pattern="GitHub usa layout" test/css-architecture.test.mjs`

Expected: FAIL per foglio vista assente.

- [ ] **Step 3: Migrare Modifiche e Grafo**

Modifiche usa master-detail compatto senza buchi; branch, staging, compositore e diff hanno gerarchia unica. Il Grafo usa linee continue, corsie colorate e righe senza separatori che interrompono i rami.

Aggiungere `@import "./views/github.css";` in fondo a `src/styles/index.css`.

- [ ] **Step 4: Migrare Issue**

Elenco a tutta larghezza, toolbar di ricerca `175`/`#175`, filtri e loader. Il dettaglio rende Markdown come preview; il form nuova issue resta in modal.

- [ ] **Step 5: Migrare Project**

Selettore progetto ridimensionabile e comprimibile, tabella densa, rientro tra gruppo e attività, stati colorati, assegnatari senza overflow, sub-issue e loader esplicito durante paginazione completa.

- [ ] **Step 6: Rimuovere regole GitHub legacy**

Eliminare i selettori migrati da `github.css`, `design-system.css`, `dark-theme.css` e `App.css`; ridurre il budget audit.

- [ ] **Step 7: Eseguire regressione GitHub**

Run: `node --test test/git-graph.test.mjs test/github-*.test.cjs test/github-project-status.test.mjs test/css-architecture.test.mjs test/ui-design-system.test.cjs`

Expected: PASS.

- [ ] **Step 8: Verificare runtime GitHub**

Controllare Modifiche con zero e piu file, selezione diff, Grafo con merge, ricerca issue numerica, dettaglio issue, Project con gruppi e sub-issue, resize selettore e stati. Verificare loading/error/empty e temi chiaro/scuro.

- [ ] **Step 9: Committare la tranche GitHub**

```bash
git add src/styles/views/github.css src/components/github-workspace.tsx src/*.css test scripts/css-audit.config.mjs
git commit -m "refactor: migra GitHub al workbench enterprise"
```

---

### Task 8: Home, Impostazioni e rimozione dei fogli legacy

**Files:**
- Create: `src/styles/views/home.css`
- Create: `src/styles/views/settings.css`
- Modify: `src/App.tsx`
- Modify: `src/components/settings.tsx`
- Modify: `test/css-architecture.test.mjs`
- Modify: `test/settings-ui.test.cjs`
- Modify: `test/ui-design-system.test.cjs`
- Delete: gli 11 file CSS legacy elencati nella mappa, dopo aver verificato che nessun import li referenzi.

**Interfaces:**
- Consumes: shell e primitive consolidate.
- Produces: Home e Impostazioni completamente migrate.
- Produces: entrypoint CSS senza bridge legacy e budget audit finale.

- [ ] **Step 1: Scrivere il test fallente di eliminazione legacy**

```js
test('entrypoint CSS non dipende dai fogli legacy', () => {
  const app = read('src/App.tsx')
  const main = read('src/main.tsx')
  const legacy = ['App.css', 'design-system.css', 'dark-theme.css', 'skills.css', 'terminal.css', 'editor.css', 'persistent-tabs.css', 'github.css', 'database.css', 'settings.css', 'index.css']

  for (const file of legacy) {
    assert.equal(app.includes(`'./${file}'`), false)
    assert.equal(main.includes(`'./${file}'`), false)
  }
  assert.match(main, /\.\/styles\/index\.css/)
})
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test --test-name-pattern="non dipende dai fogli legacy" test/css-architecture.test.mjs`

Expected: FAIL finche esiste almeno un import legacy.

- [ ] **Step 3: Migrare Home**

Recenti usa elenco o griglia compatta con toolbar unica; apertura workspace non e una hero promozionale. Stati loading, vuoto ed errore mantengono la geometria della pagina.

Aggiungere `@import "./views/home.css";` e `@import "./views/settings.css";` in fondo a `src/styles/index.css`.

- [ ] **Step 4: Migrare Impostazioni**

Generali, Aggiornamenti, Runtime Pi, Pacchetti Pi e Skill Pi usano tab condivise, sezioni continue e righe preferenza compatte. Valori globali e workspace restano distinguibili senza grandi card.

- [ ] **Step 5: Aggiornare i test strutturali al nuovo proprietario**

In `test/ui-design-system.test.cjs`, sostituire letture di `design-system.css` e fogli legacy con `tokens.css`, `themes.css`, `primitives.css`, `shell.css` o il file vista proprietario. Non indebolire le asserzioni funzionali esistenti.

- [ ] **Step 6: Eliminare bridge e file legacy**

Run prima della rimozione: `rg -n "legacy-bridge|App\.css|design-system\.css|dark-theme\.css|skills\.css|persistent-tabs\.css" src test`

Expected: restano solo riferimenti che questo step rimuove. Eliminare i file legacy e impostare `maxImportantOccurrences: 0`, salvo eccezioni terze parti documentate con file e ragione; impostare `maxViewThemeSelectors: 0` e il numero reale di collisioni classificate.

- [ ] **Step 7: Verificare architettura completa**

Run: `npm run audit:css:check && node --test test/css-architecture.test.mjs test/settings-ui.test.cjs test/ui-design-system.test.cjs`

Expected: PASS; nessun foglio legacy importato, nessuna palette nelle viste, nessun `!important` applicativo non documentato.

- [ ] **Step 8: Committare la rimozione legacy**

```bash
git add -A src test scripts/css-audit.config.mjs
git commit -m "refactor: completa il consolidamento CSS enterprise"
```

---

### Task 9: Baseline visive, regressione completa e trend bundle

**Files:**
- Create: `docs/qa/enterprise-css-visual-baseline.md`
- Create: `docs/qa/bundle-trend.md`
- Create: `docs/assets/screenshots/enterprise-css/light-home.png`
- Create: `docs/assets/screenshots/enterprise-css/light-terminal-ai.png`
- Create: `docs/assets/screenshots/enterprise-css/light-terminal-remote.png`
- Create: `docs/assets/screenshots/enterprise-css/light-editor.png`
- Create: `docs/assets/screenshots/enterprise-css/light-database.png`
- Create: `docs/assets/screenshots/enterprise-css/light-github.png`
- Create: `docs/assets/screenshots/enterprise-css/light-settings.png`
- Create: corrispondenti sette file `dark-*.png`.

**Interfaces:**
- Consumes: tutte le tranche implementate.
- Produces: evidenza visiva chiaro/scuro, verifica funzionale e trend bundle confrontabile.

- [ ] **Step 1: Eseguire la suite completa**

Run: `npm test`

Expected: tutti i test PASS, senza test saltati introdotti dalla migrazione.

- [ ] **Step 2: Verificare lint, build, audit e whitespace**

Run: `npm run lint && npm run audit:css:check && npm run build && git diff --check`

Expected: tutti i comandi terminano con codice 0.

- [ ] **Step 3: Registrare il trend bundle senza ottimizzare**

In `docs/qa/bundle-trend.md` registrare data, commit, file main JavaScript, raw, gzip, CSS raw e gzip. La prima riga conserva 454,20 kB come baseline dichiarata; la seconda conserva 463,98/142,48 e 181,17/28,04 come misura pre-migrazione; la terza usa l'output finale reale di Vite.

- [ ] **Step 4: Acquisire baseline chiara**

Impostare `Chiaro`, usare la stessa finestra ampia per tutte le viste e acquisire i sette screenshot elencati. Ripetere Home, Terminale e Database a viewport inferiore a 900 px e annotare l'esito nel documento anche se gli screenshot stretti non vengono committati.

- [ ] **Step 5: Acquisire baseline scura**

Impostare `Scuro`, ripetere gli stessi sette screenshot e le tre verifiche strette mantenendo dati e percorso workspace equivalenti.

- [ ] **Step 6: Compilare la matrice QA**

`docs/qa/enterprise-css-visual-baseline.md` contiene per ogni vista: chiaro/scuro, ampio/stretto, overflow, focus, loading, empty, errore, modal/menu e flusso funzionale verificato. Ogni cella usa `PASS`, `FAIL` o `N/A` con motivazione; nessuna cella resta vuota.

- [ ] **Step 7: Correggere e ripetere ogni verifica fallita**

Per ogni `FAIL`, aggiungere prima un test automatico quando il difetto e strutturale, applicare la correzione nel file proprietario, rieseguire test mirato, audit e vista correlata. Aggiornare la cella a `PASS` soltanto dopo la nuova evidenza.

- [ ] **Step 8: Eseguire l'audit di completamento**

Verificare uno per uno i criteri della spec: tutte le viste migrate, collisioni classificate, zero `!important` applicativi non documentati, zero tema nelle viste, file legacy rimossi, test/lint/build/audit verdi, baseline chiaro/scuro completa e nessun bug Critical/High noto.

- [ ] **Step 9: Committare le evidenze finali**

```bash
git add docs/qa docs/assets/screenshots/enterprise-css test src scripts package.json package-lock.json
git commit -m "test: certifica la baseline visiva enterprise"
```

---

## Ordine di esecuzione e checkpoint

1. Task 1-3: checkpoint Fondazioni e shell.
2. Task 4: checkpoint Terminale e AI.
3. Task 5: checkpoint Editor.
4. Task 6: checkpoint Database.
5. Task 7: checkpoint GitHub.
6. Task 8-9: checkpoint finale Home, Impostazioni, cleanup e QA.

Ogni checkpoint richiede worktree pulito, audit non peggiorato e build verde prima di iniziare il successivo.
