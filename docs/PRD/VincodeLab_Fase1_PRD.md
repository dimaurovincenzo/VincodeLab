# VincodeLab — PRD Fase 1: Shell Electron con terminale Pi embedded

**Versione:** 1.1
**Stato:** Approvato per sviluppo
**Ambito:** shell macOS, selezione esplicita del workspace e sessione interattiva di `pi-coding-agent` visualizzata nell'app. Editor, file tree, database, SSH e pannelli custom sono fuori scope. La sezione GitHub è limitata a Git locale, issue e lettura dei GitHub Projects.

## 1. Obiettivo

VincodeLab è una finestra desktop macOS che, a ogni avvio, mostra una pagina con le directory aperte di recente e l'azione per scegliere una nuova cartella. Quando l'utente seleziona una directory, l'app avvia al suo interno una sessione interattiva di Pi. L'app non reimplementa l'agente né la TUI: visualizza Pi nel proprio terminale embedded.

Il risultato della Fase 1 è un percorso unico:

1. lancio VincodeLab e visualizzazione dei workspace recenti;
2. scelta esplicita di una directory recente o tramite dialog macOS;
3. avvio di `pi` con la cartella scelta come `cwd`;
4. uso della TUI Pi completa dentro VincodeLab.

L'ultimo workspace **non** viene riaperto automaticamente: la selezione resta sempre esplicita.

## 2. Architettura

```text
┌──────────────────────────────────────────────────────┐
│ Electron Main Process                                 │
│ - BrowserWindow e menu macOS                          │
│ - dialog di selezione workspace                       │
│ - PTY separati: `pi` e shell libera tramite node-pty  │
│ - lifecycle processi, resize e logging                │
├──────────────────────────────────────────────────────┤
│ Preload (contextBridge)                               │
│ - open workspace                                      │
│ - input/output/resize/exit del terminale              │
│ - API tipizzata e strettamente limitata               │
├──────────────────────────────────────────────────────┤
│ Renderer React                                        │
│ - Ark UI + Park UI + Panda CSS, identità Graphite     │
│ - xterm.js: rendering del PTY                          │
│ - nessun accesso Node o filesystem diretto            │
├──────────────────────────────────────────────────────┤
│ pi-coding-agent                                       │
│ - TUI, provider, modello, login, sessioni e tool      │
│ - read/write/edit/bash nel cwd selezionato            │
└──────────────────────────────────────────────────────┘
```

`xterm.js` è un emulatore terminale embedded, non Terminal.app. `node-pty` è necessario per rendere Pi una sessione interattiva; `child_process` senza PTY non è sufficiente.

## 3. Responsabilità

### VincodeLab

- mostra i workspace recenti e permette di aprire una nuova cartella;
- crea il PTY Pi con `cwd` uguale alla cartella scelta e, su richiesta, un PTY shell libero nello stesso workspace;
- inoltra input, output, resize e chiusura separatamente per Pi e shell;
- espone il comando **File → Apri cartella…** (`Cmd+O`) per sostituire la sessione corrente;
- mantiene in SQLite locale i workspace recenti (massimo 50) e, in futuro, preferenze applicative non sensibili. Il database non contiene credenziali Pi.

### Pi

- gestisce `/login`, `/logout`, `/model`, provider e OAuth/API key;
- conserva credenziali e sessioni con i propri meccanismi nativi;
- esegue i tool built-in `read`, `write`, `edit` e `bash`;
- mostra output, errori, retry e controlli di annullamento nella sua TUI.

VincodeLab non legge, persiste, cifra, passa via IPC o registra credenziali Pi.

## 4. UI e design macOS

- **Stack:** React, Ark UI, Park UI, Panda CSS, Lucide, xterm.js e CodeMirror.
- **Chrome:** `titleBarStyle: hiddenInset`, vibrancy macOS, traffic light di sistema, menu nativo e toolbar draggable integrata nella titlebar. Electron non espone una `NSToolbar` completa: i controlli app usano le primitive accessibili Ark/Park nella chrome, senza simulare i traffic light.
- **Tipografia:** `-apple-system` / SF Pro per chrome e controlli; SF Mono/Menlo nel terminale.
- **Tema:** identità “Graphite tecnico”, superfici neutre, accento elettrico, bordi sottili, controlli compatti, focus evidente e spaziature da developer tool. Panda CSS governa token semantici e temi `system`, `light` e `dark`; Ark UI fornisce comportamento e accessibilità, Park UI le recipe condivise.
- **Stato iniziale:** pagina “Apri un workspace” con lista delle directory recenti (nome, path, ultimo accesso) e azioni per riaprirne una o aprirne una nuova.
- **Stato attivo:** navigazione principale **AI** / **Editor** / **Terminale** / **GitHub**. AI contiene Terminale AI, Skill progetto e Istruzioni progetto; Editor offre explorer, icone file/cartella tipizzate, ricerca/sostituzione e minimappa CodeMirror; Terminale avvia la shell login dell'utente (`$SHELL`, fallback `/bin/zsh`) nel workspace. GitHub consente stage, commit, push e revert non distruttivo; crea, modifica, chiude e riapre issue; mostra in sola lettura i Projects dell'owner del repository.
- **Terminale AI:** metadata del percorso e superficie Pi. I controlli includono ricerca (`Cmd+F`), copia della selezione, pulizia visuale, zoom tipografico (`Cmd+−`/`Cmd++`) e ricarica Pi (`/reload`). L'output è batchato per frame e limitato a 1 MiB pendente.
- **Feedback:** toast Ark/Park in-app con ruoli Graphite condivisi; notifiche native macOS solo per terminazioni anomale di Pi quando VincodeLab non è in primo piano.

## 5. Sicurezza

- `contextIsolation: true`, `nodeIntegration: false`, renderer sandboxato.
- Il preload espone solo `workspace.open`, `workspace.listRecent`, `workspace.openRecent`, `terminal.write`, `terminal.resize`, `terminal.onData` e `terminal.onExit`.
- Ogni messaggio IPC verifica che provenga dalla `BrowserWindow` prevista; popup e navigazioni esterne sono bloccati.
- Il renderer non può scegliere arbitrariamente il `cwd`: il path è selezionato e validato nel main process tramite dialog di sistema. Le azioni GitHub passano solo tramite IPC validato; `git` e `gh` sono eseguiti dal main process. L'autenticazione resta quella locale di GitHub CLI (`gh auth login`) e nessun token viene letto o memorizzato dall'app.
- Input terminale limitato a 64 KiB per messaggio; dimensioni PTY validate e limitate.
- Pi opera con i permessi dell'utente macOS. L'esecuzione di comandi arbitrari è una scelta esplicita dell'MVP.

## 6. Errori e lifecycle

- L'app cerca Pi nel `PATH`, nelle installazioni comuni (`~/.local/bin`, Homebrew, npm globale) e nelle versioni NVM dell'utente. Se non lo trova, mostra un errore esplicito e un toast; `VINCODELAB_PI_PATH` consente di indicare un percorso specifico.
- Se Pi termina con codice `0`, il renderer comunica la chiusura normale della sessione; per codici o segnali diversi mostra il dettaglio tecnico via toast e, se l'app è in background, tramite notifica macOS. Non viene riavviato silenziosamente.
- La chiusura della finestra o dell'app termina il PTY, per evitare processi Pi orfani senza una UI che li controlli.
- Il crash del renderer non deve compromettere il processo Pi; il ripristino completo della TUI dopo crash renderer non è un requisito della prima iterazione.
- Il menu macOS mantiene le scorciatoie standard e `Cmd+O` per selezionare un nuovo workspace.
- Log JSON a rotazione (massimo 2 MiB) in `~/Library/Logs/VincodeLab/` registrano lifecycle, errori PTY e SQLite, senza contenuto del terminale, path dei workspace o credenziali.

## 7. Skill progetto

La sezione **AI** contiene tre tab: **Terminale AI**, che ospita la TUI Pi, **Skill progetto** e **Istruzioni progetto**.

- Le skill gestite dalla UI risiedono esclusivamente nelle radici Pi del workspace: `<workspace>/.pi/skills/<nome>/SKILL.md` oppure `<workspace>/.pi/skills/<nome>.md`.
- La UI elenca, crea, modifica, valida ed elimina skill project-local; non gestisce skill globali, package npm/git o impostazioni Pi globali.
- La validazione applica i requisiti Pi per `name` e `description`; avverte quando nome e directory differiscono, perché è compatibile con Pi ma non con tutti gli harness.
- Dopo una modifica, **Ricarica Pi** invia `/reload` alla TUI. Pi carica risorse project-local solo dopo `/trust`.
- La tab **Istruzioni progetto** gestisce `<workspace>/.pi/APPEND_SYSTEM.md`, che aggiunge istruzioni al prompt generale Pi solo per il workspace; può essere salvato, rimosso e ricaricato esplicitamente.
- L'**Editor** usa CodeMirror 6, apre e salva file testuali esistenti fino a 1 MiB tramite IPC confinato al workspace attivo. L'explorer carica lazy ogni cartella (massimo 1.000 elementi per directory), così directory grandi non nascondono il codice. La ricerca/sostituzione è accessibile con `Cmd+F` e la minimappa è sincronizzata con lo scroll. Esclude symlink, file binari, `.git`, `node_modules` e artefatti di build; le scritture sono atomiche.
- L'app segue automaticamente `prefers-color-scheme` macOS; asset pesanti dell'Editor (CodeMirror, linguaggi, ricerca e minimappa) restano in chunk lazy separati.
- Dopo la prima visita, le sezioni AI, Editor e Terminale restano montate ma nascoste: il cambio tab non interrompe PTY, job shell, stato CodeMirror o modifiche non ancora salvate. Un cambio workspace sostituisce invece intenzionalmente tali risorse.
- Le operazioni filesystem restano nel main process; il renderer riceve un bridge IPC limitato.

## 8. Packaging

- `electron-builder` genera il bundle `.app` macOS.
- `node-pty` e SQLite sono moduli nativi e devono essere ricompilati per la versione Electron distribuita.
- xterm e il suo addon di resize sono caricati dinamicamente solo quando l'utente apre un workspace, per ridurre il bundle iniziale della pagina Recenti. L'output PTY viene accodato e renderizzato al massimo una volta per frame, con buffer di bootstrap limitato a 1 MiB.
- Firma e notarizzazione sono fuori scope per uso personale su una singola macchina.

## 9. Criteri di accettazione

1. L'app si avvia mostrando i workspace recenti, senza riaprire automaticamente un workspace.
2. L'utente può aprire una directory recente o scegliere una nuova cartella; la scelta è il `cwd` della sessione Pi e aggiorna il relativo ultimo accesso in SQLite.
3. La TUI Pi riceve input, streaming output, resize e `Ctrl+C` tramite il terminale embedded; il terminale supporta ricerca, copia selezione e zoom senza alterare il processo Pi.
4. `/login` e `/model` funzionano nella TUI Pi senza che VincodeLab gestisca segreti.
5. `Cmd+O` sostituisce in modo controllato la sessione Pi corrente con una nuova nella cartella selezionata.
6. Il renderer non dispone di API Node, filesystem o process spawning.
7. La tab Skill progetto crea, modifica, valida, elimina e ricarica in Pi solo le skill sotto `.pi/skills` del workspace attivo, incluse le skill Markdown dirette previste da Pi.
8. La tab Istruzioni progetto salva, rimuove e ricarica `.pi/APPEND_SYSTEM.md` senza modificare il prompt generale Pi; il terminale libero usa una shell PTY separata nello stesso workspace.
9. L'Editor apre e salva file testuali esistenti nel workspace, segnala modifiche non salvate e blocca traversal, symlink, file binari e file oltre 1 MiB.
10. Build frontend, lint e avvio Electron riescono; il bundle macOS include il modulo PTY nativo.

## 10. Non-obiettivi

- Pi-UI, `ChatPanel`, SDK `AgentSession` e IPC semantico dell'agente.
- onboarding credenziali/provider implementato da VincodeLab.
- Monaco, database UI, configurazione/gestione dei GitHub Projects, SSH, terminali remoti/multipli, auto-update.
- riapertura automatica dell'ultimo workspace.
