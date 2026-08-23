# Error Experience — audit di implementazione

Data della ricognizione: **23 agosto 2026**

Worktree: ambiente di verifica dedicato al goal Error Experience (percorso locale omesso).

Branch: `codex/error-experience`

Questo documento certifica il goal **VincodeLab Complete Error Handling, User Feedback & Recovery UX** sul candidato costruito il **23 agosto 2026**. Implementazione, gate statici, package personale macOS arm64 e collaudo Electron packaged normale/fault-recovery sono completati sullo stesso stato applicativo. Il package è destinato all'uso personale: electron-builder è configurato con `identity: null`, quindi non usa una firma Developer ID né un Team ID.

> **Confine dell'evidenza:** il collaudo runtime è stato eseguito realmente sul package macOS arm64 tramite un profilo temporaneo isolato e CDP confinato a loopback. La matrice dei domini usa failure sintetici controllati al vero confine IPC; persistenza corrotta, crash React locale e `Page.crash` sono fault runtime reali. Non sono stati contattati provider AI, host GitHub, database o server SFTP esterni reali. VoiceOver e una revisione visuale umana assistita non sono stati automatizzati.
>
> **Soak escluso:** il soak da 8–12 ore non fa parte di questo ciclo, come richiesto. Non è un criterio di chiusura del goal Error Experience.

## Legenda

- **IMPLEMENTATO**: il comportamento è presente nel sorgente corrente.
- **COPERTO AUTO**: esistono test automatici mirati per il comportamento indicato.
- **VERIFICATO PACKAGED**: il percorso è stato attraversato nell'app Electron impacchettata.
- **VERIFICATO SERVIZIO/FIXTURE**: il dominio è coperto dal servizio reale con fixture locale o driver simulato controllato.

## Stato sintetico

| Area | Stato sorgente | Evidenza automatica | Runtime Electron |
| --- | --- | --- | --- |
| Tassonomia, correlation ID, diagnostica e logging | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED** |
| ErrorNotice, toast deduplicati, Error Boundary e global handler | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED** |
| Electron main, startup fatal, preload, IPC e renderer recovery | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED** |
| Workspace, persistenza e lifecycle di chiusura | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED** |
| Editor, filesystem e conflitti esterni | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED + FIXTURE** |
| Terminale, xterm, PTY e feedback secondari | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED + FIXTURE** |
| AI | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED al confine IPC** |
| Git e GitHub | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED + REPOSITORY FIXTURE** |
| Database | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED + SQLITE/DRIVER** |
| SSH, SFTP e file remoti | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED + LOOPBACK FIXTURE** |
| Impostazioni, aggiornamenti, pacchetti e skill | **IMPLEMENTATO** | **COPERTO AUTO** | **VERIFICATO PACKAGED/COMPONENTE** |
| Gate statici finali, suite completa, build e package | **COMPLETATO** | **1.007 TEST VERDI: 783 NODE + 224 COMPONENTI** | **PACKAGE E SMOKE VERDI** |

## Architettura centralizzata implementata

Il percorso comune è ora:

```text
errore tecnico
  → classificazione nel dominio che lo conosce
  → codice pubblico + correlation ID ERR-XXXXXX
  → log locale con soli metadati allowlisted
  → messaggio utente contestuale
  → una sola superficie primaria
  → recovery locale che conserva lo stato
```

### Fondazioni

| Capacità | Implementazione corrente | Evidenza |
| --- | --- | --- |
| Tassonomia comune | `src/lib/user-error.js` e `electron/application-error.cjs` condividono 17 categorie: validation, not-found, permission, authentication, network, timeout, cancelled, conflict, process, database, filesystem, git, github, remote, configuration, persistence, internal. | `test/user-error.test.mjs`, `test/application-error.test.cjs` |
| Confine IPC | Tutti gli handler installati tramite `ipcMain.handle` vengono avvolti centralmente. Successi sync/async restano invariati; rejection e throw ricevono categoria, codice, operation e correlation ID pubblici. | `test/application-error.test.cjs`, `test/preload-surface.test.cjs` |
| Testo utente separato dal dettaglio tecnico | `normalizeUserError` produce titolo/descrizione pubblici e conserva un `technicalMessage` sanitizzato solo per diagnostica. Il renderer non presenta direttamente le proprietà `.message` selezionate. | `test/renderer-error-copy.test.mjs`, `test/user-error.test.mjs` |
| Correlation ID | Gli incidenti significativi ricevono un ID breve `ERR-XXXXXX`, preservato attraverso main, IPC, renderer, UI e log. | `test/application-error.test.cjs`, `test/logger.test.cjs`, `test/fatal-error-experience.test.cjs` |
| Logging | `electron/logger.cjs` usa debug/info/warning/error, coda e rotazione bounded, allowlist dei campi e parsing rigoroso degli eventi renderer. Query, token, connection string e percorsi privati non vengono accettati come metadati arbitrari. | `test/logger.test.cjs` |
| Diagnostica | `ErrorNotice` rende i dettagli solo su richiesta e copia categoria, codice, componente, operazione, data e correlation ID con redazione dei dati sensibili. Nessuno stack trace viene mostrato automaticamente. | `test/components/error-notice.test.tsx` |
| Superfici Graphite/Ark | `ErrorNotice`, Ark `Toast.ActionTrigger`, `Field.ErrorText`, `Dialog` e gli Error Boundary usano semantic token e recipe Graphite; sono presenti ruoli alert/status, tastiera e reduced motion. | `test/components/error-notice.test.tsx`, `test/components/toast-error-experience.test.tsx`, `test/ui-design-system.test.cjs` |
| Error storm protection | Il toast store supporta dedupe key, grouping, conteggio, cooldown, update della notifica e registro bounded. | `test/components/toast-error-experience.test.tsx` |
| Error Boundary | Boundary globale e boundary locali confinano il crash, assegnano correlation ID, offrono retry locale e diagnostica; la shell resta montata quando fallisce una vista. | `test/components/app-error-boundary.test.tsx`, `test/components/volatile-draft-recovery.test.tsx` |
| Ultima rete renderer | `src/lib/global-error-handlers.ts` intercetta `error` e `unhandledrejection`, ignora le cancellazioni attese, registra l'incidente e presenta un toast deduplicato con recovery. | `test/components/global-error-handlers.test.tsx` |

## Mappa operazione → errore → ownership → recovery

La regola applicata è: **l'owner che avvia l'operazione possiede la superficie primaria**. Main, logger, global handler e boundary superiori possono osservare o confinare, ma non devono duplicare lo stesso messaggio.

| Operazione / area | Errori classificati o confinati | Gestione e messaggio implementati | Owner / superficie primaria | Recovery e stato preservato | Stato |
| --- | --- | --- | --- | --- | --- |
| Avvio main | startup DB/registry/menu/window fallito; exception main; rejection in background | `electron/fatal-error-experience.cjs` mostra testo sicuro, correlation ID e diagnostica copiabile; le cancellazioni attese non aprono dialog. | Main / dialog Electron fatal | Riprova avvio o riavvia; copia diagnostica; uscita deterministica. | **IMPLEMENTATO · COPERTO AUTO** (`test/fatal-error-experience.test.cjs`) |
| Preload | preload mancante o exception prima del bridge | `electron/preload-error-experience.cjs` classifica e registra senza path/raw message, poi usa lo stesso controller del renderer. | Main / dialog di recovery renderer | Ricarica solo l'interfaccia; recovery disponibile anche con logger degradato. | **IMPLEMENTATO · COPERTO AUTO** (`test/preload-error-experience.test.cjs`) |
| Renderer process/load | crash, killed, OOM, integrity failure, main-frame load failure | `renderer-recovery-controller.cjs` coalesca incidenti, ignora abort/frame secondari e correla il dialog. Main drena le operazioni Database possedute dal renderer. | Main / dialog Electron | Ricarica solo renderer; servizi main e stato persistito restano disponibili. | **IMPLEMENTATO · COPERTO AUTO · VERIFICATO PACKAGED** (`Page.crash` reale) |
| IPC invoke | throw sync, rejection, timeout, cancellation, errore di dominio | Boundary centrale genera codice pubblico e correlation; il renderer ricostruisce un `UserError` senza mostrare il raw Node/driver. | Main classifica e logga; initiator renderer presenta | Retry contestuale o nessuna UI per cancellation. | **IMPLEMENTATO · COPERTO AUTO** |
| Aprire/cambiare workspace | not-found, permission, conflitto tra finestre, richiesta stale, Pi non avviato, flush layout fallito | `src/App.tsx` mantiene una failure tipizzata e usa `ErrorNotice`; le richieste fuori ordine non sovrascrivono quella più recente. | Shell workspace / callout inline | Riprova apertura; ritorno Home; stato precedente e viste persistenti restano intatti. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/app-workspace-open-races.test.tsx`) |
| Sessione workspace | read/save IPC, payload invalido, save debounced fallito | `workspace-session.ts` conserva lo stato dirty e chiude ogni Promise in success/error; App espone un avviso persistente correlato. | Shell workspace / `ErrorNotice` | “Salva di nuovo”; nessun cambio workspace se il flush necessario fallisce. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/workspace-session-client.test.tsx`) |
| Persistenza workspace corrotta | JSON invalido, schema non valido, payload oversized | Lo store elimina soltanto il record corrotto, restituisce default più `{kind: 'corrupt', correlationId}` e registra l'evento; la shell dichiara il ripristino. | Shell workspace / callout inline | Continua con default; lettura successiva sana; nessun payload copiato. | **IMPLEMENTATO · COPERTO AUTO** (`test/workspace-session-store.test.cjs`, test App) |
| Chiusura/cambio con modifiche | save/discard/flush fallito, richieste lifecycle duplicate o stale | I guard delle viste restano owner locali; il coordinatore annulla la chiusura e non aggiunge un toast duplicato. | Dialog di conferma + superficie locale della vista | Save/Discard/Cancel exactly-once; draft e finestra restano aperti sul failure. | **IMPLEMENTATO · COPERTO AUTO** (test App e guard viste) |
| Explorer/apertura file | file inesistente, permission, binary/preview non supportata, file grande, race di apertura | Editor usa `ErrorNotice` locale per Explorer o tab, correlation e recovery; loading sempre chiuso. | Explorer o tab Editor | Aggiorna Explorer, riapri il solo file; altri tab e history CodeMirror restano montati. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/project-editor-state-tree.test.tsx`) |
| Salvataggio file locale | permission, write failure, file eliminato o modificato esternamente | `project-files.cjs` richiede una revisione content/stat e rifiuta il write stale con `FILESYSTEM_EXTERNAL_CONFLICT`; Editor non sovrascrive implicitamente e conserva il buffer. | Tab Editor / `ErrorNotice`, poi dialog solo per la decisione | Ricarica dal disco oppure sovrascrivi dopo conferma esplicita; retry save per gli altri failure. | **IMPLEMENTATO · COPERTO AUTO** (`test/project-files.test.cjs`, test Editor state tree) |
| Istruzioni e skill progetto | load/save/discard fallito, selezione concorrente, write tardiva | `project-instructions.tsx` e `project-skills.tsx` hanno failure locali correlati, recovery e draft preservato. | Pannello risorsa / `ErrorNotice` | Riprova la sola lettura/scrittura; selezione, contenuto e focus restano correnti. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/project-resources-workspace-guard.test.tsx`) |
| Bootstrap multi-terminale | list/create/focus/resume fallito, shell assente | `terminal-workspace.tsx` termina sempre loading/creating, mostra errore locale e non rimonta le altre viste. | Workspace Terminale / `ErrorNotice` | Riprova bootstrap o singola sessione. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/terminal-workspace-sessions.test.tsx`) |
| PTY write/resize/ready/ack/disconnect | rifiuto di un evento fire-and-forget, sessione stale, trasporto non collegato | `shell-session-error-event.cjs` trasforma il failure in evento IPC sanitizzato e correlato; `FreeTerminal` lo mostra soltanto nella sessione interessata. | Sessione terminale / `ErrorNotice` | Resume output, resize o restart in base all'operazione; storico e altre sessioni preservati. | **IMPLEMENTATO · COPERTO AUTO** (`test/shell-session-error-event.test.cjs`) |
| Exit e restart shell | PTY terminato, restart fallito, exit infrastrutturale | `FreeTerminal` distingue chiusura normale da terminazione inattesa e offre restart locale; gli exit ordinari dei comandi dentro la shell non generano toast. | Sessione terminale | Riavvia la shell; scrollback conservato. | **IMPLEMENTATO · COPERTO AUTO · VERIFICATO PACKAGED** per il fault infrastrutturale PTY |
| Clipboard terminale | read/write negato | Errore permission correlato e inline; non distrugge selezione né sessione. | Sessione terminale / `ErrorNotice` | Riprova copia o incolla; i test verificano che il secondo tentativo completi l'operazione. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/free-terminal-clipboard-recovery.test.tsx`, 2 casi) |
| Diagnostica e allegati terminale | lettura metriche, export report, file picker falliti | Diagnostica mantiene le ultime metriche e usa `ErrorNotice`; gli allegati usano toast transitorio deduplicato, correlato e con retry. | Pannello diagnostica o initiator allegato | Rileggi, riesporta o scegli di nuovo il file. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/terminal-secondary-error-experience.test.tsx`) |
| AI startup/reload/restart/output | runtime/config/provider assente, auth, rate limit, timeout, crash, cancellation, output non collegato | `src/App.tsx` mappa configuration/provider/rate/timeout/cancel e usa un solo `AiSessionErrorNotice`; signal, exit code e raw provider non compaiono nel copy principale. | Vista AI / `ErrorNotice` | Apri impostazioni, riprova, riavvia sessione o ricollega output; xterm e contenuto utile restano montati. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/app-workspace-open-races.test.tsx`, `test/pi-session-controller.test.cjs`) |
| Git status/repository | Git assente, non-repository, repository invalido, detached HEAD, permission, timeout | `github-service.cjs` normalizza i failure senza comando/stdout/stderr; la UI distingue davvero “non repository” da `gitStatus` fallito e conserva l'ultimo snapshot valido. | Vista Git / `ErrorNotice` locale | Riprova sola lettura, inizializza solo per il vero non-repository, aggiorna stato dopo conflitto. | **IMPLEMENTATO · COPERTO AUTO** (`test/github-error-experience.test.cjs`, test GitHub races) |
| Mutazioni Git | stage/unstage/commit/branch/pull/push/revert, conflict, upstream/remote mancante | Codice e copy sono specifici; il comando concettuale è implicito nel titolo, mentre l'output tecnico resta solo nella diagnostica sanitizzata. | Pannello Git interessato | Refresh sicuro dopo esito ambiguo; non ripete automaticamente una mutazione. | **IMPLEMENTATO · COPERTO AUTO** |
| GitHub | CLI assente, auth, scope/permission, rete, timeout, rate limit, repo/branch non trovato, conflict, risposta invalida | Backend distingue le categorie e DTO degradati; UI possiede errori per dati, issue, diff e Project, deduplica i refresh e preserva moduli/board/diff validi. | Regione GitHub interessata / `ErrorNotice` | Login/configurazione quando richiesto, attesa/retry di sola lettura, refresh mirato; nessuna mutazione ripetuta automaticamente. | **IMPLEMENTATO · COPERTO AUTO** (`test/github-error-experience.test.cjs`, `test/components/github-workspace-races.test.tsx`) |
| Connessione Database | auth, permission, host irraggiungibile, timeout, connection lost, DB non trovato | `database-service.cjs` normalizza errori PostgreSQL/MySQL/SQL Server/SQLite in categorie comuni e conserva il diagnostico originale sanitizzato. Le sessioni remote confinano eventi error/end/close e consentono riapertura. | Selettore/risorsa Database / `ErrorNotice` | Riconnetti o riprova lettura; SQL, risultati e layout restano disponibili. | **IMPLEMENTATO · COPERTO AUTO** (`test/database-service.test.cjs`, `test/sqlite-worker-session.test.cjs`) |
| Query Database | syntax/query failure, constraint, permission, timeout, cancellation, risultato oversized | Loading/executing/cancelling chiudono in ogni esito; query error e cancel fallito restano locali. La cancellation raggiunge i driver e una nuova query può partire senza rimontare la vista. | Editor SQL / `ErrorNotice` | Riprova query o annulla di nuovo; query corrente e risultati precedenti preservati. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/database-workspace-recovery.test.tsx`) |
| Cronologia query | query riuscita ma history write/refresh fallita | Il risultato resta riuscito; `historyRecorded` separa il side effect. La recovery non riesegue mai la query mutativa. | Risultati Database / warning `ErrorNotice` | Aggiorna cronologia o copia query. | **IMPLEMENTATO · COPERTO AUTO** |
| Griglia/transazioni Database | riga stale, constraint, begin/commit/rollback/save fallito, cambio risorsa dirty | Guard locale e transazioni preservano i draft; save/discard failure non duplica toast e blocca il cambio fino alla decisione. | Griglia Database / `ErrorNotice` + dialog guard | Riprova save/discard/refresh/rollback; draft celle conservato. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/database-workspace-guard.test.tsx`) |
| SSH/SFTP connessione e browse | host/auth/host-key, rete, timeout, permission, not-found, OpenSSH/SFTP assente | `sftp-service.cjs` classifica segnali OpenSSH/SFTP in copy sicuro e metadati allowlisted. La UI mantiene spinner scoped, errori browse/local-copy e stato degraded locale. | Pannello File remoti / `ErrorNotice` | Riconnetti, aggiorna cartella o riprova; copie locali preservate. | **IMPLEMENTATO · COPERTO AUTO** (`test/sftp-service.test.cjs`, `test/managed-ssh-service.test.cjs`) |
| Transfer remoto | interruzione, cancel, no space, permission, conflict, timeout, processo SFTP | Riga transfer indica file/stato; failure locale correlato e retry solo se sicuro. Temporanei sono rimossi best-effort con log separato. | Regione Trasferimenti / `ErrorNotice` | Riprova transfer o riconnetti; cancellation non è error. | **IMPLEMENTATO · COPERTO AUTO** (`test/remote-file-service.test.cjs`, `test/components/remote-transfer-retry.test.tsx`) |
| Upload e copia locale atomica | remoto cambiato, rename/chmod fallito, write/cache/rollback fallito | Upload usa temporaneo e rename finale; il compare blocca overwrite implicito. Se il rollback locale è incompleto, il failure viene elevato invece di essere nascosto; cleanup non critici restano correlati nei log. | Editor remoto o File remoti | Confronta, ricarica, forza solo dopo conferma, retry cleanup/operazione. | **IMPLEMENTATO · COPERTO AUTO** (`test/remote-file-store.test.cjs`, `test/remote-file-service.test.cjs`) |
| Preferenze | load/save/reset/clear fallito, validation numerica, mutation race | Settings usa `ErrorNotice` di sezione o `Field.ErrorText` sulla singola preferenza; niente toast duplicato. Mantiene valore tentato e baseline precedente. | Riga preferenza o sezione Settings | Riprova, Ripristina, Riprova preferenze; reset globale resta confermato. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/settings-preference-errors.test.tsx`, `test/components/settings-preferences-recovery.test.tsx`) |
| Pi config, pacchetti, skill, aggiornamenti | startup config, install/remove, load/save skill, check/download/rollback fallito | Ogni sottosezione ha failure tipizzata locale, busy terminale e recovery specifica. Draft di package/skill e versione attiva restano invariati sul failure. | Sottosezione Settings / `ErrorNotice` o errore campo | Riapri configurazione, riprova operazione o verifica di nuovo. | **IMPLEMENTATO · COPERTO AUTO** (`test/components/settings-error-experience.test.tsx`) |
| Shell app: tema, Quick Open, comandi, menu contestuale, nuova finestra, contesto AI | IPC/rejection, indice parziale, comando fallito, picker/context menu non aperto | `src/App.tsx` passa i failure transitori dal normalizzatore, include correlation e recovery, preserva selezione/workspace/stato precedente. | Initiator / toast transitorio deduplicato oppure callout Home/workspace | Riprova, riapri palette, scegli cartella o nuova finestra senza distruggere lo stato corrente. | **IMPLEMENTATO · COPERTO AUTO · VERIFICATO PACKAGED** |

## Ownership visuale applicata

| Tipo di incidente | Superficie primaria | Regola |
| --- | --- | --- |
| Validation di un controllo | `Field.ErrorText` | Vicino al campo; focus resta sul controllo; niente toast. |
| Failure locale recuperabile | `ErrorNotice` nella vista/tab/pannello | Titolo, impatto/stato preservato, recovery primaria, riferimento e dettagli su richiesta. |
| Sezione degraded/offline | `ErrorNotice` persistente | Non scompare automaticamente; il resto della shell continua a funzionare. |
| Failure transitorio non bloccante | Toast Ark con dedupe/recovery | Nessun equivalente inline; non sposta il focus. |
| Decisione o rischio perdita dati | Dialog Ark/Electron | Default non distruttivo; nessun toast parallelo. |
| Crash React locale | `ViewErrorBoundary` | Retry della sola vista; shell e viste persistenti restano montate. |
| Crash/load/preload renderer | Controller main | Ricarica soltanto l'interfaccia; incidenti coalescati. |
| Startup/main fatal | Dialog Electron fatal | Correlation, copia diagnostica, restart/exit deterministico. |
| Cancellation attesa | Stato/info locale o nessuna superficie | Non viene presentata né loggata come errore grave. |

## Fault injection disponibile

È stata aggiunta un'infrastruttura opt-in, non raggiungibile nel normale uso dell'app:

- `electron/reliability-fault-injection.cjs` è attivo solo quando sono presenti **entrambi** i flag benchmark e fault-injection;
- il preload espone il bridge di fault soltanto nella stessa modalità doppia;
- `ipc-rejection` genera una rejection reale classificata e correlata, con dettaglio sintetico volutamente sensibile per verificare la redazione;
- `persistence-corrupt` inserisce realmente uno snapshot workspace non valido, one-shot;
- lo smoke usa `Page.crash` via CDP per terminare realmente il renderer;
- dopo ogni fault lo smoke esegue un probe sano e verifica i correlation ID nei log sanitizzati;
- per il crash renderer verifica anche che la bozza Editor passi dal registro main e torni visibile dopo il reload.

Test del controller/harness già presenti:

- `test/reliability-fault-injection.test.cjs`;
- `test/packaged-macos-smoke.test.mjs`;
- `test/renderer-recovery-controller.test.cjs`;
- `test/components/app-workspace-open-races.test.tsx` per il messaggio della persistenza corrotta.

### Matrice fault

| Fault | Evidenza automatica e recovery | Verifica Electron packaged |
| --- | --- | --- |
| IPC rejection | Rejection reale dell'handler opt-in; classificazione, redazione, correlation nel log e chiamata sana successiva. | **VERIFICATO PACKAGED** |
| Persistenza corrotta | Snapshot realmente corrotto, fallback dichiarato, nuova scrittura e lettura sana senza esporre il payload. | **VERIFICATO PACKAGED** |
| Renderer process crash | `Page.crash` reale via CDP; nuovo renderer, bozza recuperata dal main e nuova chiamata sana. | **VERIFICATO PACKAGED** |
| React view crash | Throw React reale nell'Editor; focus confinato, shell operativa, retry locale, bozza e modalità sorgente Markdown preservate. I boundary delle altre viste hanno copertura componente e condividono lo stesso refresh della sessione viva. | **VERIFICATO PACKAGED** nell'Editor; **COPERTO AUTO** per i boundary locali |
| AI crash | Incidente di dominio controllato al vero confine IPC; copy specifico, correlation, diagnostica sanitizzata e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| PTY failure | Incidente infrastrutturale controllato al confine IPC; recovery disponibile e nuova operazione sana. Gli exit ordinari dei comandi restano non invasivi. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| File inesistente | Incidente filesystem controllato al confine IPC; file indicato in modo sicuro, recovery e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| Permission file | Incidente permission distinto dal not-found; copy contestuale, correlation e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| Git failure | Incidente Git controllato al confine IPC, senza scaricare output grezzo nell'interfaccia; recovery e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| GitHub network | Incidente rete GitHub distinto da auth/rate/permission; recovery e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| Database connection | Incidente connessione controllato, distinto dal failure di query; stato preservato e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| Database query | Incidente query controllato, localizzato nell'area SQL; recovery e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| SFTP failure | Incidente remoto controllato con file/operazione/stato sanitizzati; recovery e probe sano. | **VERIFICATO PACKAGED — FAULT IPC CONTROLLATO** |
| Settings persistence/config/update | Errori di campo e sezione, race e conservazione del valore tentato/versione attiva. | **COPERTO AUTO** con test componente e store |
| Clipboard denial | Due test UI: copy negato → retry riuscito con selezione preservata; paste negato → retry riuscito e write alla shell. | **COPERTO AUTO** (`test/components/free-terminal-clipboard-recovery.test.tsx`) |

I nove incidenti di dominio verificati nel package sono: AI crash, PTY failure, file inesistente, permission file, Git failure, GitHub network, connessione Database, query Database e SFTP. Sono fault controllati al confine IPC reale dell'app impacchettata: verificano trasporto, classificazione, UI, redazione, logging, recovery e nuova operazione sana, ma non equivalgono a chiamate verso endpoint esterni reali.

Il collaudo fault-recovery è stato eseguito sul bundle corrente con:

```sh
node scripts/smoke-packaged-macos.mjs --app release/mac-arm64/VincodeLab.app --fault-recovery --json
```

Esito: **verde (`ok: true`)**. Tutti gli incidenti hanno prodotto copy azionabile, correlation ID coerente con i log sanitizzati, recovery e una chiamata successiva sana. Anche la pulizia del processo e del profilo temporaneo è terminata correttamente.

## Test automatici presenti

Le suite mirate coprono già:

- tassonomia, trust del messaggio, correlation e privacy: `test/user-error.test.mjs`, `test/application-error.test.cjs`, `test/logger.test.cjs`;
- startup/preload/renderer recovery: `test/fatal-error-experience.test.cjs`, `test/preload-error-experience.test.cjs`, `test/renderer-recovery-controller.test.cjs`;
- UI/a11y/dedupe/recovery: `test/components/error-notice.test.tsx`, `test/components/toast-error-experience.test.tsx`, `test/components/global-error-handlers.test.tsx`, `test/components/app-error-boundary.test.tsx`;
- workspace e persistenza: `test/workspace-session-store.test.cjs`, `test/components/workspace-session-client.test.tsx`, `test/components/app-workspace-open-races.test.tsx`;
- Editor e guard dei draft: `test/project-files.test.cjs`, `test/components/project-editor-state-tree.test.tsx`, `test/components/project-resources-workspace-guard.test.tsx`, `test/components/volatile-draft-recovery.test.tsx`;
- Terminale: `test/shell-session-error-event.test.cjs`, `test/components/terminal-workspace-sessions.test.tsx`, `test/components/terminal-secondary-error-experience.test.tsx`, `test/components/free-terminal-clipboard-recovery.test.tsx` e le suite shell/stream esistenti;
- Git/GitHub: `test/github-error-experience.test.cjs`, `test/components/github-workspace-races.test.tsx` e le fixture repository locali;
- Database: `test/database-service.test.cjs`, `test/sqlite-worker-session.test.cjs`, `test/components/database-workspace-recovery.test.tsx`, `test/components/database-workspace-guard.test.tsx`;
- remoto: `test/sftp-service.test.cjs`, `test/managed-ssh-service.test.cjs`, `test/remote-file-service.test.cjs`, `test/remote-file-store.test.cjs`, `test/components/remote-transfer-retry.test.tsx`;
- Settings: `test/components/settings-error-experience.test.tsx`, `test/components/settings-preference-errors.test.tsx`, `test/components/settings-preferences-recovery.test.tsx`;
- fault harness: `test/reliability-fault-injection.test.cjs`, `test/packaged-macos-smoke.test.mjs`;
- gate di architettura UI e copy renderer: `test/ui-design-system.test.cjs`, `test/renderer-error-copy.test.mjs`.

Il rerun completo finale è verde con **1.007 test**: **783 Node** e **224 componenti**. Il totale comprende un test Node di compatibilità workspace session v1, un test componente di compatibilità v1 e i due nuovi casi Clipboard.

## Esito audit finale e limiti dell'evidenza

Non risultano blocker conosciuti per il goal Error Experience:

1. **Copy e separazione tecnica/utente verificati.** Il fallback pubblico è specifico e non presenta più `Operazione non riuscita.`, stack trace o raw message non attendibili. I gate lessicali e i test con errori ostili verificano anche getter/Proxy non sicuri e redazione privacy.
2. **Failure silenziosi verificati staticamente.** Non risultano failure importanti conosciuti assorbiti senza decisione. Cleanup, cancellazioni e callback osservativi restano deliberatamente non invasivi; il logging renderer passa dal punto centrale previsto.
3. **Ownership e storm protection verificati.** Errori locali, toast transitori, dialog e boundary hanno un owner primario; deduplica, grouping e cooldown impediscono duplicazioni e raffiche.
4. **Clipboard Terminale coperta.** I due casi mirati provano errore contestuale sanitizzato, stato preservato, retry e successiva operazione riuscita.
5. **Stato e viste persistenti protetti.** I failure gestiti e la navigazione non rimontano xterm, CodeMirror o le altre viste persistenti. Dopo un crash React, il boundary rimonta soltanto la vista coinvolta: il retry aggiorna lo snapshot vivo e conserva bozza, file attivo e modalità sorgente Markdown.
6. **Artefatti e runtime verificati.** Build, package personale, smoke normale e fault-recovery sono verdi sul bundle arm64 corrente.

Limiti dichiarati, che non costituiscono blocker per questa certificazione:

- i nove fault di dominio packaged sono controllati al confine IPC e non usano provider AI, GitHub, database o SFTP esterni reali; le suite di servizio/fixture coprono repository, SQLite/driver e SFTP loopback;
- focus e recovery sono stati verificati automaticamente nel package, mentre una sessione visuale umana assistita e VoiceOver non sono automatizzati in questo ciclo;
- il soak da 8–12 ore è stato esplicitamente escluso e non è un criterio di accettazione di questo goal.

## Gate di certificazione

| Gate | Comando / prova | Esito |
| --- | --- | --- |
| Diff | `git diff --check` | **VERDE** |
| Unit + componenti | `npm test` | **VERDE**: **1.007 test**, 783 Node + 224 componenti |
| Lint | `npm run lint` | **VERDE** |
| Type-check + build | `npm run build` | **VERDE**; resta soltanto il warning informativo del chunk >500 kB |
| Design system Graphite/Ark/Panda | `npm run audit:css:check` | **VERDE**: 5 file CSS, 49 selettori, 0 collisioni di selettori/proprietà, 0 `!important`, 0 colori locali, 0 selettori tema nelle viste |
| Gate testi/catch/ownership | grep statici + review | **VERDE**; nessun residuo importante conosciuto |
| Package personale senza Developer ID | `npm run package` con `identity: null` | **COMPLETATO**: `.app`, DMG e ZIP macOS arm64; nessun Team ID |
| Smoke packaged normale | profilo temporaneo isolato, output JSON | **VERDE (`ok: true`)**: renderer, navigazione, fixture workspace, moduli nativi e cleanup |
| Smoke fault recovery | comando `--fault-recovery --json` | **VERDE (`ok: true`)**: 9 fault dominio, IPC rejection, corruzione reale, crash React reale e `Page.crash` reale |
| Collaudo Electron automatizzato | package arm64, CDP loopback, focus/recovery/stato | **VERDE**; sessione umana/VoiceOver dichiarata separatamente come limite di evidenza |
| Soak 8–12 ore | escluso dal ciclo su richiesta | **NON RICHIESTO** |

## Condizione di chiusura

Il candidato soddisfa la condizione di chiusura del goal:

- i failure point principali sono classificati e possiedono una superficie coerente;
- copy utente e dettaglio tecnico sono separati e la diagnostica è sanitizzata;
- correlation ID e log locali coincidono senza esporre dati sensibili;
- recovery locale, nuova operazione sana e conservazione dello stato sono provate;
- deduplica, loading terminali e boundary eliminano i failure silenziosi, gli spinner infiniti e i crash globali conosciuti;
- lint, build, audit Graphite, diff, package e i due smoke packaged sono verdi;
- il package macOS arm64 personale è prodotto con `identity: null`, senza firma Developer ID;
- il soak 8–12 ore non è richiesto.

Questo file costituisce la **certificazione finale dell'implementazione e del runtime packaged**.
