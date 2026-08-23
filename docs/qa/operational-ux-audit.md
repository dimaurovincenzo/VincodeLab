# Audit UX operativa — stato implementato

Data audit: 22 agosto 2026

Baseline sorgente: `5d3f31de2a17589ff0d479ce9e1b6a1f073188ad`

Branch/worktree: `codex/ux-operational-workflow`

Design system invariato: Graphite tecnico su Ark UI, Park UI e Panda CSS

## Esito sintetico

L'intervento aggiunge il ciclo operativo keyboard-first sopra la UX Graphite approvata, senza modificare contratti di dominio, servizi esterni o semantica delle finestre macOS. Le viste principali restano persistenti durante la navigazione e le nuove superfici condivise usano le primitive native del design system: Ark UI per comportamento e accessibilità, Park UI come composizione e Panda CSS per token e styling.

Sono operativi:

- command palette contestuale con `⌘⇧P` e Quick Open con `⌘P`;
- indice file workspace, ranking fuzzy deterministico e cronologia MRU limitata;
- navigazione e azioni frequenti da menu, palette e tastiera con un registro comandi unico;
- persistenza versionata e allowlist dello stato operativo per workspace;
- fino a otto terminali indipendenti, con ciclo, chiusura, fallback MRU e recovery per sessione;
- contesto AI esplicito per file, selezione salvata, diff/modifiche Git e SQL corrente;
- feedback e recovery locali per Database, GitHub, file remoti, Impostazioni e boundary di vista;
- guard delle modifiche non salvate per Editor, Skill e Istruzioni progetto.

Uno smoke Electron locale manuale ha coperto i flussi principali e il rilancio dell'app durante l'intervento. Il candidato personale in `release` ha inoltre superato uno smoke isolato sul bundle reale: finestra aperta sul workspace temporaneo, renderer/GPU/network stabili, SQLite e `node-pty` ARM64 caricati, uscita pulita senza processi orfani. Questa seconda prova certifica avvio e shutdown del pacchetto, non ripete tutta la navigazione manuale e non costituisce ancora un harness versionato.

Non sono stati eseguiti UAT reali GitHub autenticato, SFTP o Database remoti: nessun push/fetch/pull su un remote dell'utente, collegamento SFTP, upload/download remoto o connessione PostgreSQL/MySQL/SQL Server reale. Queste aree sono coperte da contratti, fixture e stati UI, ma richiedono UAT separati con account, host e database dedicati.

## Metodo e isolamento del collaudo

La verifica ha combinato:

- lettura dei confini renderer, preload, IPC e processo principale;
- test Node, componenti React, contratti UI e integrazioni su repository/database temporanei;
- avvio dell'app Electron reale dal worktree, con renderer Vite e profilo isolato tramite `--user-data-dir`;
- comandi menu macOS reali e ispezione del focus nella finestra Electron;
- rilancio completo del processo per verificare il ripristino della sessione;
- database SQLite temporaneo e query innocua `SELECT 1 AS risultato`.

Il profilo e il database usati nello smoke test vivevano sotto `/tmp`. Non sono state usate credenziali, keychain, database o host remoti dell'utente. Il repository del worktree è stato osservato in sola lettura dalla UI GitHub: lo smoke test non ha aggiunto file allo staging e non ha creato commit.

I tempi della baseline restano osservazioni diagnostiche di un singolo run e non un benchmark statistico. Non è stata completata una campagna di dieci run cold/warm; perciò non si dichiara un p95 prestazionale finale.

## Matrice prima → dopo

| Area | Prima | Dopo implementato | Evidenza |
|---|---|---|---|
| Command palette | Assente | Combobox Ark/Park contestuale, categorie, stato disabled, tastiera, focus trap e ritorno all'opener | Test componenti e integrazione; apertura/esecuzione reale con `⌘⇧P` |
| Quick Open | Assente; filtro Explorer sui soli nodi caricati | `⌘P`, indice workspace nel main process, fuzzy ranking, recenti/frequenti, apertura file e workspace | Test indice fino a 10.000 file; apertura reale di `src/App.tsx` e `README.md` |
| Grammatica comandi | Logiche disperse tra menu e viste | Registro unico con `when`, `enabled`, esito e target focus; menu e palette condividono gli ID pubblici | Test unicità acceleratori, gating workspace e allowlist dispatch |
| Focus Editor | Apertura file lasciava il focus nel TreeView | CodeMirror riceve focus quando editabile; una preview read-only focalizza la tab attiva; restore asincrono rispettato | Smoke reale su `src/App.tsx`, `README.md` e comando Focus Editor |
| Persistenza | Solo recenti workspace | Vista, tab AI, file aperti/attivo, albero e viewport Editor, metadati terminali, stato GitHub e Database, target focus | Test store/client e rilancio Electron reale |
| Terminale | Una sola shell | Fino a 8 PTY indipendenti; creazione globale, selezione, ciclo, chiusura, restart e fallback MRU | Test manager/IPC/UI; due terminali creati e uno chiuso da tastiera nel runtime |
| Continuità viste | Ripristino incompleto e focus non deterministico | Le viste caricate restano montate sotto le tab Ark; xterm, CodeMirror e aree operative non vengono ricreati alla normale navigazione | Contratti di persistenza delle tab e smoke tra Editor/GitHub/Terminale/Database |
| AI contestuale | Solo picker e riferimento manuale | Azioni per file corrente, selezione salvata, diff o modifiche Git e SQL corrente; inserimento esplicito senza invio automatico | Registro comandi, UI allegati e test di contratto |
| Dirty guard | Solo Editor | Coordinamento Editor, Skill e Istruzioni con annulla/salva/scarta prima del cambio workspace | Test componenti dedicati |
| Git locale | Stage/unstage con conferma e refresh fragile | Stage/unstage locali e reversibili senza conferma; azioni remote restano confermate; dati precedenti mantenuti durante refresh | Test servizio e UI; smoke GitHub con 62 modifiche e 0 file in staging |
| Diff dal contesto | Richiedeva navigazione manuale completa | Comando dal file corrente apre GitHub e richiede il relativo diff | Smoke reale dal file README, con messaggio locale coerente per file senza modifiche |
| Query Database | Solo esito finale; focus restava altrove | Stato `Esecuzione…`, doppio invio bloccato, errore/retry inline, passaggio a Dati e focus sulla regione risultati dopo il render | Test contratti e query reale `SELECT 1` su SQLite temporaneo |
| Persistenza Database | Connessione e vista non ricordate | Connessione, sotto-tab, vista, schema espanso, tabella e query salvata attiva sono isolate per workspace | Test schema allowlist e integrazione dei componenti |
| Retry file remoti | Aggiornava la directory senza ripetere il transfer | Controller associa il transfer fallito all'operazione e ne consente un solo retry idempotente | Test componenti del controller; empty state reale senza profili SSH |
| Impostazioni | Refresh `Promise.all` all-or-nothing | `Promise.allSettled`: il fallimento di una sorgente non abbatte le altre sezioni | Test/contratto sorgente; nessuna installazione o rimozione reale nello smoke |
| Recovery vista | Boundary generico e reload globale | Errore confinato alla vista, retry locale, riferimento diagnostico copiabile e non sensibile | Test design system e componenti |
| Design system | Graphite già approvato | Identità visiva invariata; nuove UI entrano da `@/components/ui` e usano primitive Ark/Park/Panda | Audit design system e CSS |

## Scorciatoie operative

Le scorciatoie globali hanno lo stesso significato in ogni sezione. Le azioni contestuali compaiono soltanto dove hanno un target valido; `⌘W` chiude la risorsa corrente, mentre `⇧⌘W` conserva il comportamento macOS di chiusura finestra. Gli handler terminale ignorano input, editor e dialog normali, evitando che una combinazione globale scriva caratteri nel PTY sbagliato.

| Scorciatoia | Comando | Ambito | Stato |
|---|---|---|---|
| `⌘⇧P` | Palette comandi | Globale | Implementata e verificata nel runtime |
| `⌘P` | Quick Open | Globale; file solo con workspace | Implementata e verificata nel runtime |
| `⌘O` | Apri workspace | Globale | Conservata |
| `⌘,` | Impostazioni | Globale | Conservata |
| `⌘1`…`⌘5` | AI, Editor, Terminale, GitHub, Database | Workspace | Conservate; gating testato |
| `⇧⌘E` | Focus Explorer | Workspace | Implementata |
| `⌃Tab` / `⌃⇧Tab` | File successivo/precedente | Editor | Implementate |
| `⌘W` | Chiudi file o terminale attivo | Editor/Terminale | Implementata |
| `⇧⌘W` | Chiudi finestra | Finestra macOS | Distinta dalla chiusura risorsa |
| ``⌃` `` | Focus terminale | Workspace | Implementata |
| ``⌃⇧` `` | Nuovo terminale | Workspace, anche da altre viste | Implementata e verificata nel runtime |
| `⇧⌘[` / `⇧⌘]` | Terminale precedente/successivo | Terminale | Implementate |
| `⌘S` | Salva risorsa | Editor/Skill/Istruzioni | Implementata per contesto |
| `⌘F` | Cerca nella regione | Editor/xterm | Conservata per contesto |
| `⌘K` | Pulisci terminale | Terminale | Conservata |
| `⌘⌥G` | Aggiorna GitHub | GitHub | Implementata |
| `⌘Enter` | Esegui SQL | Database | Implementata e verificata nel runtime |
| `⌥⇧F` | Formatta SQL | Database | Conservata |

Non sono stati assegnati `F6`/`⇧F6`, `⌘B` e `⌃⇧G`: la navigazione ciclica tra regioni, il toggle sidebar globale e un secondo alias Git restano fuori da questo intervento. La palette rende comunque raggiungibili le destinazioni e i comandi implementati senza introdurre acceleratori in conflitto.

## Persistenza e privacy

Lo snapshot `v1` viene validato sia nel renderer sia nel main process, salvato per percorso workspace in SQLite e limitato a 256 KiB. Le scritture sono accorpate con debounce di 400 ms e vengono scaricate prima del cambio workspace o dell'unmount reale. Chiavi aggiuntive, cardinalità fuori limite, percorsi assoluti nei riferimenti file, JSON malformato e versioni non supportate vengono rifiutati o isolati.

| Area | Dati persistiti | Dati intenzionalmente non persistiti |
|---|---|---|
| Navigazione | Sezione corrente e tab AI | Stato transitorio di dialog, toast e caricamenti |
| Editor | Percorsi relativi, file aperti/attivo, directory espanse, selezione e scroll | Contenuto dei file, buffer dirty e percorsi assoluti dei file |
| Terminale | Tab, numero sessioni (0–8) e ordinale attivo | Session ID, PID, cwd, profilo/percorso remoto, output, input, titolo e contenuto dei processi |
| GitHub | Tab, diff relativo selezionato, progetto e filtro issue | Credenziali, token, payload GitHub e contenuto diff |
| Database | ID connessione, tab/vista, nodi schema, tabella e ID query salvata | SQL grezzo corrente, risultati, password, connection string e cronologia contenutistica |
| Layout/focus | Target focus enumerato; le dimensioni Splitter continuano a usare le chiavi workspace già esistenti | Riferimenti DOM e stato effimero dei componenti |

Al rilancio le shell non vengono congelate o serializzate: l'app ricrea soltanto il numero di terminali previsto e riattiva l'ordinale salvato. È una scelta esplicita per evitare di memorizzare output, directory e identificativi di processo potenzialmente sensibili.

La persistenza del profilo e del percorso remoto correnti non è ancora collegata allo snapshot `v1`; lo schema riserva un identificatore profilo opaco, ma l'UI terminale registra in questa versione soltanto tab e metadati delle shell. Anche l'SQL non salvato viene deliberatamente escluso. Questi limiti evitano persistenza implicita di dati sensibili ma impediscono di dichiarare completo il ripristino puntuale di REM-01 e del buffer SQL non salvato.

## Evidenze dello smoke Electron locale manuale

Il test esteso è stato eseguito manualmente nella finestra Electron dell'app, non in una pagina web sostitutiva. Non esiste ancora un harness versionato che consenta di riprodurne automaticamente tutta la navigazione. Le evidenze seguenti restano una registrazione dei flussi locali osservati; il punto 9 distingue lo smoke più ristretto ripetuto sul pacchetto personale corrente in `release`.

1. `⌘P` ha aperto Quick Open; `src/App.tsx` è stato caricato nell'Editor con focus CodeMirror.
2. L'apertura di `README.md`, mostrato come preview read-only, ha trasferito il focus alla sua tab attiva invece di lasciarlo nella palette o nel TreeView.
3. È stato registrato uno snapshot con GitHub/Modifiche, README aperto, due terminali e il secondo attivo; dopo il riavvio l'app ha riaperto GitHub, `⌘2` ha ripristinato README e Terminale ha ricreato esattamente due sessioni selezionando la seconda.
4. Da AI, ``⌃⇧` `` ha creato due terminali senza richiedere prima la navigazione alla sezione; `⌘W` ha chiuso quello attivo e ha focalizzato il fallback MRU.
5. GitHub ha mostrato 62 modifiche locali e `Pronti per il commit 0`; nessuna azione dello smoke ha modificato lo staging. Il primo percorso non ha perso il carattere iniziale.
6. Il comando diff dal file README ha aperto GitHub e comunicato correttamente che il file non aveva modifiche.
7. In Database è stata creata una connessione SQLite isolata tramite dialog nativo. `⌘Enter` ha eseguito `SELECT 1 AS risultato`, mostrando `1 righe · 0 ms`, valore `1` e una voce di cronologia. Al completamento, `document.activeElement` era la `SECTION` risultati con `tabIndex=-1`.
8. File remoti ha mostrato l'empty state coerente per l'assenza di profili SSH, senza errori globali.
9. Il nuovo pacchetto personale non firmato ha aperto una finestra reale sul workspace isolato; il bundle ha caricato `better-sqlite3` e `node-pty` ARM64 e si è chiuso senza helper o renderer orfani. La navigazione estesa non è stata ripetuta in questo smoke del pacchetto.

Lo smoke non ha premuto Invio nel terminale AI e non ha inviato prompt a un modello esterno. Non ha stage/unstage, commit, push, mutazioni database, installazioni, aggiornamenti o trasferimenti remoti.

## Difetti scoperti durante il collaudo e correzioni

| Difetto reale | Causa | Correzione e regressione |
|---|---|---|
| La sessione workspace non partiva in sviluppo | Il cleanup di prova di React StrictMode disponeva il client condiviso prima del mount effettivo | Dispose differito a microtask e annullato se il componente viene rimontato; rilancio reale e test client/store |
| Primo file Git senza carattere iniziale e classificazione staged errata | `trim()` rimuoveva lo spazio strutturale iniziale del porcelain `-z` | Output porcelain letto raw; test d'integrazione su repository Git temporaneo tutela il primo record |
| Nuovo terminale non funzionava da AI | L'acceleratore era dichiarato solo nel menu azioni della sezione Terminale | `terminal.new` promosso tra i comandi globali gated dal workspace; verificato da AI nel runtime |
| Focus Editor intermittente dopo Quick Open/restore | Commit della tab, mount CodeMirror e restore asincrono potevano completarsi in frame diversi; Fast Refresh conservava ref non coerenti con lo state | Richiesta focus pendente, attesa `sessionRestoreReady` e fallback alla tab per preview read-only; smoke su file sorgente e README |
| Focus risultati Database restava sul trigger del dialog | La chiamata `focus()` precedeva il render della tab Dati gestita da Ark | Intento focus pendente consumato dopo render visibile; verificato nella query SQLite reale |
| Query + Invio nello stesso frame poteva usare il filtro precedente | L'handler leggeva lo state React non ancora committato | Query corrente mantenuta in ref; test palette dedicato |
| Scorciatoie terminale potevano intercettare input normali | Mancava un guard condiviso per target editabili e dialog | Guard comune consente il PTY soltanto nell'host xterm e sopprime input/textarea/contenteditable/dialog; test componente |

## Copertura degli scenari operativi

| Scenario | Copertura ottenuta | Limite residuo |
|---|---|---|
| DEV-01 | Quick Open, focus Editor, diff contestuale, terminali multipli, chiusura MRU e ripristino al rilancio verificati; Git e indice coperti da integrazione | Nessun commit o cambio tra due workspace dirty eseguito nello smoke reale |
| AI-01 | File, selezione, Git e SQL esposti come contesto esplicito; inserimento senza invio automatico e guard file dirty | Nessun prompt reale inviato; output terminale ed errore diagnostico non hanno ancora un allegato strutturato con anteprima/rimozione |
| DB-01 | Running locale, esclusione doppia esecuzione, query read-only, risultato, cronologia, focus e restore metadata coperti | Nessuna mutazione reale e nessun fault di rete in Electron; SQL non salvato non viene persistito |
| REM-01 | Empty state reale, retry idempotente e conflitti coperti da unit/component test | Nessuna sessione SFTP reale; percorso remoto non incluso nello snapshot `v1` |
| ERR-01 | Boundary per vista, retry locale, correlation ID, Settings `allSettled`, errori DB/Remote e race stale coperti da test | Non è stata eseguita una campagna Electron completa di fault injection su ogni servizio |

Questa è quindi una verifica realistica dei workflow locali, non una certificazione end-to-end dei servizi remoti. L'UAT remoto deve usare fixture/account dedicati e deve controllare esplicitamente che token, credenziali, keychain e contenuti non entrino in snapshot o log.

## Gate automatici

L'intervento aggiunge copertura per command foundation/palette, indice file, store e client sessione, menu, multi-terminale, IPC, dirty guard, retry remoto, focus/shortcut, race renderer e regressioni Git. I conteggi puntuali sono omessi perché diventano obsoleti a ogni nuova regressione; il gate finale deve registrare il comando, lo stesso `HEAD` e l'esito complessivo.

| Gate | Stato documentato |
|---|---|
| Test mirati delle aree modificate | Eseguiti durante l'intervento; prove elencate nelle matrici QA |
| Suite Node completa | Verde: 558/558 |
| Suite componenti React completa | Verde: 89/89 in 17 file |
| Lint | Verde, senza warning |
| Type-check | Verde |
| Audit CSS/design system | Verde: 0 collisioni, `!important`, colori locali o selettori tema nelle viste |
| `git diff --check` | Verde dopo gli aggiornamenti documentali finali |
| Build di produzione | Verde; entry eager 999.600 byte raw / 277.599 gzip |
| Packaging macOS personale | Verde: DMG e ZIP ARM64 in `release`, firma applicativa intenzionalmente assente |
| Ispezione `app.asar` e dipendenze runtime | Verde: 48.564.226 byte, nessun artefatto `release`/app annidata e nessuna libreria renderer runtime |
| Integrità immagine e smoke installazione locale | Verde: CRC DMG, ZIP integro, icona valida, finestra reale e shutdown senza orfani |

Il manifest separa gli asset renderer dagli installer, usa `release` come output electron-builder e configura `mac.identity: null`. Sono stati prodotti `VincodeLab-0.1.2-arm64.dmg` (147.641.259 byte, SHA-256 `40dc42ee0358f9a8e4190350182dcd1963b40a1020f7fc6640c6257f365d7bcc`) e `VincodeLab-0.1.2-arm64-mac.zip` (145.236.783 byte, SHA-256 `414b027bc6976d79f943bfc3303120c9772510f00cd5f3f7a5098ce367b303f9`). Il pacchetto è personale, non firmato e non notarizzato.

Le misure di chunk e startup raccolte in precedenza restano baseline diagnostiche, non esiti finali. Devono essere rigenerate dalla build candidata prima di usarle come criterio di accettazione.

## Decisione e limiti di accettazione

Il ciclo operativo locale richiesto è implementato: palette/Quick Open, tastiera, focus, sessione per workspace, multi-terminale, feedback e recovery restano dentro la UX Graphite. Gate, build, packaging, ispezione e smoke di avvio/shutdown rendono il DMG ARM64 pronto per l'installazione personale locale. L'assenza intenzionale di firma/notarizzazione e i limiti UAT sotto elencati restano parte dell'accettazione.

Prima di dichiarare validati anche i workflow remoti di produzione restano necessari:

1. UAT GitHub autenticato con account/repository fixture, includendo fetch, pull, push, issue e Project;
2. UAT SFTP con host fixture, challenge, download, upload, retry e conflitto;
3. UAT Database remoti con istanze fixture PostgreSQL, MySQL e SQL Server, inclusi timeout e recovery;
4. fault injection Electron completa su Pi, Git, Database, Settings e trasferimenti;
5. dieci run cold/warm con mediana e p95 per palette, prime aperture e query;
6. scelta esplicita su eventuale persistenza futura di percorso remoto e buffer SQL, mantenendo il principio di minima memorizzazione.

Nessun push remoto viene eseguito come parte di questo audit.
