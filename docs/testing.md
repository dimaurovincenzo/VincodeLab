# Strategia di test

La verifica di VincodeLab combina contratti di servizio, componenti React, build di produzione e collaudo dell'app Electron. Nessun singolo livello sostituisce gli altri.

## Gate standard

Prima di una pull request che modifica codice esegui:

```bash
npm run check
git diff --check
```

`npm run check` esegue controllo di igiene del repository, lint, audit CSS, test, type-check e build. Per sole modifiche Markdown sono sufficienti `npm run check:repo` e i controlli dei diff, ma la pull request deve indicare esplicitamente quali gate non erano pertinenti.

## Livelli di verifica

| Livello | Strumenti | Ambito |
| --- | --- | --- |
| Servizi e contratti | `node:test` in `test/*.test.cjs` e `test/*.test.mjs` | Main, preload, IPC, persistenza, processi e moduli puri |
| Componenti | Vitest, jsdom e Testing Library in `test/components/` | Interazioni React, focus, tastiera e feedback |
| Analisi statica | oxlint e TypeScript | Errori di codice, tipi e import |
| Design system | `scripts/audit-css.mjs` | Token, dipendenze UI e residui CSS vietati |
| Produzione | Vite ed electron-builder | Chunk, asset, moduli nativi e bundle |
| Runtime | smoke packaged e test manuale | Avvio Electron, integrazioni e recovery reali |

## Eseguire test mirati

Il runner Node accetta un singolo file:

```bash
node --test test/context-menu.test.cjs
node --test test/terminal-stream-controller.test.cjs
```

Per i componenti:

```bash
npx vitest run --config vitest.config.ts test/components/settings-number-preference.test.tsx
```

Usa poi `npm test` prima del merge per intercettare regressioni incrociate.

## Prestazioni e affidabilità

Gli script seguenti sono mirati e non appartengono a ogni modifica:

```bash
npm run benchmark:terminal
npm run benchmark:reliability
npm run stress:architecture:smoke
```

- `benchmark:terminal` misura la pipeline di output e deve restare lossless.
- `benchmark:reliability` esercita scenari accelerati di errore e recupero.
- `stress:architecture:smoke` controlla in modo limitato e ripetibile il ciclo di vita e le risorse principali.
- `stress:architecture` esegue il profilo completo ed è riservato a cambiamenti architetturali o a una certificazione esplicita.

Non presentare uno stress accelerato come equivalente a un soak prolungato. Registra durata, profilo, revisione e limiti in un report locale non versionato.

## Smoke del pacchetto macOS

Dopo `npm run package`, individua il bundle prodotto ed esegui:

```bash
node scripts/smoke-packaged-macos.mjs \
  --app release/mac-arm64/VincodeLab.app
```

Lo smoke usa un profilo temporaneo, limita l'inspector a loopback, blocca richieste esterne e verifica caricamento del renderer, moduli nativi e cleanup dei processi.

Per modifiche al sistema di recovery, usa anche la modalità controllata:

```bash
node scripts/smoke-packaged-macos.mjs \
  --app release/mac-arm64/VincodeLab.app \
  --fault-recovery
```

Non eseguire fault injection con directory dati, workspace o credenziali reali.

## Collaudo manuale

Per modifiche visibili o di integrazione verifica nell'app Electron reale:

1. apertura, cambio e ripristino del workspace;
2. navigazione da tastiera, palette comandi, Quick Open e menu contestuali;
3. editor, conflitto esterno, salvataggio e anteprime interessate;
4. creazione, cambio, resize e chiusura dei terminali;
5. stato, diff e azioni Git coinvolte;
6. connessione, query, annullamento e transazione database coinvolti;
7. tema `system`, chiaro e scuro, focus visibile e reduced motion;
8. errore controllato, messaggio, recovery e conservazione dello stato.

Per GitHub, database remoti e SFTP usa account e servizi fixture autorizzati. Se un'integrazione esterna non è stata collaudata, dichiaralo: i mock non certificano autenticazione, rete o permessi reali.

## Scrivere nuovi test

- Verifica il comportamento pubblico, non dettagli casuali dell'implementazione.
- Copri esito positivo, errore classificato, annullamento/timeout e recovery quando pertinenti.
- Controlla che chiamate successive funzionino dopo un errore.
- Usa clock, processi, filesystem e driver controllati; evita rete esterna nei test automatici.
- Mantieni fixture piccole, deterministiche e prive di segreti o percorsi personali.
- Per regressioni di accessibilità preferisci query semantiche e interazioni reali da tastiera.
- Per regressioni di prestazioni definisci un budget e separa la correttezza lossless dalla velocità.

Conserva le evidenze dettagliate delle certificazioni fuori dal repository pubblico e indica sempre ciò che non è stato verificato.
