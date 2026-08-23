# Architecture hardening — baseline e audit tecnico

Data iniziale: 22 agosto 2026

Baseline sorgente: `5d3f31de2a17589ff0d479ce9e1b6a1f073188ad`

Branch/worktree: `codex/ux-operational-workflow`

Stato visuale: Graphite su Ark UI, Park-style e Panda CSS congelato. Questo ciclo non autorizza un redesign.

## Metodo e grado dell'evidenza

L'audit combina lettura dei confini Electron/React, test di concorrenza con fixture controllate, stress accelerato, benchmark sintetici e misure locali raccolte durante l'intervento. Il candidato personale non firmato in `release` è stato costruito e sottoposto a smoke isolato sul bundle reale: apertura di una finestra sul workspace temporaneo, renderer/GPU/network attivi, caricamento dei moduli ARM64 `node-pty` e `better-sqlite3`, uscita applicativa e assenza di processi orfani. I flussi operativi manuali più ampi restano evidenze narrative e non un harness Electron versionato. Le priorità seguono il rischio osservato, non la dimensione del file o una preferenza architetturale.

Per decisione esplicita del committente non viene eseguito un soak reale di 8–12 ore. I cicli bounded descritti sotto sono stress accelerato e non vengono presentati come equivalenti a una giornata d'uso.

- **D — dimostrato**: riproduzione, misura o artefatto osservabile.
- **C — confermato dal codice**: percorso deterministico presente, ma non ancora esercitato end-to-end su un servizio reale.
- **H — ipotesi da misurare**: impatto plausibile; non autorizza ancora un refactoring.

Nessun test remoto ha usato credenziali, host, repository o database dell'utente. Gli UAT reali GitHub autenticato, SFTP e driver Database remoti non sono stati eseguiti e richiedono account, host e database fixture dedicati.

## Baseline misurata prima delle ottimizzazioni

Le misure runtime rappresentano un singolo run locale ARM64 e servono come punto iniziale. La certificazione finale deve ripeterle su almeno dieci run cold/warm e riportare mediana e p95.

| Metrica | Baseline | Evidenza/nota |
|---|---:|---|
| Processo → origine navigazione renderer | ~263 ms | App confezionata, profilo isolato |
| Origine navigazione → `load` | ~87 ms | `DOMContentLoaded` e `load` quasi coincidenti |
| Processo → documento caricato | ~350 ms | Non equivale ancora a un p95 di interattività |
| Heap renderer iniziale | 28,3 MiB | GC richiesto via CDP |
| Heap dopo 100 cicli fra 6 viste | 28,9 MiB | Stabilizzato dopo il lazy mount iniziale |
| DOM/listener dopo 100 cicli | 5.469 / 1.444 | Valori stabili fra ciclo 50 e 100 |
| Heap dopo 8 terminali e chiusura di 7 | 29,4 MiB | Shell chiuse e listener tornati al livello operativo |
| Processi iniziali | 5 | main, GPU, network, renderer, Pi |
| Processi con 8 terminali | 13 | Otto shell aggiuntive, tutte terminate alla chiusura |
| CPU idle osservata | main/Pi/shell ~0%; GPU ~2%; renderer ~5% | Da ripetere con campionamento statistico |
| Chunk renderer principale | 922,16 kB raw / 268,69 kB gzip | Build Vite dell'intervento operativo |
| Bundle renderer complessivo | ~2,98 MB raw / ~885 kB gzip | 19 asset specialistici già separati |
| Test iniziali del worktree | Baseline registrata prima dell'hardening | I conteggi sono volutamente omessi perché la suite è cresciuta durante l'intervento |
| Terminal stream 1 MiB | 34,25 ms | Byte esatti; coda massima 65.536 byte |
| Terminal stream 10 MiB | 256,21 ms | Byte esatti |
| Terminal stream 100 MiB | 2,304 s | Byte esatti; benchmark controller, non xterm end-to-end |
| Indice workspace 10.000 file | ~1,20 s | Baseline singola; manca directory piatta da 100.000 entry |
| App confezionata precedente | 721 MiB | Conteneva una seconda app Electron annidata |
| `app.asar` precedente | ~417–431 MiB | `dist/mac-arm64/Electron.app` incluso ricorsivamente |
| DMG/ZIP precedenti | ~264 MiB ciascuno | Packaging e renderer condividevano `dist` |

Lo smoke della baseline aveva verificato che, dopo `Cmd+Q`, Pi, shell, renderer e helper locali non rimanevano orfani. Sul pacchetto corrente lo shutdown applicativo ha terminato main, renderer, GPU e network senza residui; il test ha inoltre caricato `node-pty`, ma non sostituisce un collaudo reale di ControlMaster SSH o di più PTY interattivi.

## Aspetti già solidi da preservare

- `contextIsolation`, sandbox renderer e `nodeIntegration: false` sono attivi; nuove finestre sono negate e la CSP è presente.
- Le chiamate esposte dal preload sono coperte da un contratto che richiede il relativo handler nel main; non risultano canali mancanti o duplicati nelle verifiche eseguite.
- La sessione workspace usa allowlist, limiti dimensionali, versione e fallback per dati corrotti.
- Lo stream AI principale applica sequenze, ACK/backpressure, snapshot e cancellazione.
- L'indice file usa scansione asincrona, yield, cache confinata e cancellazione.
- Cambio vista e ciclo di terminali non hanno mostrato una crescita continua di heap, DOM, listener o processi.
- Il code splitting specialistico di CodeMirror, xterm, linguaggi, Editor, GitHub e Database esiste già; il warning del chunk principale non prova da solo un problema di startup.

## Matrice finale P0 — correttezza, corruzione o perdita dati

Stati usati: **chiuso su prova automatizzata** indica implementazione e regressione verificabile; **chiuso sul candidato locale** include anche l'artefatto o lo smoke osservabile; **parziale** indica che una parte misurabile resta aperta.

| ID | Stato finale | Prova reale disponibile | Residuo dichiarato |
|---|---|---|---|
| P0-UPD-01 | Chiuso su prova automatizzata | Claim CAS, lock/journal cross-process, recovery e rollback in `test/update-store.test.cjs` e `test/update-lifecycle.test.cjs`; gate integrato finale verde | Nessuna attivazione su pacchetto utente reale |
| P0-DB-01 | Chiuso su SQLite sintetico | Worker dedicato, timeout/abort e budget byte/cella in `test/database-service.test.cjs` | UAT PostgreSQL/MySQL/SQL Server reale non eseguito |
| P0-REM-01 | Chiuso su fixture | Temporanei locali/remoti, flush, rename e cleanup verificati in `test/remote-file-service.test.cjs` e `test/remote-file-store.test.cjs` | UAT SFTP reale non eseguito |
| P0-CM-01 | Chiuso su componente | Formatter differito e documento modificato concorrente in `test/components/database-workspace-format.test.tsx` | Nessun residuo funzionale noto nel contratto esercitato |

## Matrice finale P1 — lifecycle, concorrenza e sicurezza operativa

| ID | Stato finale | Prova reale disponibile | Residuo dichiarato |
|---|---|---|---|
| P1-TERM-01 | Chiuso su prova automatizzata | Indice paste riservato, duplicato rifiutato e generazione/abort in `test/terminal-input.test.cjs` | Collaudo Electron di paste molto grande da ripetere sul pacchetto |
| P1-SFTP-01 | Chiuso su fixture | Slot conservato fino a `close`, SIGTERM→SIGKILL e cleanup in `test/sftp-service.test.cjs` | UAT SFTP reale non eseguito |
| P1-SSH-01 | Chiuso su fixture | Deadline, abort e stato monotono in `test/managed-ssh-service.test.cjs` | ControlMaster SSH reale non collaudato |
| P1-DB-02 | Chiuso su driver fake | Registry single-flight, invalidazione apertura e cleanup bounded in `test/database-service.test.cjs` | UAT con driver Database remoti non eseguito |
| P1-PTY-01 | Chiuso su prova automatizzata e smoke | `safeKillPty` idempotente in `test/electron-security.test.cjs`; lifecycle multi-shell coperto dal manager; shutdown del pacchetto senza processi orfani | Nessun UAT prolungato con terminali multipli nel pacchetto |
| P1-SEC-01 | Chiuso su fixture `safeStorage` | Segreto separato, migrazione legacy e DTO `hasPassword` in `test/database-store.test.cjs` | Verifica Keychain nel pacchetto personale da completare |
| P1-PREF-01 | Chiuso su componente | Store per scope/workspace e scarto delle risposte obsolete in `test/components/app-preferences-store.test.tsx` | Nessun UAT multi-finestra prolungato |
| P1-SHELL-01 | Chiuso su prova automatizzata e smoke nativo | Snapshot, watermark, `attachmentId`, ready/ACK e reconnect in `test/shell-session-manager.test.cjs`; `pty.node` ARM64 caricato dal bundle reale | Interazione xterm prolungata nel pacchetto non ripetuta |
| P1-XTERM-01 | Chiuso su contratto renderer | Una costruzione xterm per sessione e aggiornamento opzioni in-place verificati dai test terminale/design system | Cambio preferenze nel pacchetto corrente da ricontrollare manualmente |
| P1-EDIT-01 | Chiuso su componente | Single-flight e intento di attivazione più recente in `test/components/project-editor-state-tree.test.tsx` | Nessun residuo noto nel contratto esercitato |
| P1-EDIT-02 | Chiuso su componente | Timer autosave per file conservato al cambio tab nello stesso test | I/O reale lento non simulato nel pacchetto |
| P1-GH-01 | Chiuso su componente/fixture | Richieste Git, diff, board e campi obsoleti ignorati; polling sospeso quando invisibile in `test/components/github-workspace-races.test.tsx` | UAT GitHub autenticato reale non eseguito |
| P1-SKILL-01 | Chiuso su componente | Save tardivo e discard concorrente in `test/components/project-resources-workspace-guard.test.tsx` | Nessuna mutazione di skill utente reale |
| P1-SET-01 | Chiuso su componente | Draft locale, commit blur/Invio e generazione per chiave in `test/components/settings-number-preference.test.tsx` | Nessun residuo noto nel contratto esercitato |
| P1-PI-01 | Chiuso su contratto renderer | Chiusura su hide/unmount e start obsoleto in `test/settings-ui.test.cjs` e componente Settings | Processo Pi Config reale nel pacchetto corrente da ricontrollare |

## Matrice finale P2 — performance e consumo risorse

| ID | Stato finale | Prova reale disponibile | Residuo dichiarato |
|---|---|---|---|
| P2-PKG-01 | Chiuso sul candidato locale | DMG 147.641.259 byte, ZIP 145.236.783 byte e app ARM64 prodotti in `release`; `app.asar` 48.564.201 byte ispezionato senza `release`/app annidata; DMG e ZIP integri; smoke reale verde | Pacchetto intenzionalmente non firmato e non notarizzato; nessuna distribuzione pubblica certificata |
| P2-REM-01 | Parziale | Cache entry LRU bounded nel main, transfer di servizio rimossi in `finally`, cleanup workspace e conteggi risorse nei test Remote | La cronologia transfer del renderer non ha ancora pruning bounded; stress su servizio SFTP reale non eseguito |
| P2-FS-01 | Parziale | Traversal `opendir` asincrono, indice cancellabile/cache-aware e heartbeat su file grandi in `test/project-files.test.cjs` e `test/project-file-index.test.cjs` | Directory piatta da 100.000 entry e campagna heartbeat multipla non eseguite |
| P2-TERM-01 | Chiuso su stress sintetico | Protocollo one-in-flight e stress 100 MiB con hash/byte esatti, pause/resume e code residue a zero in `test/shell-session-manager.test.cjs`; ACK xterm nel callback in `test/components/shell-xterm-output-controller.test.tsx` | PTY→Electron→xterm reale da ripetere sul pacchetto |
| P2-DB-01 | Parziale | Budget 4 MiB risposta, 1 MiB cella, paginazione e BLOB rejection in `test/database-service.test.cjs` | Virtualizzazione/profiler su dataset realistico non completati; UAT remoto assente |
| P2-GIT-01 | Parziale | Parser streaming, budget DTO, `truncated/hasMore` e batching path in `test/github-service.test.cjs` e `test/github-projects.test.cjs` | La paginazione cursor completa di ProjectsV2 non è implementata; UAT GitHub autenticato reale non eseguito |
| P2-START-01 | Parziale | Finestra creata prima della riconciliazione update, indice asincrono e misuratore eager/lazy in `test/renderer-startup.test.cjs`; build finale eager 999.600 byte raw / 277.599 gzip, con entry JS 872.766 / 254.768 (−5,36% / −5,18% dalla baseline) | Dieci run cold/warm con mediana e p95 non eseguiti |
| P2-REACT-01 | Parziale | Firma scalare della sessione Editor e persistenza delle viste coperte dai test componenti | Profilazione before/after e soglie render-count non completate |
| P2-LAZY-01 | Chiuso su componente/contratto | Settings, Skill e Istruzioni sono chunk differiti, non montati prima della visita e poi persistenti in `test/renderer-startup.test.cjs` e `test/components/persistent-view-state.test.tsx` | Prime aperture da misurare nel pacchetto corrente |
| P2-DEPS-01 | Chiuso sul candidato locale | `npm ci` pulito (879 pacchetti, 0 vulnerabilità), dipendenze renderer fuori dal runtime main, contenuto `app.asar` ispezionato e moduli nativi ARM64 caricati nello smoke | Aggiornamenti futuri delle dipendenze richiedono la stessa certificazione |

## Matrice finale P3 — debito architetturale e manutenibilità

| ID | Stato finale | Prova reale disponibile | Residuo dichiarato |
|---|---|---|---|
| P3-IPC-01 | Chiuso su contratto | Rimossa la surface shell legacy; un solo canale dati `shellSessions` verificato in `test/shell-sessions-ipc.test.cjs` | Nessun residuo noto nel contratto esercitato |
| P3-LOG-01 | Chiuso su prova automatizzata | Allowlist, redazione, cap stringhe e coda bounded in `test/logger.test.cjs` | Campagna prolungata di rotazione del file log non eseguita |
| P3-SEC-01 | Chiuso su prova automatizzata | Sender+main frame e blocchi navigazione pre-load in `test/electron-security.test.cjs` | Pen-test del pacchetto fuori scopo |
| P3-MONO-01 | Parziale | Estratti controller per sessione workspace, comandi, retry remoto, output xterm e lifecycle DB | `App`, Editor e GitHub restano componenti estesi; nessuna estrazione ulteriore senza un bug/profilo misurato |
| P3-TEST-01 | Parziale | 558 test Node e 89 test componenti verdi; stress terminale e architecture stress `full` privacy-safe verdi | CI macOS e campagna Electron prolungata non completate |
| P3-TOOL-01 | Chiuso sul candidato locale | `packageManager`, `engines`, lock npm, `npm ci` pulito, build e packaging ARM64 riproducibili nella macchina di certificazione | Riproducibilità cross-machine/CI non ancora provata |

L'import scan non ha individuato una dipendenza di produzione chiaramente inutilizzata. Il problema dimostrato è soprattutto la classificazione runtime delle librerie renderer. TODO/FIXME rimasti riguardano probe opzionali confinati e non giustificano rimozioni affrettate.

## P4 — potenziamento dopo la stabilizzazione

- Registro minimale `webContents + workspace + operationId` per cancellare davvero DB, Git, filesystem e processi lunghi; nessun event bus generale.
- Diagnostica locale privacy-safe con versione, OS, Electron, conteggi processi/risorse ed errori recenti redatti.
- Paginazione e virtualizzazione solo per repository, schema o dataset che superano budget misurati.
- Benchmark ripetibile di startup cold/warm, heartbeat main, renderer responsiveness e stress bounded con soglie versionate.
- Recovery esplicito per connessione persa, processo AI bloccato e cache/persistenza corrotta senza reload globale.

## Gate conclusivi e residui

Completati sullo stesso candidato locale:

1. installazione pulita con `npm ci`, suite completa (558 Node + 89 componenti), type-check, lint, build, audit CSS e `git diff --check`;
2. architecture stress accelerato `full`: 100 MiB terminale byte-esatti, 1.000 cicli shell, 5.000.000 righe ricorsive SQLite, concorrenza update e 2.000 cicli workspace;
3. packaging personale ARM64 in `release`, ispezione `app.asar`, dipendenze runtime e assenza di ricorsione degli artefatti;
4. verifica CRC del DMG, test integrale dello ZIP, icona bundle identica al nuovo ICNS e conferma dell'assenza di una firma applicativa valida/identità/team;
5. smoke del bundle reale con profilo/workspace isolati, finestra Electron, processi attesi, moduli nativi caricati, chiusura e assenza di orfani.

Restano separati dall'accettazione del pacchetto personale:

1. dieci run startup cold/warm con mediana e p95;
2. UAT GitHub autenticato, SFTP e Database remoti con fixture dedicate;
3. campagna Electron manuale prolungata di Editor, xterm multipli, tema, resize e fault injection.

Il manifest configura esplicitamente un pacchetto personale non firmato (`mac.identity: null`). Il Mach-O upstream conserva una firma ad-hoc del linker senza identità o team, mentre la verifica del bundle applicativo fallisce come previsto per un'app non firmata; non è stata eseguita notarizzazione.

Un test verde è prova solo del contratto che esercita; non sostituisce il collaudo Electron, il benchmark, il packaging o l'UAT remoto richiesto dalla rispettiva area.
