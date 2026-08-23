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

### Confine Electron

- Il renderer non deve importare moduli Node.js o Electron, né accedere direttamente a filesystem, processi o rete privilegiata.
- Le capacità native passano attraverso API nominate in `electron/preload.cjs` e dichiarate in `src/vincode-lab.d.ts`.
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
- Non cambiare formati persistiti o contratti IPC senza descrivere la compatibilità nella pull request.
- Preserva contenuto non salvato, sessioni e stato recuperabile quando una vista fallisce.

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
