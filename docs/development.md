# Ambiente di sviluppo

## Prerequisiti

- macOS, con Apple Silicon come piattaforma attualmente verificata;
- Node.js `>=22.12.0 <27`; usa Node.js 24 per allinearti a `.node-version`;
- npm `>=10.9.0 <12`;
- Git;
- strumenti da riga di comando Xcode se i moduli nativi devono essere compilati localmente.

Pi Coding Agent, GitHub CLI, OpenSSH e server database sono opzionali: servono soltanto per sviluppare o collaudare le relative integrazioni.

Verifica l'ambiente prima dell'installazione:

```bash
node --version
npm --version
git --version
```

## Installazione

```bash
git clone https://github.com/dimaurovincenzo/VincodeLab.git
cd VincodeLab
npm ci
```

Gli hook npm eseguono il codegen Panda CSS e preparano `node-pty` e `better-sqlite3` per la versione Electron in uso. `styled-system/` è generato e non deve essere committato.

## Avvio

```bash
npm run dev
```

Questo comando esegue in parallelo:

- Vite su `127.0.0.1:5173`;
- Electron, avviato dopo che la porta del renderer è pronta.

Chiudendo uno dei due processi, `concurrently` arresta anche l'altro. `npm start` apre invece Electron usando una build `dist/` già esistente.

## Comandi principali

| Comando | Scopo |
| --- | --- |
| `npm run dev` | Renderer Vite ed Electron in sviluppo |
| `npm run check` | Gate completo: repository, architettura, lint, CSS, test e build |
| `npm run check:repo` | Percorsi locali, artefatti, segreti evidenti e link Markdown |
| `npm run check:architecture` | Confini dei moduli, accessi al bridge e dipendenze circolari |
| `npm run demo:create` | Crea il workspace dimostrativo locale e riproducibile |
| `npm run screenshots:capture` | Rigenera gli screenshot pubblici dal bundle Electron |
| `npm run build` | Type-check TypeScript e build renderer di produzione |
| `npm run lint` | Analisi statica con oxlint |
| `npm test` | Test Node e componenti React |
| `npm run test:components` | Soli test Vitest/Testing Library |
| `npm run audit:css:check` | Verifica i vincoli del design system |
| `npm run panda` | Esegue direttamente Panda CSS |
| `npm run rebuild:native` | Ricostruisce i moduli nativi per Electron |
| `npm run package` | Build, moduli nativi e pacchetto macOS |

Benchmark e stress test sono descritti in [testing.md](testing.md).

## Struttura del repository

```text
electron/                 processo principale, preload e servizi nativi
  ipc/domains/            registratori IPC per dominio con dipendenze iniettate
src/
  app/                    composizione, provider, layout e stato della shell
  features/               capacità verticali con API pubblica per feature
  bridge/                 unico accesso renderer al preload Electron
  components/             viste e componenti React
    ui/                    unico ingresso per le primitive condivise
  shared/                 moduli neutrali realmente condivisi
  lib/                    stato e logica renderer riutilizzabile
  styles/                 CSS tecnico per shell, CodeMirror e xterm
  theme/                  token, recipe e stili Panda Graphite
scripts/                  audit, benchmark, stress e smoke packaged
test/                     test Node e componenti
docs/                     guide operative pubbliche
panda.config.ts           configurazione del design system
vite.config.ts            build e Content Security Policy del renderer
```

Artefatti locali come `node_modules/`, `styled-system/`, `dist/` e `release/` sono ignorati da Git.

La struttura modulare viene introdotta progressivamente. Un componente nel percorso legacy può fungere da facciata temporanea, ma la nuova logica di dominio deve entrare nella feature proprietaria. Non importare file interni di un'altra feature: usa il relativo `index.ts`.

Le eccezioni esistenti agli accessi diretti a `window.vincodeLab` sono registrate con un conteggio massimo nel controllo architetturale. Non aumentare tali soglie; quando migri un accesso, riduci o rimuovi esplicitamente la relativa eccezione.

Ogni registratore in `electron/ipc/domains/` deve esportare il manifesto `*_INVOKE_CHANNELS`, verificare il sender prima di invocare il servizio e non intercettare gli errori destinati alla boundary IPC globale. Il test di parità confronta questi manifesti con le API esposte dal preload. Non spezzare fisicamente `electron/preload.cjs` senza introdurre prima un bundler compatibile con il sandbox.

## Override locali utili

Il progetto riconosce alcune variabili per ambienti di sviluppo e test:

| Variabile | Uso |
| --- | --- |
| `VINCODELAB_PI_PATH` | Percorso assoluto di un eseguibile `pi` |
| `VINCODELAB_GH_PATH` | Percorso assoluto di un eseguibile `gh` |
| `VINCODELAB_DATA_DIR` | Directory dati applicativi alternativa |
| `VINCODELAB_LOGS_DIR` | Directory log alternativa |

Non salvare questi valori in file versionati. Per test manuali usa directory temporanee e non puntare mai a un profilo reale se stai iniettando errori o dati corrotti.

## Design system

I componenti condivisi vengono importati da `@/components/ui`. Le primitive accessibili provengono da Ark UI; Panda CSS genera classi, token e recipe dal contenuto di `src/theme/` e `panda.config.ts`.

Quando modifichi i token o aggiungi una recipe:

```bash
npm run panda -- codegen
npm run audit:css:check
npm run build
```

Non modificare manualmente `styled-system/`. Mantieni CSS diretto soltanto dove l'integrazione tecnica non può essere espressa in modo affidabile con Panda.

## Moduli nativi

`node-pty` e `better-sqlite3` devono essere compatibili con l'ABI di Electron, non soltanto con quella del Node.js di sistema. Se il terminale o SQLite falliscono dopo un cambio di versione:

```bash
npm run rebuild:native
```

Se il problema persiste, rimuovi soltanto l'installazione locale delle dipendenze e ripeti `npm ci`; non committare binari ricostruiti.

## Risoluzione dei problemi

### La porta 5173 è occupata

Vite usa una porta fissa e `strictPort`. Chiudi il processo locale che usa `127.0.0.1:5173`, quindi riavvia `npm run dev`.

### Pi non viene trovato

Verifica che `pi` sia eseguibile nel `PATH` della shell oppure imposta temporaneamente `VINCODELAB_PI_PATH`. Il resolver controlla anche le installazioni locali comuni e Homebrew.

### GitHub non è configurato

Verifica `gh --version` e lo stato di autenticazione con `gh auth status`. Le funzioni Git locali restano utilizzabili anche se GitHub CLI non è autenticata.

### L'interfaccia non riflette i token aggiornati

Rigenera Panda CSS e riavvia Vite. Se stai usando `npm ci`, il codegen viene già eseguito automaticamente.

### Il pacchetto non si apre al primo avvio

Il bundle locale è non firmato. Consulta [release.md](release.md) per le limitazioni e per lo smoke test; non disattivare globalmente Gatekeeper.
