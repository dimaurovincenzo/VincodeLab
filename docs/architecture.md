# Architettura

Ogni istanza Electron di VincodeLab gestisce una finestra e un workspace attivo. Un altro workspace può essere aperto in una nuova istanza coordinata; all'interno della finestra, le viste operative condividono il contesto senza ottenere accesso diretto alle capacità native.

## Componenti principali

| Livello | Percorsi principali | Responsabilità |
| --- | --- | --- |
| Renderer | `src/app/`, `src/features/`, `src/bridge/`, `src/components/`, `src/lib/` | Composizione React, capacità verticali, confine Electron e codice condiviso |
| Design system | `src/components/ui/`, `src/theme/`, `panda.config.ts` | Primitive Ark UI, componenti Park-style, token e recipe Graphite |
| Preload | `electron/preload/` → `electron/preload.cjs` | Sorgenti canoniche dell'API `window.vincodeLab` e artefatto runtime generato |
| Processo principale | `electron/app/`, `electron/domains/`, `electron/infrastructure/`, `electron/ipc/`, `electron/main.cjs` | Composition root, lifecycle, use case, adapter e boundary IPC |
| Persistenza | `electron/infrastructure/persistence/` | Repository SQLite, preferenze e metadati per workspace |
| Verifica | `test/`, `scripts/` | Test di contratto/componenti, benchmark, stress e smoke del bundle |

Il renderer usa TypeScript e moduli ES. I servizi Electron sono CommonJS perché vengono caricati direttamente dal processo principale e dal preload.

## Confine di sicurezza

```text
contenuto del workspace
          │
          ▼
 React renderer (sandbox, nessun Node.js)
          │ src/bridge
          │ window.vincodeLab
          ▼
 preload / contextBridge
          │ IPC nominato
          ▼
 Electron main ──► filesystem, PTY, CLI, rete e database
```

La finestra abilita `contextIsolation` e `sandbox`, disabilita `nodeIntegration` e nega nuove finestre e navigazioni non previste. Il main verifica che gli eventi IPC provengano dalla finestra autorizzata; i singoli servizi validano poi percorsi, identificatori, dimensioni e valori di dominio.

Principi da preservare:

- nessuna API generica per eseguire codice o accedere a percorsi arbitrari dal renderer;
- superficie preload minima, nominata e dichiarata anche in `src/vincode-lab.d.ts`;
- accesso a `window.vincodeLab` confinato in `src/bridge/`; le feature consumano adapter tipizzati dalla propria cartella `api/`;
- output tecnici e segreti filtrati prima di attraversare l'IPC;
- operazioni remote o distruttive esplicite e annullabili quando possibile;
- Content Security Policy identica tra sviluppo e build, salvo gli endpoint loopback necessari a Vite.

## Moduli e dipendenze

La migrazione strutturale usa un monolite modulare: Feature-Sliced Architecture pragmatica nel renderer e Clean Architecture pragmatica con Ports & Adapters nel processo Electron.

```text
src/main.tsx
    └── src/app
          ├── src/features/<nome>/index.ts
          └── componenti condivisi

feature ──► API pubblica di altre feature, src/bridge, components/ui, theme, lib

electron/main.cjs e app/bootstrap.cjs    composition root
    ├── electron/app                     orchestrazione applicativa
    ├── electron/ipc/domains             adapter IPC con dipendenze iniettate
    ├── electron/infrastructure ────────► electron/domains
    └── electron/domains                 use case, policy e modelli

electron/preload/ ──bundle deterministico──► electron/preload.cjs ──IPC──► main
```

Ogni feature espone un ingresso pubblico `index.ts`; tutti i consumer esterni, compreso `src/app`, devono usarlo. Lo stesso vale per `@/components/ui` e `@/bridge`. Una feature non dipende dalla composition root renderer, i componenti condivisi non dipendono da feature e il tema non dipende dalla UI. Il renderer non importa moduli Electron.

Nel backend `electron/main.cjs` e `electron/app/bootstrap.cjs` sono gli unici composition root. Gli altri moduli application e i domini non dipendono dagli adapter; infrastructure implementa le porte concrete e i registrar IPC ricevono i collaboratori dal main. La radice `electron/` è riservata alla composition root e all'artefatto preload generato. Il preload è un confine isolato e può importare soltanto altri moduli canonici sotto `electron/preload/` oltre al pacchetto `electron`.

I template dei menu restano trasformazioni pure sotto `electron/domains/menu/`. Il routing dei comandi contestuali appartiene invece all'application layer in `electron/app/context-command-runtime.cjs`; clipboard, dialog, Finder e l'esecuzione bounded di `/usr/bin/open` sono confinati dall'adapter `electron/infrastructure/menu/context-command-host.adapter.cjs` e collegati esclusivamente dalla composition root.

`npm run check:architecture` analizza import, export, `require`, import dinamici e accessi al preload tramite AST TypeScript. Blocca deep import, dipendenze inverse, path legacy rimossi e cicli. Oxlint esegue inoltre `import/no-cycle` sul grafo completo.

I registratori in `electron/ipc/domains/` dichiarano manifesti invoke/send, ricevono dipendenze dalla composition root e lasciano alla boundary IPC globale la trasformazione degli errori. Le sorgenti preload sono modulari; `scripts/build-preload.mjs` genera deterministicamente `electron/preload.cjs`, mentre `npm run check:preload` impedisce drift dell'artefatto senza ridurre `sandbox` o `contextIsolation`.

L'apertura di un workspace in una nuova istanza è coordinata dal caso d'uso `electron/domains/workspace/workspace-instance-use-cases.cjs`. Il lock di lancio, la validazione e il mapping dei failure rimangono privati al dominio; l'handler Workspace verifica il sender e delega, senza possedere stato di processo.

## Domini applicativi

### Shell e Pi

`node-pty` ospita sia le sessioni shell sia Pi Coding Agent. Il main possiede processi, backpressure, cronologia e lifecycle; xterm si occupa soltanto della presentazione e dell'input. Le viste terminale rimangono montate durante la navigazione per preservare sessione e viewport.

Nel renderer `src/features/terminal/` possiede i controller canonici delle sessioni shell, della libreria comandi e delle connessioni SSH gestite; stato pubblico, label e policy di errore sono separati in model e service puri. `src/features/ai/` mantiene invece le capacità specifiche di Pi, gli allegati e la diagnostica. Le due feature risolvono il preload tramite adapter ritardati distinti: condividono primitive tecniche, ma non controller dell'output, stato o lifecycle. I vecchi owner in `src/components/` sono stati rimossi e il controllo architetturale ne impedisce la reintroduzione.

Nel processo principale `electron/domains/shell/shell-session-manager.cjs` è il service canonico delle sessioni per workspace. Coordina soltanto identità, focus e operazioni serializzate: validazione e proiezioni pubbliche vivono in `shell-session-model.cjs`, storico/backpressure/ACK in `shell-output-transport.cjs`, spawn/subscription/arresto confermato e ownership del PTY in `shell-process-lifecycle.cjs`. Il runtime di dominio compone il manager per l'IPC; il precedente owner `electron/shell-session-manager.cjs` è rimosso e non è una facciata.

`electron/app/bootstrap.cjs` installa l'esperienza fatal prima di caricare moduli nativi. `electron/infrastructure/processes/pty-runtime.adapter.cjs` confina invece un componente PTY mancante o incompatibile: terminali e Pi risultano degradati, mentre le aree che non richiedono PTY restano operative. Una dipendenza essenziale del bundle assente viene presentata come installazione da riparare, senza esporre il messaggio raw del loader.

La risoluzione di Pi è isolata in `electron/domains/ai/pi-executable.cjs`. La policy `electron/domains/ai/ai-terminal-launch-policy.cjs` sceglie tra il client Herdr e Pi diretto senza fare I/O: riceve il preflight dall'adapter infrastructure, produce descrittori di lancio validati e conserva un solo fallback. `electron/infrastructure/processes/herdr-runtime.adapter.cjs` possiede invece discovery, verifica dell'eseguibile e preflight bounded di `herdr --version` senza shell. Se nessun runtime è disponibile, l'errore resta confinato al Terminale AI.

Il controller PTY possiede sempre un solo processo client. In modalità Herdr quel processo è esclusivamente il client: il server persistente, i workspace e i pane restano di proprietà di Herdr e non vengono arrestati dal lifecycle di VincodeLab. Il fallback Pi è ammesso soltanto prima del primo byte prodotto da Herdr; dopo l'attivazione richiede una recovery utente esplicita. L'IPC blocca l'iniezione programmatica di contesto nel client condiviso, mentre tastiera e incolla manuale attraversano il normale canale PTY.

### Editor e filesystem

`src/features/editor/components/project-editor.tsx` coordina lifecycle React e CodeMirror. Tipi, trasformazioni pure, routing dei comandi e accesso al preload risiedono nella stessa feature, separati per responsabilità. Le operazioni reali sui file passano da `electron/domains/filesystem/project-files.cjs`, che risolve gli identificatori rispetto al workspace. Anteprime binarie e allegati applicano limiti di dimensione prima di raggiungere il renderer o Pi.

### Impostazioni

Il controller della vista, il modello puro, i tipi di dominio, l'input numerico riusabile, la normalizzazione degli errori e tutti gli accessi al preload appartengono a `src/features/settings/`. L'area è consumata dal relativo `index.ts`; non esiste più un owner alternativo sotto `src/components/`.

### Git e GitHub

Il dominio GitHub vive in `electron/domains/github/`; gli adapter per GitHub CLI, cache e servizio composto vivono in `electron/infrastructure/github/`. L'area usa esclusivamente il repository associato al workspace attivo. Registri dedicati gestiscono annullamento e appartenenza delle operazioni lunghe.

Nel renderer `src/features/git/` espone soltanto le operazioni sul repository locale, mentre `src/features/github/` possiede il controller canonico di repository remoti, issue e Projects. Ricerca, conteggi, gerarchia e copy dei limiti sono funzioni pure nel model; i feedback presentazionali riusabili sono separati dal controller. I due adapter risolvono il bridge Electron al momento di ogni invocazione e impediscono alla UI di dipendere direttamente da `window.vincodeLab`; questa separazione resta valida anche finché il preload mantiene entrambe le capacità nello stesso namespace storico `github`.

### Database

`src/features/database/` possiede controller e griglia React, tipi, normalizzazione delle connessioni e delle bozze, identità persistenti, copy degli errori e accesso al preload. Connessioni, query, transazioni, risorse, istanza CodeMirror e guardia workspace sono hook distinti; toolbar, explorer, dialog e risultati sono componenti presentazionali separati, con test che proteggono identità e persistenza della griglia.

L'ingresso nella sezione e il ripristino del profilo selezionato leggono soltanto metadati locali. La rete o il file database vengono aperti esclusivamente con l'azione **Connetti**: navigazione, mount e selezione non costituiscono autorizzazione implicita a collegarsi.

Il contratto comune in `electron/domains/database/database-service.cjs` normalizza SQLite, PostgreSQL, MySQL e SQL Server. Le sessioni e le operazioni attive appartengono al main; il renderer riceve schemi e risultati sottoposti a budget. Le mutazioni della griglia avvengono in una transazione esplicita.

L'esecuzione streaming dei database remoti attraversa la porta `electron/domains/database/database-driver.port.cjs`. L'adapter `electron/infrastructure/database/node-database-driver.adapter.cjs` possiede Query e Request dei vendor, eventi, timeout, parametri e cancellazione; il dominio conserva invece coda per sessione, budget progressivo, invalidazione del lifecycle e mapping degli errori pubblici. Le factory Query/Request specifiche dei vendor non fanno parte della porta pubblica e un ratchet architetturale ne impedisce il ritorno nel dominio.

Gli schemi grandi sono caricati in modo incrementale. `inspectSchema({ offset, limit, force })` restituisce `tables`, `routines`, `hasMore` e `nextOffset`; offset e limite si applicano separatamente a tabelle e routine e vengono imposti nel driver prima della materializzazione. Le pagine già ricevute vengono unite e deduplicate nel renderer. L'apertura di una tabella non presente nella cache usa un lookup puntuale invece di caricare l'intero catalogo.

SQLite usa `electron/infrastructure/database/sqlite-worker-session.adapter.cjs`, iniettato nel servizio di dominio dalla composition root. Il worker dedicato mantiene query e cancellazione fuori dal processo principale senza invertire la direzione delle dipendenze.

### Redis

`electron/domains/redis/redis-service.cjs` compone i casi d’uso senza caricare dipendenze concrete: `redis-session-runtime.cjs` possiede apertura, riuso, invalidazione e chiusura bounded delle sessioni; `redis-read-service.cjs` possiede SCAN e inspector; `redis-search-service.cjs` possiede la ricerca progressiva nei payload. Il client concreto `node-redis`, incluso nel pacchetto, è confinato in `electron/infrastructure/redis/node-redis-client.adapter.cjs` e viene iniettato dalla composition root. L’installazione non dipende quindi da `redis-cli`, Node.js o npm di sistema. Sono supportate connessioni Standalone e Sentinel con discovery e failover del master gestiti dal client nativo. Le credenziali del data node e quelle opzionali di Sentinel sono separate, cifrate con `safeStorage` e non tornano nel renderer.

Anche Redis segue un lifecycle passivo: mount della vista, navigazione e ripristino dell'identificatore persistito non aprono sessioni e non eseguono `SCAN`. **Connetti** è l'unico trigger della prima connessione e scansione. L'identificatore salvato rappresenta una preferenza locale, non un consenso permanente ad accedere alla rete.

L’explorer usa `SCAN`, letture paginate per tipo, preflight della dimensione e budget rigidi sulle risposte IPC. Tipo e TTL delle pagine vengono raccolti con auto-pipelining concorrente ma limitato; `MEMORY USAGE` viene richiesto soltanto quando serve davvero all’inspector o al preflight. Apertura, comandi e chiusura hanno timeout deterministici. La ricerca nei payload riusa una singola sessione, lavora in batch concorrenti limitati ed espone una stima best-effort senza dipendere da `DBSIZE` quando le ACL lo negano. Preview più piccole, preflight dedicati e un budget cumulativo impediscono a una ricerca ampia di trasferire quantità di dati non controllate. È progressiva e cancellabile; risultati parziali e stato della vista restano disponibili durante il recovery. Il renderer accorpa gli aggiornamenti frequenti, limita gli annunci assistivi e rinvia layout e paint delle righe fuori schermo. Non espone un comando Redis generico e la prima implementazione è esclusivamente read-only.

### SSH, SFTP e file remoti

Il servizio SSH usa gli eseguibili OpenSSH locali e una connessione controllata per workspace. SFTP esegue operazioni serializzate e limitate. I file aperti vengono copiati in una cache applicativa, confrontati tramite hash e sincronizzati soltanto su azione esplicita; lo stato di conflitto non sovrascrive automaticamente né la copia locale né quella remota.

Nel backend `electron/domains/remote/` possiede il modello pubblico delle connessioni e il protocollo SFTP (quoting, parsing e classificazione degli errori). `electron/infrastructure/remote/` possiede invece gli adapter OpenSSH, il lifecycle bounded dei subprocess e lo store SQLite/filesystem delle copie tracciate. Il servizio applicativo dei file remoti riceve questi adapter tramite `remote-runtime.cjs`: il dominio non importa lo store concreto e i precedenti moduli alla radice `electron/*-service.cjs` non sono facciate supportate.

`src/features/remote-files/` possiede il controller canonico e il confine renderer per profili SSH, navigazione SFTP, trasferimenti, copie tracciate e comandi contestuali. La vista risolve queste capacità tramite l'API pubblica della feature e non accede direttamente al preload.

## Persistenza

VincodeLab mantiene i propri metadati interni nella directory `userData` di Electron, separati dal repository aperto. Il database `vincodelab.sqlite` usa WAL e permessi locali restrittivi e contiene, tra gli altri:

- workspace recenti e aspetto;
- preferenze globali e override per workspace;
- sessione di navigazione e viste;
- connessioni database, query salvate e cronologia;
- connessioni Redis, con configurazione pubblica separata dai segreti;
- metadati dei file remoti tracciati.

Le password database e Redis non vengono conservate nel JSON di configurazione: sono cifrate tramite Electron `safeStorage` quando l'archiviazione sicura è disponibile. La cache dei file remoti risiede in una sottodirectory applicativa protetta.

File del progetto, skill e istruzioni Pi appartengono invece al workspace e vengono modificati soltanto attraverso azioni esplicite dell'utente.

Lo stato volatile necessario a recuperare bozze durante un crash del renderer è separato dal file originale e non implica un salvataggio automatico.

## Errori e diagnostica

Il processo principale classifica gli errori applicativi e assegna un correlation ID. Il preload ricostruisce soltanto il contratto pubblico atteso; il renderer converte il risultato in messaggio, gravità e azione di recupero.

La UI sceglie una superficie proprietaria — inline, toast, dialog o error boundary — per evitare duplicazioni. I log locali sono strutturati, limitati e sanitizzati; stack trace e valori sensibili non vengono mostrati automaticamente.

## Stato e prestazioni del renderer

Le sezioni principali sono caricate in modo lazy ma, una volta visitate, rimangono montate. Questo evita di ricreare xterm, CodeMirror e griglie a ogni cambio pagina. Persistenza della vista, selezione di un profilo e sessione remota sono responsabilità distinte: Database e Redis restano passivi finché l'utente non sceglie **Connetti**. Lo stato persistente conserva soltanto identificatori e preferenze necessari; processi e risorse native restano autorevoli nel main.

La pipeline del terminale applica backpressure e limiti alle metriche diagnostiche senza scartare l'output della sessione. Le dipendenze CodeMirror vengono separate in chunk cacheabili dalla build Vite.

## Estendere l'applicazione

Una nuova funzionalità privilegiata dovrebbe seguire questo flusso:

1. definire un contratto di dominio piccolo e validabile;
2. implementare il servizio nel main senza dipendenze dal renderer;
3. esporre un'API specifica in `electron/preload/bridges/`, rigenerare l'artefatto, aggiornare i tipi globali e consumarla attraverso `src/bridge`;
4. normalizzare errori, annullamento, timeout e recovery;
5. consumare l'API da una vista che usa `@/components/ui` e i token Graphite;
6. aggiungere test del servizio, del confine IPC e dell'interazione UI;
7. verificare il percorso nell'app Electron reale.

Le regole di contribuzione complete sono in [CONTRIBUTING.md](../CONTRIBUTING.md).
