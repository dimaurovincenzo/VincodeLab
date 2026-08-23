# GitHub Projects per workspace e identità applicativa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gestire Git e i soli GitHub Projects collegati al repository del workspace aperto, interamente da VincodeLab.

**Architecture:** `github-service.cjs` resta l'unico adapter per Git e `gh`: risolve il repository, interroga Projects collegati via GraphQL e invoca `gh project` con input validato. Il renderer riceve DTO tipizzati, rende board e grafo, e mostra una conferma propria prima di tutte le mutazioni. L'icona sorgente viene convertita in un asset `.icns` e usata dal packaging macOS.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Node test runner, Git CLI, GitHub CLI 2.82+, GitHub GraphQL API, macOS `sips` e `iconutil`.

**Spec:** `docs/superpowers/specs/2026-08-19-github-projects-and-icon-design.md`

## Global Constraints

- Il repository del workspace determina l'unico scope `owner/repo`; non mostrare Projects non collegati.
- Nessun token, comando raw o segreto raggiunge renderer, SQLite, log o commit.
- Tutte le mutazioni Git/GitHub richiedono preview e conferma esplicita nel renderer.
- Per `gh project`, segnalare scope `project` mancante senza avviare login o modificare credenziali.
- Non introdurre drag-and-drop di card nella prima versione.
- Non introdurre dipendenze runtime; usare Git e `gh` già installati.
- Verificare test, build, lint e flussi Electron prima di dichiarare completato il lavoro.

---

## File structure

- Create: `electron/github-projects.cjs` — query GraphQL, parsing DTO e comandi Projects validati.
- Modify: `electron/github-service.cjs` — adapter Git, grafo locale e delega Projects.
- Modify: `electron/main.cjs` — IPC granulari Git/Projects trusted-sender-only.
- Modify: `electron/preload.cjs` — superficie IPC minima per renderer.
- Modify: `src/vincode-lab.d.ts` — DTO Git graph, Project, field, item e API preload.
- Create: `src/components/github-project-board.tsx` — board read/write e conferme item.
- Create: `src/components/git-graph.tsx` — rendering SVG/CSS del grafo commit locale.
- Modify: `src/components/github-workspace.tsx` — orchestrazione tab Git, Issue e Projects.
- Modify: `src/github.css` — board, grafo, modal conferma e responsive.
- Create: `build/icon.iconset/*` e `build/icon.icns` — icona macOS multi-risoluzione derivata dall'asset utente.
- Modify: `package.json` — `build.mac.icon` e script ripetibile di generazione icona.
- Create: `test/github-projects.test.cjs`, `test/git-graph.test.cjs` — contratti adapter e parser.

### Task 1: Contratto sicuro per Projects collegati al repository

**Files:**
- Create: `electron/github-projects.cjs`
- Create: `test/github-projects.test.cjs`
- Modify: `electron/github-service.cjs`

**Interfaces:**
- Produces: `listLinkedProjects(workspacePath)`, `getProjectBoard(workspacePath, projectNumber)`, `assertProjectNumber(value)`.
- Consumes: `run(command, args, cwd)` e `getRepository(workspacePath)` esportati da `github-service.cjs`.

- [ ] **Step 1: Scrivere il test fallente per il filtro repository**

```js
const { parseLinkedProjects } = require('../electron/github-projects.cjs')

test('maps only Projects returned by repository.projectsV2', () => {
  const projects = parseLinkedProjects({
    data: { repository: { projectsV2: { nodes: [{ id: 'PVT_1', number: 7, title: 'Roadmap', closed: false, url: 'https://github.com/orgs/acme/projects/7', shortDescription: 'Scope' }] } } },
  })
  assert.deepEqual(projects, [{ id: 'PVT_1', number: 7, title: 'Roadmap', closed: false, url: 'https://github.com/orgs/acme/projects/7', shortDescription: 'Scope' }])
})
```

- [ ] **Step 2: Eseguire il test e verificare il RED**

Run: `node --test test/github-projects.test.cjs`

Expected: FAIL perché `github-projects.cjs` e `parseLinkedProjects` non esistono.

- [ ] **Step 3: Implementare query e mapping minimi**

```js
const query = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 100) { nodes { id number title shortDescription closed url } }
  }
}`
const raw = await run('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`], workspacePath)
```

Validare sempre `projectNumber` come intero positivo prima di `field-list` o `item-list`; restituire DTO senza stdout o argomenti shell.

- [ ] **Step 4: Caricare fields e item del Project selezionato**

```js
await run('gh', ['project', 'field-list', String(projectNumber), '--owner', owner, '--limit', '100', '--format', 'json'], workspacePath)
await run('gh', ['project', 'item-list', String(projectNumber), '--owner', owner, '--limit', '500', '--format', 'json'], workspacePath)
```

Normalizzare gli output nei DTO `GitHubProjectField` e `GitHubProjectItem`; indicare `truncated` se il limite viene raggiunto.

- [ ] **Step 5: Eseguire il test GREEN**

Run: `node --test test/github-projects.test.cjs`

Expected: PASS, incluso mapping di Project vuoto e rifiuto di numero `0` o testo.

### Task 2: Mutazioni Projects con argomenti validati

**Files:**
- Modify: `electron/github-projects.cjs`
- Modify: `test/github-projects.test.cjs`

**Interfaces:**
- Produces: `createAndLinkProject`, `editProjectItem`, `archiveProjectItem`, `addProjectItem`, `createDraftItem`, `editProject`.
- Consumes: `getRepository`, `getProjectBoard`, `assertProjectNumber` dal Task 1.

- [ ] **Step 1: Scrivere i test fallenti di allowlist**

```js
test('builds one item-edit invocation for a single-select option', () => {
  assert.deepEqual(buildItemEditArgs({ projectId: 'PVT_1', itemId: 'PVTI_1', fieldId: 'PVTSSF_1', value: { kind: 'singleSelect', optionId: 'abc' } }), [
    'project', 'item-edit', '--project-id', 'PVT_1', '--id', 'PVTI_1', '--field-id', 'PVTSSF_1', '--single-select-option-id', 'abc',
  ])
})

test('rejects an unsupported field value kind', () => {
  assert.throws(() => buildItemEditArgs({ value: { kind: 'shell', value: 'rm -rf' } }), /Campo Project non valido/)
})
```

- [ ] **Step 2: Eseguire il RED**

Run: `node --test test/github-projects.test.cjs`

Expected: FAIL perché `buildItemEditArgs` non esiste.

- [ ] **Step 3: Implementare mutazioni con DTO chiusi**

Accettare soltanto `singleSelect`, `text`, `number`, `date`, `iteration` e `clear`; costruire argomenti `gh project item-edit` dalla allowlist. Creare un Project con `gh project create`, poi collegarlo immediatamente con `gh project link --repo <repository.name>`; in errore di link mostrare lo stato creato e non eseguire rollback impliciti.

- [ ] **Step 4: Implementare le azioni item**

Usare `gh project item-add --url`, `item-create --title --body`, `item-archive [--undo]` ed `item-edit`; dopo ciascuna mutazione ricaricare la sola board selezionata.

- [ ] **Step 5: Eseguire il GREEN**

Run: `node --test test/github-projects.test.cjs`

Expected: PASS. Nessun input produce un argomento shell libero.

### Task 3: Grafo Git e comandi locali confermabili

**Files:**
- Modify: `electron/github-service.cjs`
- Create: `test/git-graph.test.cjs`

**Interfaces:**
- Produces: `parseGraphHistory(output)` e proprietà `graph` in `GitStatus`.
- Consumes: `getGitStatus`, `commit`, `push`, `revertCommit` esistenti.

- [ ] **Step 1: Scrivere il test RED per il parser**

```js
const raw = '*|abc1234|feat: board|Ada|2026-08-19T10:00:00Z\n| *|def5678|fix: parser|Ben|2026-08-18T10:00:00Z'
assert.deepEqual(parseGraphHistory(raw)[0], { graph: '*', sha: 'abc1234', subject: 'feat: board', author: 'Ada', date: '2026-08-19T10:00:00Z' })
```

- [ ] **Step 2: Eseguire il RED**

Run: `node --test test/git-graph.test.cjs`

Expected: FAIL perché `parseGraphHistory` non esiste.

- [ ] **Step 3: Caricare e normalizzare il grafo**

```js
await run('git', ['log', '--all', '--decorate=short', '--date=iso-strict', '--pretty=format:%x1e%h%x1f%s%x1f%an%x1f%aI%x1f%D', '--graph', '-60'], workspacePath)
```

Separare i prefissi grafici dalle colonne record e limitare a 60 commit; repository senza HEAD restituisce `graph: []`.

- [ ] **Step 4: Aggiungere command preview DTO**

Esportare `getGitOperationPreview(kind, input, status)` per `commit`, `push`, `pullRebase`, `switchBranch`, `createBranch`, `revert`; la preview contiene solo label, target e impatto stimato, mai una command line. Le azioni effettive restano funzioni separate con input validato.

- [ ] **Step 5: Eseguire il GREEN**

Run: `node --test test/git-graph.test.cjs`

Expected: PASS per grafo lineare, merge/decorazioni e repository senza commit.

### Task 4: Esporre IPC minimi e DTO tipizzati

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vincode-lab.d.ts`

**Interfaces:**
- Produces: `window.vincodeLab.github.projects.list()`, `.board(number)`, `.preview(kind,input)`, `.execute(kind,input)`.
- Consumes: adapter Tasks 1-3 e `assertTrustedSender`/`requireActiveWorkspace` esistenti.

- [ ] **Step 1: Definire DTO TypeScript**

```ts
interface GitHubProjectBoard { project: GitHubProject; fields: GitHubProjectField[]; items: GitHubProjectItem[]; truncated: boolean }
interface GitHubMutationPreview { title: string; detail: string; destructive: boolean }
type GitHubMutation = { kind: 'addItem' | 'createDraft' | 'editItem' | 'archiveItem' | 'editProject' | 'createProject' | 'closeProject' }
```

- [ ] **Step 2: Implementare handler main process**

Ogni handler chiama `assertTrustedSender`, usa `requireActiveWorkspace` e delega una sola azione tipizzata. La preview è read-only; `execute` non accetta un command o un URL arbitrario.

- [ ] **Step 3: Esporre API preload**

```js
projects: {
  list: () => ipcRenderer.invoke('github:projects:list'),
  board: (number) => ipcRenderer.invoke('github:projects:board', number),
  preview: (mutation) => ipcRenderer.invoke('github:projects:preview', mutation),
  execute: (mutation) => ipcRenderer.invoke('github:projects:execute', mutation),
}
```

- [ ] **Step 4: Verificare compilazione**

Run: `npm run build`

Expected: PASS senza `any` impliciti e senza API Node nel renderer.

### Task 5: Board, grafo e conferme nel renderer

**Files:**
- Create: `src/components/github-project-board.tsx`
- Create: `src/components/git-graph.tsx`
- Modify: `src/components/github-workspace.tsx`
- Modify: `src/github.css`

**Interfaces:**
- Consumes: API preload/DTO Task 4.
- Produces: board per Project, dialog conferma riusabile e grafo commit leggibile.

- [ ] **Step 1: Implementare `GitGraph` read-only**

Renderizzare ogni record con corsia testuale/SVG, SHA, subject, autore, data e decorazioni. Un commit non attiva azioni finché l'utente non seleziona `Ripristina`, che apre la preview esistente.

- [ ] **Step 2: Implementare selezione Project e board**

Caricare l'elenco linked al cambio tab, poi la board al click. Costruire le colonne solo dal campo `Status`; senza tale campo, rendere lista. Indicare `truncated` e mantenere ricerca locale sulle card.

- [ ] **Step 3: Implementare conferma mutazione**

Il click su una mutazione richiama `.preview`, mostra titolo/dettaglio/target e abilita `Conferma` solo nel dialog. `Annulla`, Esc o chiusura non chiamano `.execute`.

- [ ] **Step 4: Collegare Git mutativo alla stessa conferma**

Commit, push e revert usano il medesimo dialog. Push mostra branch, upstream e numero `ahead`; commit mostra messaggio e numero file staged.

- [ ] **Step 5: Collaudo Electron**

Aprire workspace GitHub, controllare Git, tab Projects senza scope, Project vuoto e Project con Status. Confermare che annullare una preview non produce chiamate `gh project` o `git` mutative.

### Task 6: Integrare l'icona macOS

**Files:**
- Create: `build/icon.png`, `build/icon.iconset/*.png`, `build/icon.icns`
- Modify: `package.json`
- Modify: `src/App.tsx` e CSS pertinente per il logo header.

**Interfaces:**
- Produces: `npm run build:icon` e `build.mac.icon: "build/icon.icns"`.

- [ ] **Step 1: Copiare l'asset utente nel repository**

Usare come sorgente `/var/folders/x1/9307cf0j1bnf50bzk67x744c0000gn/T/codex-clipboard-26b0b53a-8cb0-4a52-bcd9-61dc059bb865.png` e salvarlo come `build/icon.png`.

- [ ] **Step 2: Generare l'iconset macOS**

```sh
mkdir -p build/icon.iconset
sips -z 16 16 build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32 build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 1024 1024 build/icon.png --out build/icon.iconset/icon_512x512@2x.png
iconutil -c icns build/icon.iconset -o build/icon.icns
```

Completare le dimensioni intermedie 32, 64, 128, 256 e 512; lo script `build:icon` rigenera l'asset senza dipendenze.

- [ ] **Step 3: Configurare packaging e header**

Impostare `build.mac.icon` su `build/icon.icns`; usare `build/icon.png` nell'header tramite tag `<img>` con `alt="VincodeLab"` e dimensione CSS fissa.

- [ ] **Step 4: Verificare asset e build**

Run: `npm run build:icon && file build/icon.icns && npm run build`

Expected: `Apple Icon Image` e build Vite/TypeScript PASS.

### Task 7: Validazione finale

**Files:**
- Modify: `package.json` solo se necessario a includere test/asset nella build.

- [ ] **Step 1: Eseguire la suite completa**

Run: `npm test && npm run build && npm run lint && git diff --check`

Expected: test passanti, build passante, lint senza nuovi errori e diff senza spazi invalidi.

- [ ] **Step 2: Verificare credenziali senza esporle**

Run: `gh auth status`

Expected: mostra solo account/host/scope; non copiare token o dettagli sensibili nel log applicativo o nella risposta.

- [ ] **Step 3: Collaudare il pacchetto macOS**

Run: `npm run package`

Expected: bundle macOS creato con icona VincodeLab; se signing/notarizzazione non sono configurati, riportare il punto esatto senza aggirare controlli macOS.

- [ ] **Step 4: Commit**

Il repository continua a non avere un commit iniziale. Non creare un commit parziale o un push senza istruzione esplicita; consegnare la lista esatta dei file modificati.
