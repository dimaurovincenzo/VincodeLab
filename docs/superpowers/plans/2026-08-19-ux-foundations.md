# VincodeLab UX foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere chiari e sicuri i flussi Workspace, AI, Editor e Terminale senza cambiare il contratto dei workspace o dei PTY.

**Architecture:** Il renderer conserva lo stato delle aree già caricate ma rende inattiva una sola pagina alla volta tramite semantica e CSS. Il main process applica il confine di sicurezza sui file prima dell'IPC, così l'explorer non può esporre o aprire segreti locali. I componenti mantengono le responsabilità esistenti: `App` per shell/navigazione/Pi, `ProjectEditor` per file e `FreeTerminal` per la shell.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Vite 8, CodeMirror 6, xterm 6, Node.js CommonJS IPC.

**Spec:** `docs/superpowers/specs/2026-08-19-ux-foundations-design.md`

## Global Constraints

- Non introdurre dipendenze, migrazioni o cambiamenti di packaging.
- Non eseguire comandi o preset automaticamente dal terminale.
- Bloccare `.env`, `.env.*`, chiavi e certificati nell'IPC; consentire solo `.env.example`, `.env.sample` e `.env.template`.
- Conservare processi PTY e tab già caricati durante il cambio sezione.
- Tutte le label e gli stati utente sono in italiano e ogni controllo icon-only resta accessibile.
- Verificare typecheck, lint e i flussi reali in Electron prima di dichiarare completato il lavoro.

---

## File structure

- Modify: `electron/project-files.cjs` — policy centralizzata per file riservati in list/read/save.
- Modify: `src/App.tsx` — navigazione esclusiva, stati espliciti e home workspace.
- Modify: `src/App.css` — layout, feedback e focus della shell applicativa.
- Modify: `src/components/project-editor.tsx` — ricerca explorer, minimap e semantica editor.
- Modify: `src/editor.css` — densità explorer/editor e minimap responsivo.
- Modify: `src/components/free-terminal.tsx` — stati affidabili della shell e metadati workspace.
- Modify: `src/terminal.css` — superficie terminale coerente con Pi.

### Task 1: Proteggere l'explorer dai file riservati

**Files:**
- Modify: `electron/project-files.cjs:1-85`
- Test: verifica manuale IPC con workspace contenente `.env`, `.env.example` e una chiave PEM

**Interfaces:**
- Produces: `isEditorVisibleFile(fileName)` e `assertEditorAccessibleFile(filePath)` interni al main process.
- Consumes: `listDirectoryEntries`, `readProjectFile`, `saveProjectFile` esistenti.

- [ ] **Step 1: Aggiungere il test manuale ripetibile**

Run dal terminale libero del workspace di test:

```sh
mkdir -p /tmp/vincodelab-file-policy
printf 'TOKEN=secret\n' > /tmp/vincodelab-file-policy/.env
printf 'TOKEN=example\n' > /tmp/vincodelab-file-policy/.env.example
printf 'private\n' > /tmp/vincodelab-file-policy/id_rsa
```

Expected: l'explorer potrà mostrare solo `.env.example`; `.env` e `id_rsa` non compariranno.

- [ ] **Step 2: Implementare la policy nel main process**

```js
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SENSITIVE_FILE_NAMES = new Set(['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'])

function isEditorVisibleFile(fileName) {
  const lowerName = fileName.toLowerCase()
  if (SAFE_ENV_TEMPLATES.has(lowerName)) return true
  return !lowerName.startsWith('.env') && !SENSITIVE_FILE_NAMES.has(lowerName) && !/\.(pem|key|p12|pfx)$/i.test(fileName)
}
```

Apply `isEditorVisibleFile` while listing and reject `readProjectFile`/`saveProjectFile` when the basename is not visible.

- [ ] **Step 3: Verificare il confine IPC**

Run: `npm run build`

Expected: PASS. Nell'app, `.env` non è visibile; una chiamata IPC su `.env` riceve errore gestito, mentre `.env.example` si apre e salva.

### Task 2: Rendere esclusiva e leggibile la navigazione

**Files:**
- Modify: `src/App.tsx:38-460`
- Modify: `src/App.css:1-400`

**Interfaces:**
- Consumes: `appSection`, `loadedSections`, `selectAppSection` esistenti.
- Produces: pagine con `aria-hidden`, `inert` e classi di stato coerenti; nessun nuovo IPC.

- [ ] **Step 1: Verificare il difetto iniziale**

Aprire AI, poi Editor e Terminale. Con VoiceOver/accessibility tree verificare che una sola sezione esponga controlli interattivi alla volta.

Expected: FAIL nello stato iniziale: le sezioni lazy-loaded restano nel tree anche se non visibili.

- [ ] **Step 2: Implementare la pagina attiva**

```tsx
const isActive = appSection === 'editor'
<section
  aria-hidden={!isActive}
  className={`app-section-page ${isActive ? 'app-section-page-active' : ''}`}
  inert={!isActive ? '' : undefined}
>
```

Riutilizzare lo stesso schema per AI, Editor e Terminale; aggiungere `aria-current="page"` ai pulsanti della sezione attiva e una label descrittiva per ogni pagina.

- [ ] **Step 3: Migliorare home e feedback di apertura**

Mostrare conteggio recenti, messaggio quando la ricerca non trova risultati e stato `Apertura…` sulla card selezionata. Mantenere un'unica CTA primaria `Apri cartella`.

- [ ] **Step 4: Verificare**

Run: `npm run build && npm run lint`

Expected: PASS. Nell'app le sezioni inattive non ricevono focus, la navigazione indica chiaramente la pagina attiva e l'apertura ha feedback immediato.

### Task 3: Rendere l'editor denso ma leggibile

**Files:**
- Modify: `src/components/project-editor.tsx:150-350`
- Modify: `src/editor.css:1-40`

**Interfaces:**
- Produces: stato `explorerQuery` locale e minimap con comportamento responsive.
- Consumes: `tree`, `renderTree`, `openFile`, `saveActive` esistenti.

- [ ] **Step 1: Aggiungere la ricerca explorer e il risultato vuoto**

```tsx
const [explorerQuery, setExplorerQuery] = useState('')
const normalizedQuery = explorerQuery.trim().toLocaleLowerCase('it-IT')
```

Filtrare ricorsivamente l'albero conservando i genitori dei file corrispondenti; quando la query non trova risultati mostrare `Nessun file corrispondente.`.

- [ ] **Step 2: Ridurre l'impatto del minimap**

```tsx
showMinimap.compute(['doc'], () => ({
  create: () => ({ dom: Object.assign(document.createElement('div'), { className: 'editor-minimap' }) }),
  displayText: 'characters',
  showOverlay: 'always',
}))
```

Impostare in CSS `width: 64px`; nasconderlo con media query sotto `980px`. Aggiungere nel toolbar il suggerimento `⌘S salva · ⌘F cerca`.

- [ ] **Step 3: Verificare i flussi editor**

Aprire file normale, cercare per nome nell'explorer, aprire due tab, modificare il primo, salvare con `Cmd+S`, chiudere e scegliere annulla nella conferma.

Expected: nessuna perdita di testo; minimap non sottrae spazio e sparisce su finestra stretta.

### Task 4: Uniformare stati e superfici terminale

**Files:**
- Modify: `src/components/free-terminal.tsx:1-105`
- Modify: `src/terminal.css:1-70`
- Modify: `src/App.tsx:300-350`
- Modify: `src/App.css:300-520`

**Interfaces:**
- Consumes: `window.vincodeLab.shell.start`, `window.vincodeLab.terminal` e gli eventi PTY esistenti.
- Produces: stato visuale `Avvio`, `Pronto`, `Terminato`/`Errore`; nessuna modifica al protocollo PTY.

- [ ] **Step 1: Rendere visibile l'avvio della shell**

```tsx
<div className="terminal-stage" aria-live="polite">
  {starting && <><LoaderCircle className="animate-spin" aria-hidden="true" size={16} /><span>Avvio shell nel workspace…</span></>}
</div>
```

Sovrapporre il feedback alla superficie finché `shell.start()` non completa; in errore mostrare un messaggio persistente e non solo un toast.

- [ ] **Step 2: Allineare metadati e controlli**

Aggiungere al terminale libero il path del workspace e lo stesso status-dot semantico di Pi. Nel terminale Pi distinguere `Avvio Pi`, `Pi pronto`, `Sessione terminata` e `Errore Pi`.

- [ ] **Step 3: Verificare**

Aprire Terminale, osservare stato prima del prompt, eseguire `pwd`, passare ad AI e tornare al Terminale.

Expected: l'avvio è comprensibile, `pwd` risponde nel workspace aperto e la shell resta attiva dopo il cambio pagina.

### Task 5: Rifinire responsività, accessibilità e release check

**Files:**
- Modify: `src/App.css`, `src/editor.css`, `src/terminal.css` solo per focus, breakpoint e contrasto necessari.

**Interfaces:**
- Produces: focus visibile coerente e layout funzionale da 900px in su, limite già impostato da Electron.

- [ ] **Step 1: Applicare focus e breakpoint comuni**

```css
button:focus-visible,
input:focus-visible,
textarea:focus-visible {
  outline: 2px solid #0a84ff;
  outline-offset: 2px;
}
```

Ridurre sidebar e spaziature sotto `1100px` senza cambiare il `minWidth: 900` della finestra.

- [ ] **Step 2: Eseguire la validazione completa**

Run: `npm run build && npm run lint`

Expected: entrambi PASS.

- [ ] **Step 3: Collaudo Electron**

Run: `npm run dev`

Verificare: home vuota/ricerca/recente, apertura workspace, AI e tab interne, editor ed explorer, terminale shell, cambio sezione, finestra a 900px.

Expected: nessun errore in console, nessun controllo inattivo focalizzabile, nessun file segreto visibile, nessun PTY perso.

- [ ] **Step 4: Commit**

Il repository non ha ancora un commit iniziale. Non creare un commit parziale senza istruzione esplicita: consegnare le modifiche e riportare i file esatti modificati.
