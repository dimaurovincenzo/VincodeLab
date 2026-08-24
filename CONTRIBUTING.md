# Contribuire a VincodeLab

Grazie per l'interesse verso VincodeLab. Il progetto accetta issue e pull request focalizzate, riproducibili e coerenti con i confini di sicurezza dell'app desktop.

## Prima di iniziare

- Cerca nelle issue esistenti prima di aprirne una nuova.
- Per correzioni piccole puoi proporre direttamente una pull request.
- Per nuove aree di prodotto, modifiche IPC o cambiamenti alla persistenza, apri prima una discussione o una feature request: permette di concordare contratto, UX e migrazione dei dati.
- Le vulnerabilità seguono un percorso privato descritto in [SECURITY.md](SECURITY.md).

## Preparare l'ambiente

Sono supportate le versioni dichiarate in `package.json`: Node.js `>=22.12.0 <27` e npm `>=10.9.0 <12`. Lo sviluppo e il packaging correnti sono orientati a macOS.

```bash
git clone https://github.com/dimaurovincenzo/VincodeLab.git
cd VincodeLab
npm ci
npm run dev
```

`npm ci` installa il lockfile, rigenera l'output Panda CSS e ricostruisce i moduli nativi per Electron tramite gli hook del progetto.

Consulta [docs/development.md](docs/development.md) per prerequisiti opzionali, struttura delle cartelle e risoluzione dei problemi comuni.

## Flusso di lavoro

1. Crea un branch breve a partire da `main`, per esempio `feat/nome-funzionalita` o `fix/nome-problema`.
2. Mantieni ogni modifica concentrata su un solo obiettivo.
3. Aggiungi o aggiorna i test insieme al comportamento.
4. Aggiorna la documentazione pubblica quando cambiano requisiti, comandi o funzionalità visibili.
5. Esegui i gate pertinenti e descrivili nella pull request.

I messaggi di commit dovrebbero essere imperativi e leggibili; il progetto usa comunemente prefissi come `feat:`, `fix:`, `refactor:`, `test:`, `docs:` e `perf:`.

## Regole architetturali

### Albero e ownership

| Area | Owner | Contenuto ammesso |
| --- | --- | --- |
| `src/app/` | shell renderer | composizione, navigazione, provider e coordinamento tra feature |
| `src/features/<nome>/` | feature verticale | `api/`, `components/`, `hooks/`, `model/`, `services/` e un solo ingresso pubblico `index.ts` |
| `src/bridge/` | confine renderer | contratto tipizzato e accesso a `window.vincodeLab`; nessuna UI o logica di feature |
| `src/components/ui/` | design system | primitive Ark/Park condivise, esportate esclusivamente da `index.ts` |
| `src/components/` | presentazione condivisa | componenti trasversali privi di dipendenze da app e feature |
| `src/theme/` | Graphite | token, recipe e stili Panda; nessuna dipendenza da componenti o feature |
| `electron/app/` e `electron/domains/` | application/domain | orchestrazione testabile e policy indipendenti dagli adapter |
| `electron/infrastructure/` | adapter | CLI, cache, driver e integrazioni che implementano capacità del dominio |
| `electron/ipc/domains/` | boundary IPC | manifesti di canale e handler con dipendenze iniettate |
| `electron/preload/` | boundary preload | sorgenti canoniche dei bridge esposti al renderer |
| `electron/main.cjs`, `electron/app/bootstrap.cjs` | composition root | wiring, lifecycle Electron e bootstrap protetto |

La radice `electron/` è riservata a `main.cjs` e all'artefatto `preload.cjs` generato. Non aggiungere servizi o facciate compatibili in questa cartella e non ricreare i path rimossi: aggiorna test e import verso l'owner canonico.

Le dipendenze devono puntare verso l'interno:

```text
src/main.tsx → src/app → ingressi pubblici delle feature
feature A    → feature B/index.ts, @/bridge, @/components/ui, @/theme/*, @/lib/*
components  → @/components/ui, @/theme/*, @/lib/*, @/bridge

electron/main.cjs → app, IPC, domini, infrastructure
infrastructure    → domini
IPC               → dipendenze iniettate dal main
preload            → soli moduli electron/preload/ e pacchetto electron
```

`npm run check:architecture` impedisce import profondi cross-feature, accessi profondi a UI/bridge, dipendenze inverse, path legacy rimossi, accessi diretti a `window.vincodeLab` e cicli interni.

### Confine Electron

- Il renderer non deve importare moduli Node.js o Electron, né accedere direttamente a filesystem, processi o rete privilegiata.
- Le capacità native sono definite nelle sorgenti `electron/preload/`, dichiarate in `src/vincode-lab.d.ts` e consumate dal renderer tramite `@/bridge`.
- `electron/preload.cjs` è un artefatto runtime generato: non modificarlo a mano. `npm run build:preload` lo ricostruisce e `npm run check:preload` rileva drift.
- Ogni nuovo handler IPC deve validare mittente e argomenti nel processo principale, limitare input/output e restituire soltanto dati necessari.
- Non inviare al renderer stack trace, errori raw di processi, credenziali, percorsi interni non necessari o output di driver non sanitizzato.

### Renderer e design system

- Importa primitive e componenti condivisi da `@/components/ui`.
- Preferisci le primitive accessibili Ark UI e i pattern Park-style già presenti.
- Usa token semantici e recipe Panda in `src/theme/`; evita colori arbitrari, duplicazioni di stile e nuovi CSS globali.
- CSS diretto è riservato alle integrazioni tecniche che lo richiedono, come xterm e CodeMirror, e deve comunque consumare i token del tema.
- Mantieni navigazione da tastiera, focus visibile, semantica screen reader e `prefers-reduced-motion`.
- Non rimontare viste persistenti, terminali, editor o griglie durante la navigazione.

### Errori e operazioni asincrone

- Un errore visibile non può terminare nel solo `console.error`.
- Normalizza gli errori con i contratti condivisi e mostra messaggi contestuali con una recovery quando possibile.
- Conserva separati il messaggio utente e la diagnostica tecnica; non mostrare direttamente `error.message` se proviene da un confine non fidato.
- Ogni loading deve poter terminare in successo, errore, annullamento o timeout.
- Evita notifiche duplicate: una sola superficie UI possiede la comunicazione dell'errore.

### Dati e compatibilità

- Le preferenze globali e quelle del workspace hanno contratti separati: una modifica allo schema richiede default, validazione, recovery e test di migrazione.
- Le operazioni distruttive o remote devono restare esplicite e, dove previsto, confermate.
- Navigazione, mount di una vista e ripristino di un identificatore persistito non devono avviare operazioni remote: una selezione salvata non equivale al consenso a connettersi.
- Non cambiare formati persistiti o contratti IPC senza descrivere la compatibilità nella pull request.
- Preserva contenuto non salvato, sessioni e stato recuperabile quando una vista fallisce.

## Aggiungere una feature renderer

1. Crea `src/features/<nome>/` e assegna ogni file a `api`, `components`, `hooks`, `model` o `services` in base alla responsabilità; evita cartelle vuote o livelli creati “per il futuro”.
2. Esponi da `index.ts` soltanto il contratto necessario agli altri moduli. Gli import interni restano relativi; i consumer esterni usano `@/features/<nome>`.
3. Mantieni stato e trasformazioni pure in `model/`, accessi privilegiati in un adapter `api/*.bridge.ts` e policy non-React in `services/`. Hook e controller presentazionali restano vicino alla feature.
4. Componi la vista da `src/app/`; non fare dipendere la feature dalla shell. Usa `@/components/ui` e token Graphite per la UI.
5. Aggiungi test del modello e dei confini, poi test di interazione per tastiera, focus, errori e persistenza rilevanti.
6. Se stai rimuovendo un vecchio owner, aggiorna nello stesso cambiamento import e test path-based. Una facciata temporanea richiede una motivazione di compatibilità e una data/condizione di rimozione.

## Aggiungere una capacità IPC

1. Definisci prima operazione, input, output, timeout, annullamento ed errore pubblico. La capacità appartiene a `electron/domains/<nome>/`; un driver o una CLI appartiene a `electron/infrastructure/<nome>/`. Applica paginazione e limiti nella query o nel driver prima di accumulare il risultato: caricare tutto e usare `slice()` in seguito non è un controllo di budget accettabile.
2. Crea o estendi `electron/ipc/domains/<nome>.ipc.cjs`. Esporta manifesti immutabili `*_INVOKE_CHANNELS` e/o `*_SEND_CHANNELS`, costruisci gli handler da dipendenze iniettate e conserva validazione del sender e degli argomenti nel boundary.
3. Collega registrar, dominio e adapter esclusivamente nella composition root `electron/main.cjs`. Gli handler non devono importare il main né catturare errori che spettano alla boundary IPC centralizzata.
4. Aggiungi l'API nominata al bridge corretto in `electron/preload/bridges/`. Se crei un nuovo modulo preload, dichiaralo in `scripts/build-preload.mjs`; poi aggiorna `src/vincode-lab.d.ts`.
5. Nel renderer incapsula l'accesso in `src/features/<nome>/api/*.bridge.ts`, ottenendo il contratto da `@/bridge`; componenti e model non accedono direttamente a `window.vincodeLab`.
6. Aggiungi test del dominio/adapter, del registrar (guardie, argomenti, return, errori e cancellazione), della parità dei canali e della superficie preload.
7. Esegui almeno `npm run build:preload`, `npm run check:preload`, i test mirati, `npm run check:architecture` e `git diff --check`. Per capacità native verifica anche il percorso reale in Electron.

Per capacità remote o paginate aggiungi test che provino: zero chiamate remote al mount e alla selezione, anche in StrictMode; una sola chiamata dopo l'azione esplicita; validazione di `offset` e `limit`; coerenza di `hasMore` e `nextOffset`; merge e deduplicazione delle pagine; conservazione dei risultati già caricati se una pagina successiva fallisce.

## Test e controlli

Il gate standard è:

```bash
npm run check
git diff --check
```

`npm run check` esegue in sequenza controllo del repository, lint, audit CSS, test, type-check e build.

Usa inoltre i controlli mirati quando tocchi aree sensibili:

```bash
npm run benchmark:terminal
npm run benchmark:reliability
npm run stress:architecture:smoke
```

- I test `node:test` coprono servizi Electron, contratti e moduli puri.
- Vitest e Testing Library coprono i componenti React e l'accessibilità interattiva.
- Build e type-check sono eseguiti insieme da `npm run build`.
- Benchmark e stress test non sono richiesti per sole modifiche documentali; indicalo chiaramente nella pull request.

La matrice completa è in [docs/testing.md](docs/testing.md).

## Test manuale

Per una modifica visibile o nativa, avvia realmente Electron e verifica almeno:

- percorso principale e percorso di errore;
- tastiera, focus e tema chiaro/scuro;
- conservazione dello stato quando si cambia sezione;
- assenza di credenziali o percorsi personali in UI, log e screenshot;
- comportamento con integrazioni opzionali mancanti, se pertinente.

Se tocchi packaging o moduli nativi, crea il bundle e usa lo smoke test descritto in [docs/release.md](docs/release.md).

## Pull request

Compila il template includendo:

- problema e risultato della modifica;
- decisioni o compromessi rilevanti;
- test automatici e manuali eseguiti;
- screenshot puliti per cambiamenti UI;
- impatto su IPC, persistenza, sicurezza e prestazioni;
- eventuali verifiche non eseguite e il motivo.

Una pull request non dovrebbe includere refactor estranei, artefatti `dist/` o `release/`, file generati in `styled-system/`, dati reali o dipendenze non necessarie.

## Privacy dei fixture e degli screenshot

Usa dati inventati e ripetibili. Non aggiungere al repository:

- file `.env`, token, password, chiavi SSH o certificati;
- connection string o profili database reali;
- percorsi home personali o nomi di host interni;
- cronologia shell, prompt AI o output di workspace privati;
- screenshot con notifiche, account, repository privati o metadati personali.

Per immagini pubbliche segui [docs/screenshots.md](docs/screenshots.md).
