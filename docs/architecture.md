# Architettura

Ogni istanza Electron di VincodeLab gestisce una finestra e un workspace attivo. Un altro workspace può essere aperto in una nuova istanza coordinata; all'interno della finestra, le viste operative condividono il contesto senza ottenere accesso diretto alle capacità native.

## Componenti principali

| Livello | Percorsi principali | Responsabilità |
| --- | --- | --- |
| Renderer | `src/` | Interfaccia React, stato delle viste, CodeMirror, xterm e feedback utente |
| Design system | `src/components/ui/`, `src/theme/`, `panda.config.ts` | Primitive Ark UI, componenti Park-style, token e recipe Graphite |
| Preload | `electron/preload.cjs` | API `window.vincodeLab`, serializzazione e ricostruzione degli errori pubblici |
| Processo principale | `electron/bootstrap.cjs`, `electron/main.cjs`, `electron/*.cjs` | Bootstrap protetto, lifecycle, IPC, filesystem, processi, Git/GitHub, SSH/SFTP, database e Redis |
| Persistenza | `electron/workspace-store.cjs` e store di dominio | Stato applicativo locale, preferenze e metadati per workspace |
| Verifica | `test/`, `scripts/` | Test di contratto/componenti, benchmark, stress e smoke del bundle |

Il renderer usa TypeScript e moduli ES. I servizi Electron sono CommonJS perché vengono caricati direttamente dal processo principale e dal preload.

## Confine di sicurezza

```text
contenuto del workspace
          │
          ▼
 React renderer (sandbox, nessun Node.js)
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
- output tecnici e segreti filtrati prima di attraversare l'IPC;
- operazioni remote o distruttive esplicite e annullabili quando possibile;
- Content Security Policy identica tra sviluppo e build, salvo gli endpoint loopback necessari a Vite.

## Domini applicativi

### Shell e Pi

`node-pty` ospita sia le sessioni shell sia Pi Coding Agent. Il main possiede processi, backpressure, cronologia e lifecycle; xterm si occupa soltanto della presentazione e dell'input. Le viste terminale rimangono montate durante la navigazione per preservare sessione e viewport.

`electron/bootstrap.cjs` installa l'esperienza fatal prima di caricare moduli nativi. `electron/pty-runtime.cjs` confina invece un componente PTY mancante o incompatibile: terminali e Pi risultano degradati, mentre le aree che non richiedono PTY restano operative. Una dipendenza essenziale del bundle assente viene presentata come installazione da riparare, senza esporre il messaggio raw del loader.

La risoluzione di Pi è isolata in `electron/pi-executable.cjs`. Se l'eseguibile non è disponibile, l'errore resta confinato al Terminale AI.

### Editor e filesystem

`src/components/project-editor.tsx` coordina explorer, tab e CodeMirror. Le operazioni reali sui file passano da `electron/project-files.cjs`, che risolve gli identificatori rispetto al workspace. Anteprime binarie e allegati applicano limiti di dimensione prima di raggiungere il renderer o Pi.

### Git e GitHub

`electron/github-service.cjs` separa operazioni Git locali da richieste effettuate con GitHub CLI. L'area GitHub usa esclusivamente il repository associato al workspace attivo. Registri dedicati gestiscono annullamento e appartenenza delle operazioni lunghe.

### Database

Il contratto comune in `electron/database-service.cjs` normalizza SQLite, PostgreSQL, MySQL e SQL Server. Le sessioni e le operazioni attive appartengono al main; il renderer riceve schemi e risultati sottoposti a budget. Le mutazioni della griglia avvengono in una transazione esplicita.

SQLite usa un worker dedicato, così query e cancellazione non bloccano il processo principale.

### Redis

`electron/redis-service.cjs` usa il client `node-redis` incluso nel pacchetto: l’installazione non dipende da `redis-cli`, Node.js o npm di sistema. Sono supportate connessioni Standalone e Sentinel con discovery e failover del master gestiti dal client nativo. Le credenziali del data node e quelle opzionali di Sentinel sono separate, cifrate con `safeStorage` e non tornano nel renderer.

L’explorer usa `SCAN`, letture paginate per tipo, preflight della dimensione e budget rigidi sulle risposte IPC. Apertura, comandi e chiusura hanno timeout deterministici. La ricerca nei payload è progressiva, limitata e cancellabile; risultati parziali e stato della vista restano disponibili durante il recovery. Il renderer non espone un comando Redis generico e la prima implementazione è esclusivamente read-only.

### SSH, SFTP e file remoti

Il servizio SSH usa gli eseguibili OpenSSH locali e una connessione controllata per workspace. SFTP esegue operazioni serializzate e limitate. I file aperti vengono copiati in una cache applicativa, confrontati tramite hash e sincronizzati soltanto su azione esplicita; lo stato di conflitto non sovrascrive automaticamente né la copia locale né quella remota.

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

Le sezioni principali sono caricate in modo lazy ma, una volta visitate, rimangono montate. Questo evita di ricreare xterm, CodeMirror, connessioni e griglie a ogni cambio pagina. Lo stato persistente conserva soltanto identificatori e preferenze necessari; processi e risorse native restano autorevoli nel main.

La pipeline del terminale applica backpressure e limiti alle metriche diagnostiche senza scartare l'output della sessione. Le dipendenze CodeMirror vengono separate in chunk cacheabili dalla build Vite.

## Estendere l'applicazione

Una nuova funzionalità privilegiata dovrebbe seguire questo flusso:

1. definire un contratto di dominio piccolo e validabile;
2. implementare il servizio nel main senza dipendenze dal renderer;
3. esporre un'API preload specifica e aggiornare i tipi globali;
4. normalizzare errori, annullamento, timeout e recovery;
5. consumare l'API da una vista che usa `@/components/ui` e i token Graphite;
6. aggiungere test del servizio, del confine IPC e dell'interazione UI;
7. verificare il percorso nell'app Electron reale.

Le regole di contribuzione complete sono in [CONTRIBUTING.md](../CONTRIBUTING.md).
