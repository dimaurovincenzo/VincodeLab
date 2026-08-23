# VincodeLab — certificazione Reliability, Resilience & Fault Tolerance

Stato documento: **FINALE — approvato per installazione personale locale**
Data di preparazione: 23 agosto 2026
Branch di lavoro: `codex/ux-operational-workflow`
Baseline Git attualmente visibile: `5d3f31de2a17589ff0d479ce9e1b6a1f073188ad`
Commit candidato: `fae588d5d4b0116f2d1bd9d310d725a26961b1f3`

## 1. Scopo e regole di interpretazione

Questo documento raccoglie le evidenze disponibili per il ciclo di hardening di affidabilità di VincodeLab. La baseline Graphite, Ark UI/Park UI e Panda CSS è congelata: le modifiche considerate riguardano esclusivamente isolamento degli errori, protezione del lavoro, cancellation, timeout, retry, lifecycle, diagnostica e stabilità.

La certificazione non trasforma un test unitario in un collaudo Electron e non trasforma una fixture locale in un UAT remoto. Il commit `fae588d5d4b0116f2d1bd9d310d725a26961b1f3` differisce dal commit prodotto `aef7f2235dd85f6490d9c52d643eb9cd1bfe4e70` esclusivamente per la correzione e il test del verificatore fault-smoke: nessun sorgente incluso nell'app è cambiato. Il package finale viene comunque rigenerato dal nuovo `HEAD` per legare gli artefatti al candidato dichiarato.

Stati usati nelle matrici:

| Stato | Significato |
|---|---|
| **VERIFICATO** | Comportamento osservato con test automatico, misura o artefatto riproducibile. Può essere qualificato come intermedio se eseguito prima delle ultime modifiche. |
| **SIMULATO** | Failure o carico prodotto con fake, stub, driver controllato o processo sintetico. Verifica il contratto, non il servizio esterno reale. |
| **FIXTURE REALE LOCALE** | Prova con filesystem, processo, repository Git, SQLite o servizio locale reale e isolato, senza dati o credenziali dell'utente. |
| **NON VERIFICATO** | Nessuna prova adeguata disponibile per il requisito dichiarato. |

## 2. Override e vincoli autorizzativi

1. **Soak 8–12 ore escluso.** L'utente ha esplicitamente richiesto di non eseguire il soak lungo. Gli stress bounded o accelerati non sono presentati come equivalenti a una giornata d'uso. Il criterio originale relativo al soak è quindi registrato come override accettato, non come test superato.
2. **Nessun push remoto automatico.** Il ciclo non autorizza push, issue, Project o altre mutazioni GitHub remote. Di conseguenza l'UAT GitHub autenticato e mutativo resta **NON VERIFICATO** finché non vengono forniti account e repository fixture e un'autorizzazione esplicita.
3. **Pacchetto personale non firmato.** `build.mac.identity` è `null`; non sono richieste firma Developer ID o notarizzazione. La verifica finale deve confermare l'assenza intenzionale di identità/team e documentare le conseguenze Gatekeeper, senza descrivere il pacchetto come firmato.
4. Nessun test deve usare profilo, home, chiavi SSH, token, repository, host o database di produzione dell'utente.

## 3. Identità del candidato e ambiente

| Campo | Valore corrente | Stato finale |
|---|---|---|
| Prodotto | VincodeLab `0.1.2` | VERIFICATO dal manifest |
| Worktree | Ambiente di verifica dedicato al workflow operativo; percorso locale omesso | VERIFICATO |
| Branch | `codex/ux-operational-workflow` | VERIFICATO |
| Baseline precedente | `5d3f31de2a17589ff0d479ce9e1b6a1f073188ad` | Riferimento storico, non candidato |
| Commit prodotto | `aef7f2235dd85f6490d9c52d643eb9cd1bfe4e70` | Tutte le modifiche prodotto e gli harness iniziali |
| Commit candidato/verificatore | `fae588d5d4b0116f2d1bd9d310d725a26961b1f3` | VERIFICATO; aggiunge soltanto l'helper puro `visibleCodeMirrorTextMarker(marker)`, che rimuove un solo LF/CRLF iniziale, e le regressioni semantiche LF, CRLF e spazi del fault-smoke |
| Stato worktree ai gate | Pulito prima dell'aggiornamento di questo documento | VERIFICATO; la sola modifica successiva è la certificazione stessa |
| macOS | 26.5.2, build 25F84 | VERIFICATO sulla macchina di lavoro |
| Architettura | Apple Silicon `arm64` | VERIFICATO |
| Node.js | `v26.0.0` | VERIFICATO |
| npm | `11.12.1` | VERIFICATO |
| Electron | `43.4.1` | VERIFICATO |
| Package manager dichiarato | `npm@11.12.1`; engine Node `>=22.12.0 <27` | VERIFICATO dal manifest |
| Renderer | React 19, Ark UI, Park-style components, Panda CSS, CodeMirror 6, xterm 6 | VERIFICATO dal manifest e dai contratti UI |
| Packaging | electron-builder, output `release`, `mac.identity: null` | VERIFICATO sul package finale da `fae588d` |
| Rete dei benchmark/smoke | loopback, profilo e directory applicative/workspace temporanei; rete esterna bloccata nello smoke packaged | VERIFICATO dal codice degli harness |

## 4. Sintesi dell'evidenza disponibile

| Area/requisito | Stato | Evidenza disponibile | Risultato e limite |
|---|---|---|---|
| Confine Electron, preload e IPC trusted sender | VERIFICATO | `test/electron-security.test.cjs`, `test/preload-surface.test.cjs`, `electron/ipc-security.cjs` | Main frame e sender sono validati; navigazione e nuove finestre sono bloccate. Pen-test del bundle non eseguito. |
| Errori pubblici e privacy | VERIFICATO | `test/public-error.test.cjs`, `test/logger.test.cjs` | Errori, path, query e segreti sono redatti; coda log bounded. Rotazione prolungata non verificata. |
| Persistenza corrotta | FIXTURE REALE LOCALE | `test/workspace-session-store.test.cjs`, `test/components/workspace-session-client.test.tsx` | JSON malformato, schema invalido, versioni future e proprietà extra degradano verso default/porzione valida. |
| Dirty guard e bozze dopo crash renderer | VERIFICATO + E2E PACKAGED | Test registry/componenti e smoke `--fault-recovery` | Editor, Skill, Istruzioni e bozze Database sono rispecchiati in memoria nel main. Nell'E2E `Page.crash` il contesto renderer è stato sostituito, il registro main ha recuperato il marker completo, il file su disco è rimasto invariato e il renderer ricaricato ha mostrato la bozza. |
| Recovery del renderer | VERIFICATO + E2E PACKAGED | `test/renderer-recovery-controller.test.cjs`, `scripts/smoke-packaged-macos.mjs --fault-recovery` | Filtra frame secondari/`ERR_ABORTED`, coalesca crash+load failure, resetta su load finito ed evita reload durante chiusura. Fault-smoke finale verde in 1.528 ms; la correzione riguarda solo la rappresentazione `textContent` di CodeMirror nel verificatore. |
| Isolamento errori per vista | VERIFICATO | `test/components/app-error-boundary.test.tsx`, test recovery Settings/Database/Remote | Boundary locale, riferimento diagnostico e retry non richiedono reload globale. Non è stata eseguita una campagna Electron separata di crash per ogni singola vista. |
| Chiusura finestra e quit | VERIFICATO + E2E PACKAGED | Test lifecycle/coordinator e smoke packaged | La finestra non viene distrutta prima del cleanup; failure lascia la finestra aperta e il retry è coalesced/exactly-once. Smoke normale e fault hanno chiuso graceful con `remainingProcesses: []` e fixture temporanee rimosse. |
| Processo AI/Pi | SIMULATO | `test/pi-session-controller.test.cjs` | Missing executable, crash, stream continuo, start/stop/start, TERM→KILL, write/reload failure e retry sono coperti. Processo Pi reale sotto fault nel bundle non verificato. |
| Shell, PTY e xterm | SIMULATO; parziale FIXTURE REALE LOCALE | `test/shell-session-manager.test.cjs`, test componenti xterm, stress e smoke | Lifecycle, generation, ACK/backpressure, stale output e retry coperti; stress sintetico 100 MiB. Il bundle ha caricato `node-pty` ARM64; una sessione PTY interattiva prolungata non è stata collaudata. |
| Operazioni Database e lifecycle | VERIFICATO + SIMULATO | `test/database-operation-registry.test.cjs`, `test/database-service.test.cjs` | Abort workspace/owner/all attende drain bounded; un timeout conserva l'operazione e consente retry. Driver remoti sono fake/controllati. |
| Database SQLite | FIXTURE REALE LOCALE | `test/database-service.test.cjs`, `scripts/architecture-soak*.mjs` | Query, transazione/rollback, timeout, abort, worker, paginazione e budget sono esercitati su file SQLite temporanei reali. |
| PostgreSQL, MySQL e SQL Server | SIMULATO / NON VERIFICATO | fake driver in `test/database-service.test.cjs` | Cancellation e lifecycle del contratto driver sono coperti; connessione persa/reconnect/credenziali contro istanze reali non verificati. |
| Git locale | FIXTURE REALE LOCALE | `test/github-local-repository-fixtures.test.cjs`, `test/github-service.test.cjs`, `test/github-command-cancellation.test.cjs` | Repository temporanei reali coprono detached HEAD, merge conflict, gitdir corrotto, modifiche esterne, executable mancante, cancel/timeout/retry e grandi status/diff bounded. |
| Letture GitHub e race renderer | SIMULATO | `test/github-service.test.cjs`, `test/github-operation-registry.test.cjs`, `test/components/github-workspace-races.test.tsx` | Cache stale controllata, latest-wins e risposte obsolete ignorate. Non equivale a UAT autenticato. |
| GitHub remoto autenticato/mutativo | NON VERIFICATO | Nessun account/repository fixture autorizzato | Fetch/pull/push/issue/Project/rate limit reali restano aperti. Nessun push remoto automatico è consentito. |
| SFTP service e file remoti | SIMULATO | `test/sftp-service.test.cjs`, `test/remote-file-service.test.cjs`, `test/remote-file-store.test.cjs` | Timeout, cancel, TERM→KILL, serializzazione, cleanup, trasferimenti atomici, conflitto, retry e stale-result protection coperti con processi/adapter controllati. |
| SFTP loopback OpenSSH | FIXTURE REALE LOCALE — VERIFICATO | `scripts/uat-sftp-loopback.mjs`, `test/uat-sftp-loopback.test.mjs`, `docs/qa/reliability-sftp-uat.json` | Il 23 agosto 2026 la fixture non-root confinata a `127.0.0.1`/porta alta ha verificato bad key→rifiuto, good key→ControlMaster, listing, download/upload con hash, chmod, rename, mkdir/rmdir, permission denied con connessione ancora viva, cancel dopo progresso reale e cleanup 7/7. Report SHA-256 `fa019decd41cc562e4550fc82c80e794ac14930f50fa046c310b5fc6a256ecb3`; scansione indipendente: zero processi e directory fixture residui. |
| Managed SSH/ControlMaster | SIMULATO + trasporto FIXTURE REALE LOCALE | `test/managed-ssh-service.test.cjs`, UAT SFTP loopback | Deadline, abort, exit fallito, TERM→KILL e retry del servizio gestito sono simulati; il trasporto ControlMaster OpenSSH e il suo teardown sono stati esercitati realmente nella fixture locale. Challenge interattivi e reconnect completi restano non verificati. |
| Filesystem e indice workspace | FIXTURE REALE LOCALE | `test/project-files.test.cjs`, `test/project-file-index.test.cjs` | Traversal asincrono, symlink containment, file eliminati/esterni, cancellazione e 10.000 file sintetici. Directory piatta da 100.000 entry non verificata. |
| Aggiornamenti gestiti | FIXTURE REALE LOCALE + SIMULATO | `test/update-store.test.cjs`, `test/update-lifecycle.test.cjs` | CAS, lock/journal cross-process, staging atomico, rollback e recovery dopo morte owner. Attivazione su pacchetto utente reale non eseguita. |
| Mutazioni esterne durante lifecycle | VERIFICATO + SIMULATO | `test/external-mutation-registry.test.cjs` | Le mutazioni non vengono auto-ripetute; drain timeout fail-closed conserva il registro e permette retry dopo settlement. |
| Race e risultati stale | VERIFICATO + SIMULATO | registry Database/GitHub, test Editor, session client, GitHub races e Remote Files | Operation ID, generazioni, latest-wins e protezioni post-abort impediscono l'applicazione di risultati obsoleti nei contratti esercitati. |
| Stress accelerato | SIMULATO — VERIFICATO | `scripts/architecture-soak.mjs --profile full` | 5/5 in 2.702,996 ms: terminale 100 MiB esatti, 1.000 cicli shell/3.000 processi/zero residui, SQLite 5 milioni di righe/zero worker, update 5 vincitori/35 rifiuti/zero temp, persistenza 2.000 cicli e recovery 60/60. Non equivale al soak escluso. |
| Memory leak / CPU idle | VERIFICATO CON LIMITI | `docs/qa/reliability-memory-cpu.json`, `docs/qa/reliability-memory-cpu-extended.json` | Due run da 120 cicli e un run da 240 sono verdi, con processi/DOM/listener stabili dopo warm-up e zero processi post-shutdown. L'heap cresce ancora in modo piccolo e decelerante dopo GC; non viene presentato come prova assoluta di assenza di leak. |
| Benchmark cold/warm | VERIFICATO | `docs/qa/reliability-benchmark.json` | 10 cold + 10 warm completati, 20/20 navigazioni connesse e shutdown riusciti. Limiti e outlier sono mantenuti nella sezione 7. |
| Full regression e gate build | VERIFICATO | Suite Node, componenti, lint, build e audit CSS | Node 658/658; componenti 140/140 in 25 file; totale 798. Lint senza warning, build e audit CSS verdi. |
| Packaging, integrità e firma | VERIFICATO | `release`, `SHA256SUMS.txt`, `hdiutil`, `unzip`, `codesign`, `spctl` | Package finale da `fae588d`; compilazione intenzionalmente senza Developer ID/notarizzazione. Hash e interpretazione della firma sono nella sezione 10. |
| Smoke Electron packaged | VERIFICATO | `scripts/smoke-packaged-macos.mjs`, test contratto 4/4 | Sul package finale: smoke normale verde in 2.363 ms; fault-recovery verde in 1.528 ms; entrambi graceful, senza processi orfani e con temp rimossi. |
| Soak 8–12 ore | NON VERIFICATO — escluso dall'utente | Override esplicito | Nessuna equivalenza dichiarata con stress bounded. |

## 5. Correzioni applicate nel ciclo

| Failure osservato o rischio concreto | Correzione | Recovery attesa | Evidenza |
|---|---|---|---|
| Chiusura finestra/quit poteva procedere prima del rilascio delle risorse | Handshake renderer fail-closed, `window-close-coordinator` e cleanup asincrono ordinato | Cleanup riuscito chiude; cleanup fallito mantiene la finestra aperta e offre retry | Test lifecycle/coordinator |
| Processo Pi sostituito o bloccato poteva lasciare listener/processi o doppie sessioni | Controller owner della sessione, stop bounded TERM→KILL e start serializzato | Retry solo dopo exit confermato; nessun replacement parallelo | Test Pi controller |
| Shell/PTTY poteva perdere output, applicare output stale o rimuovere una sessione prima dell'exit | Generation/attachment ID, snapshot bounded, ACK/backpressure e close/dispose awaitable | Stallo o kill non confermato conserva il registro e permette retry | Test shell manager e xterm controller |
| Query Database annullate durante workspace/quit non avevano un drain osservabile | Registro operazioni con abort per workspace/owner/all, promise `finished` e timeout bounded | Timeout propaga failure senza cancellare il registro; retry attende l'operazione ancora viva | Test Database operation registry |
| Update/delete di una connessione poteva correre contro una query attiva | Drain operazioni e chiusura sessione prima della mutazione del profilo | Se cleanup fallisce, il profilo non viene mutato/eliminato | Contratto main e test registry |
| Cleanup Remote Files poteva trattare timeout/rejection come successo e cancellare registri vivi | Drain all-settled con propagazione failure; clear soltanto dopo successo; close retryable | Operazioni tardive dopo abort non producono risultati UI stale; retry completa il cleanup | Test Remote Files failure→retry |
| SFTP/SSH potevano liberare slot prima dell'exit o considerare riuscito un disconnect fallito | Slot fino a `close`, TERM→KILL, timeout, stato cleanup conservato | Nuove operazioni restano bloccate fino a cleanup confermato; retry senza residui | Test SFTP/Managed SSH |
| Listing OpenSSH macOS assoluto non veniva normalizzato | Parser accetta link count `?`, riduce al basename e filtra `.`/`..` | Listing locale macOS leggibile senza abilitare operazioni distruttive sui symlink | Fixture regressione SFTP |
| Refresh Git/GitHub e diff concorrenti potevano sovrascrivere stato recente | Registry latest-wins per letture, AbortSignal al processo e generazioni renderer | Il processo precedente termina e il risultato stale viene ignorato; retry immediato | Test Git cancellation/GitHub races |
| Mutazioni esterne avevano semantica di timeout ambigua | Registro separato non cancellabile con drain fail-closed | Nessun retry automatico di operazioni mutative; l'utente può rivalutare dopo settlement | Test external mutation registry |
| Crash/load failure renderer poteva lasciare una finestra vuota o avviare recovery paralleli | Controller locale unico per `render-process-gone`/`did-fail-load`, filtro frame/errori e reset su `did-finish-load` | Una sola scelta/reload per incidente; retry dopo errore; no-op durante chiusura | Test renderer recovery |
| Bozze renderer sarebbero state perse dal reload locale | Registro volatile nel main e reidratazione prima del mount React | Editor, risorse Pi e buffer Database riaprono la bozza senza scriverla su disco | Test volatile draft + fault smoke packaged eseguito |
| Errori IPC/log potevano esporre dettagli tecnici o sensibili | Tassonomia pubblica codificata, allowlist log e redazione | UI riceve messaggi operativi; diagnostica conserva solo campi sicuri | Test public error/logger/security |

## 6. Lifecycle delle risorse

| Risorsa | Owner e apertura | Boundary di cleanup | Semantica in caso di failure | Evidenza attuale |
|---|---|---|---|---|
| Finestra Electron | `BrowserWindow` / main | close finestra, quit | Finestra aperta su cleanup fallito; richiesta coalesced; retry esplicito | VERIFICATO su controller |
| Renderer | `webContents` | crash, load failure, chiusura | Recovery locale coalesced; no reload loop dopo load concluso; cleanup DB per owner | SIMULATO + E2E packaged `Page.crash` |
| Pi/AI PTY | `pi-session-controller` | restart, cambio workspace, quit | TERM→KILL bounded; nessun nuovo start finché exit non confermato | SIMULATO |
| Shell PTY | `shell-session-manager` | close tab, workspace, quit | Sessione resta registrata su timeout; dispose propaga failure e consente retry | SIMULATO/stress |
| Query Database | `database-operation-registry` | cancel, connessione, renderer, workspace, quit | Abort raggiunge il driver; drain bounded; timeout conserva l'entry | VERIFICATO + SIMULATO |
| Sessioni Database | registry in `database-service` | connessione, workspace, quit | Close async, fallback forzato bounded, invalidazione aperture concorrenti | FIXTURE SQLite + fake remoti |
| Letture Git/GitHub | `github-operation-registry` | supersede, renderer/workspace/quit | Latest-wins e drain prima del cambio owner | SIMULATO + Git locale reale |
| Mutazioni Git/GitHub/Pi/update/DB | `external-mutation-registry` | workspace/quit | Non cancellate o ripetute automaticamente; timeout fail-closed e retry drain | SIMULATO |
| Trasferimenti Remote Files | `remote-file-service` | cancel, workspace, quit | Clear soltanto dopo settlement; late result rifiutato; retry cleanup | SIMULATO |
| Child SFTP | `sftp-service` | connessione, workspace, quit | Coda chiusa, TERM→KILL, slot rilasciato solo su `close` | SIMULATO + FIXTURE REALE LOCALE verificata |
| SSH ControlMaster | `managed-ssh-service` | dopo drain SFTP, workspace, quit | Exit fallito/bloccato resta diagnostico e retryable | Servizio SIMULATO; trasporto/teardown FIXTURE REALE LOCALE |
| Indice filesystem | `project-file-index` | invalidazione/cambio workspace/quit | Cancellazione cooperativa, cache isolata e nessun risultato stale | FIXTURE REALE LOCALE |
| Log e registro istanza | main process | ultimo stadio del quit | Flush bounded; heartbeat e registrazione rimossi solo dopo cleanup servizi | Contratto/test + shutdown packaged |

## 7. Benchmark cold/warm

Artefatto: `docs/qa/reliability-benchmark.json`, generato il `2026-08-22T22:06:01.698Z` (23 agosto, ora locale). L'harness usa Electron di sviluppo con workspace, profilo, data directory, Pi fake e SQLite locali isolati. I run cold ricreano la fixture; i run warm condividono profilo e data directory. Non è un benchmark del DMG installato. Tutti i 10 run cold e i 10 warm hanno mantenuto la navigazione connessa e completato lo shutdown.

| Metrica | Cold mediana / p95 | Warm mediana / p95 |
|---|---:|---:|
| Startup | 820,50 / 1.084,10 ms | 820,60 / 850,70 ms |
| Command Palette | 35,00 / 55,00 ms | 30,40 / 46,90 ms |
| Quick Open | 18,10 / 22,30 ms | 36,00 / 71,00 ms |
| Prima apertura Editor | 324,20 / 328,30 ms | 327,10 / 339,40 ms |
| Prima apertura Terminale | 339,30 / 343,10 ms | 325,10 / 348,40 ms |
| Prima apertura GitHub | 332,50 / 344,30 ms | 332,70 / 340,40 ms |
| Apertura Database | 414,50 / 430,30 ms | 0,20 / 420,00 ms |
| Query SQLite | 17,60 / 18,50 ms | 17,50 / 19,50 ms |
| Shutdown | 152,35 / 160,72 ms | 147,96 / 160,35 ms |
| Heap renderer | 17.318.004 / 17.333.900 byte | 16.240.792 / 17.335.304 byte |
| Processi osservati | 7 / 7 | 7 / 7 |
| CPU aggregata, singolo campione idle | 9,7% / 40,1% | 0,8% / 13,3% |
| RSS aggregato | 654.983.168 / 657.850.368 byte | 650.821.632 / 654.753.792 byte |

Limiti: il Database warm è bimodale perché il primo campione misura il mount (420 ms) e i successivi riusano la vista persistente (0,1–0,3 ms); la mediana da 0,2 ms non è una prima apertura. La CPU del benchmark è un singolo campione `ps`, non un profilo temporale, e due run cold mostrano circa il 40%. Il file non incorpora lo SHA del commit né un campo globale `ok`; il binding al candidato deriva dalla sequenza di esecuzione registrata e dall'assenza di modifiche prodotto successive. Non viene dichiarato un miglioramento rispetto a una baseline sulla sola base di questo artefatto.

## 8. Memoria, CPU e stress

Il profilo persistito `docs/qa/reliability-memory-cpu.json` usa due run, 100 cicli di warm-up e poi, per run, 120 cambi vista, 120 aperture Command Palette e 120 Quick Open. Il GC viene richiesto via CDP prima di ogni campione heap. I due run hanno completato tutte le operazioni e lo shutdown graceful, senza richieste esterne e con zero processi noti residui.

- Heap dopo operazioni: +1.875.940 e +1.926.208 byte; dopo cleanup: +1.053.276 e +1.099.108 byte rispetto alla baseline.
- La seconda metà dei run cresce di 138.484 e 140.748 byte, pari all'8,0% e 7,9% della prima metà: la crescita rallenta nettamente ma non è zero.
- Listener: incremento una tantum 514→526 durante l'uso, poi ritorno a 514 dopo cleanup. Nodi DOM trattenuti: 736 stabili; documenti e history invariati.
- CPU idle aggregata: 0,7% e 0,6%; renderer: 0,289% e 0,284%. Sei processi stabili durante ciascun run e zero dopo shutdown.

Il run esteso `docs/qa/reliability-memory-cpu-extended.json` applica 240 cicli combinati nello stesso renderer: +2.884.056 byte dopo operazioni, +2.012.552 dopo cleanup, con soli 353.012 byte nella seconda metà (13,9% della prima). Listener e DOM tornano ai valori di cleanup e non restano processi. Il campione CPU aggregato idle del run esteso è 7,4%, mentre il renderer è 0,293%; il dato `ps` resta sensibile al carico di sistema.

Lo stress `full` accelerato è verde 5/5 in 2.702,996 ms: terminale 104.857.600 byte con coda massima 65.536; shell 1.000 cicli/3.000 processi e zero residui; SQLite 5.000.000 righe e zero worker; update 5 vincitori/35 rifiuti e zero file temporanei; persistenza 2.000 cicli e recovery 60/60. Queste misure non provano in assoluto l'assenza di leak e non sostituiscono il soak 8–12 ore esplicitamente escluso.

## 9. Gate finali

I gate software e gli artefatti fanno riferimento al candidato `fae588d5d4b0116f2d1bd9d310d725a26961b1f3`. La modifica successiva di questo documento non cambia sorgenti, harness o bundle.

| Gate | Comando/evidenza prevista | Stato |
|---|---|---|
| Worktree e commit | `git status --short`; `git rev-parse HEAD` | **PASS — `fae588d5d4b0116f2d1bd9d310d725a26961b1f3`; worktree pulito prima della scrittura finale della certificazione** |
| Suite Node completa | `node --test test/*.test.cjs test/*.test.mjs` | **PASS — 658/658 in 4,785 s** |
| Suite componenti completa | `npm run test:components` | **PASS — 140/140, 25 file in 5,62 s** |
| Baseline minima | Totale non inferiore ai 524 test originari, senza regressioni | **PASS — 798 test totali** |
| Lint | `npm run lint` | **PASS — zero warning** |
| Type-check e build | `npm run build` | **PASS — TypeScript + Vite, 3.432 moduli in 1,08 s; solo warning standard sulla dimensione chunk** |
| Audit CSS/design system | `npm run audit:css:check` | **PASS — 5 file/49 selettori; 0 collisioni, 0 `!important`, 0 colori locali, 0 temi per vista** |
| Whitespace | `git diff --check` | **PASS** |
| Stress accelerato | `npm run stress:architecture` | **PASS — 5/5 in 2.702,996 ms; dettagli in sezione 8** |
| Benchmark | `npm run benchmark:reliability -- --output docs/qa/reliability-benchmark.json` | **PASS CON LIMITI — 10 cold + 10 warm, 20/20 navigazioni connesse** |
| Profilo memoria/CPU/processi | report descritti nella sezione 8 | **PASS CON LIMITI — 2×120 + 1×240 cicli, 3 shutdown graceful, zero residui/rete esterna** |
| Packaging macOS | `npm run package` da `fae588d` | **PASS — electron-builder, `identity: null`, firma macOS saltata intenzionalmente** |
| Hash artefatti | `release/SHA256SUMS.txt` e ricalcolo SHA-256 | **PASS — manifest coerente con DMG e ZIP finali** |
| Integrità DMG/ZIP | `hdiutil verify`; `unzip -tq` | **PASS — DMG VALID CRC32 `564AC21B`; ZIP senza errori** |
| Firma intenzionalmente assente | `codesign` e `spctl` | **PASS COME VINCOLO DI PRODOTTO — ad-hoc/linker-signed, nessun TeamIdentifier; nessuna firma applicativa Developer ID valida** |
| Architettura e contenuto bundle | Mach-O, moduli nativi, app.asar e Info.plist | **PASS — tutto arm64; bundle id/versione/minimo macOS corretti; asar allowlist verificata** |
| Smoke bundle | `node scripts/smoke-packaged-macos.mjs --app release/mac-arm64/VincodeLab.app` | **PASS — 2.363 ms, graceful, temp rimossi** |
| Fault renderer packaged | stesso smoke con `--fault-recovery` | **PASS — 1.528 ms; contesto sostituito, registro main/marker recuperati, file su disco invariato** |
| Processi orfani | `processCleanup.remainingProcesses` | **PASS — `[]` in entrambi gli smoke** |
| SFTP loopback | `docs/qa/reliability-sftp-uat.json`; SHA-256 `fa019decd41cc562e4550fc82c80e794ac14930f50fa046c310b5fc6a256ecb3` | **VERIFICATO — fixture reale locale, cleanup 7/7 e zero residui alla scansione indipendente** |
| GitHub remoto | account/repository fixture + autorizzazione esplicita | **NON VERIFICATO — non autorizzato** |
| Database remoti | istanze fixture PostgreSQL/MySQL/SQL Server | **NON VERIFICATO** |
| Soak 8–12 ore | non eseguire | **ESCLUSO PER OVERRIDE UTENTE** |

## 10. Artefatti package finali e integrità

Package rigenerato dal `HEAD` `fae588d5d4b0116f2d1bd9d310d725a26961b1f3` con `mac.identity: null`:

| Artefatto | Dimensione | SHA-256 |
|---|---:|---|
| `VincodeLab-0.1.2-arm64.dmg` | 147.645.825 byte | `94c16381e867ca1cc3c76dbcddf29725f9f4b439f9999cab413806dc53ddb1b4` |
| `VincodeLab-0.1.2-arm64-mac.zip` | 145.264.639 byte | `25c3cbc7fb16b6e25546e5311336c6d89fba513377dccbc5e331c916e0267d01` |
| `app.asar` | 48.684.527 byte | `bf277762aab9094b206744c7f438ed15d91a82b712506ae5c18ed260dfeca188` |

`release/SHA256SUMS.txt` coincide con il ricalcolo degli artefatti. `hdiutil verify` dichiara il DMG valido con CRC32 `564AC21B`; `unzip -tq` non rileva errori. Il DMG è stato inoltre montato read-only e il ZIP letto in streaming: l'`app.asar` sorgente, quello nel DMG e quello nel ZIP hanno tutti SHA-256 `bf277762aab9094b206744c7f438ed15d91a82b712506ae5c18ed260dfeca188` (`all_match=true`); il mount temporaneo è stato rimosso. L'asar contiene 6.787 file e include fault injection, registro bozze e drain Database finali; non include `src`, test, script o documenti. App e moduli nativi sono arm64. `Info.plist` espone `com.vincodelab.app`, versione `0.1.2` e macOS minimo 12.0; icona sorgente e icona nel bundle sono state confrontate con hash identico.

La firma è intenzionalmente assente: `codesign -dv` mostra `Signature=adhoc`, flag `adhoc,linker-signed` e `TeamIdentifier=not set`. `codesign --verify --deep --strict` termina con exit 1 (`code has no resources but signature indicates they must be present`), quindi non esiste una firma applicativa valida. `spctl` restituisce exit 0 soltanto perché sulla macchina è attivo `override=security disabled`; non viene usato come prova di trust o notarizzazione.

## 11. Limiti e rischi residui

1. GitHub remoto resta non verificato perché mancano fixture e autorizzazione a mutazioni/push. Le simulazioni di auth failure, rete e cache non sostituiscono l'UAT.
2. PostgreSQL, MySQL e SQL Server reali non sono stati collaudati in questo ciclo; i fake driver provano soltanto il contratto di lifecycle/cancellation.
3. SFTP loopback e trasporto ControlMaster sono verificati; challenge interattivi e scenari reconnect completi del servizio gestito non lo sono.
4. I profili mostrano crescita heap piccola, monotona ma fortemente decelerante dopo GC; DOM, listener e processi si stabilizzano. Senza heap snapshot o uso prolungato non è una prova assoluta di assenza di leak.
5. Lo stress bounded non sostituisce il soak 8–12 ore, esplicitamente escluso dall'utente.
6. Il pacchetto personale non è firmato né notarizzato, può richiedere apertura manuale su macOS e non è certificato per distribuzione pubblica.
7. Il benchmark usa Electron di sviluppo e non il DMG installato; i campioni CPU sono puntuali e sensibili al carico di sistema.
8. Restano limiti P2 dichiarati: pruning della cronologia transfer renderer, dataset Database realistici/virtualizzazione, directory piatta da 100.000 entry, paginazione completa ProjectsV2 e CI/riproducibilità cross-machine.

## 12. Decisione finale

Stato: **APPROVATO PER INSTALLAZIONE PERSONALE LOCALE**.

Stato del goal globale: **NON COMPLETO** per gli UAT GitHub remoti e PostgreSQL/MySQL/SQL Server reali, che restano fuori dall'autorizzazione o senza fixture esterne disponibili.

Il candidato `fae588d5d4b0116f2d1bd9d310d725a26961b1f3` supera suite, lint, build, audit CSS, stress accelerato, benchmark/profilo con limiti dichiarati, UAT SFTP reale, packaging/integrità e smoke Electron normale e fault-recovery. Entrambi gli smoke terminano graceful, senza processi orfani e senza fixture residue. Non risultano P0 o P1 noti privi di correzione o recovery nei contratti esercitati.

L'approvazione è deliberatamente limitata all'installazione personale locale del package arm64 non firmato. Non certifica distribuzione pubblica, notarizzazione, GitHub remoto mutativo, database remoti reali, challenge/reconnect SSH completi o assenza assoluta di memory leak. Il soak 8–12 ore non è stato eseguito per override esplicito dell'utente e non viene rappresentato come superato.

Esito finale: **APPROVATO — 23 agosto 2026 — verifica automatizzata e audit Codex, con vincoli autorizzativi dell'utente**.
