# Build e release macOS

## Stato corrente

Il progetto produce un bundle macOS tramite electron-builder. La configurazione corrente imposta `build.mac.identity` a `null`: `.app`, DMG e ZIP sono quindi **non firmati e non notarizzati**. Sono adatti allo sviluppo e al collaudo locale, non a una distribuzione pubblica presentata come attendibile.

## Preparazione

Parti da una revisione identificabile e da un working tree pulito:

```bash
git status --short --branch
npm ci
npm run check
git diff --check
```

Controlla che versione, `productName`, icona e note di rilascio corrispondano al candidato. Non includere `dist/`, `release/`, profili o credenziali nei commit.

## Creare il pacchetto locale

```bash
npm run package
```

Lo script:

1. esegue type-check e build Vite;
2. ricostruisce `node-pty` e `better-sqlite3` per Electron;
3. crea il bundle macOS con electron-builder.

Gli artefatti vengono scritti in `release/`. Nome e sottodirectory dipendono da versione e architettura; su Apple Silicon il layout corrente include in genere:

```text
release/mac-arm64/VincodeLab.app
release/VincodeLab-<version>-arm64.dmg
release/VincodeLab-<version>-arm64-mac.zip
```

## Verificare il candidato

Esegui lo smoke sul percorso effettivo del bundle:

```bash
node scripts/smoke-packaged-macos.mjs \
  --app release/mac-arm64/VincodeLab.app
```

Verifica inoltre l'avvio su un profilo isolato senza Pi, Node o npm di sistema:

```bash
node scripts/smoke-packaged-macos.mjs \
  --app release/mac-arm64/VincodeLab.app \
  --without-pi
```

Questo percorso deve aprire il workspace, mantenere disponibili Editor, Terminale locale, GitHub, Database e Redis e mostrare il messaggio guidato «Pi Coding Agent non installato».

Verifica il DMG:

```bash
VINC_LAB_VERSION="$(node -p "require('./package.json').version")"
hdiutil verify "release/VincodeLab-${VINC_LAB_VERSION}-arm64.dmg"
```

Nel modello locale corrente l'assenza di firma è intenzionale. Può essere controllata con:

```bash
codesign -dv --verbose=2 release/mac-arm64/VincodeLab.app
```

Il comando non deve mostrare una `Authority` Developer ID né un `TeamIdentifier`. Alcuni eseguibili Mach-O possono comunque riportare una firma tecnica `adhoc,linker-signed` prodotta dalla toolchain Apple: non è una firma applicativa, non identifica uno sviluppatore e non sostituisce firma e notarizzazione. Non descriverla come firma Developer ID.

Completa infine un collaudo manuale delle aree toccate usando un workspace dimostrativo e un profilo applicativo isolato.

## Primo avvio di un bundle locale

Gatekeeper può impedire l'apertura di un'app non firmata scaricata o copiata da un altro computer. Per un bundle costruito personalmente, usa il comando **Apri** dal menu contestuale di Finder e conferma l'eccezione mostrata da macOS. Non consigliare di disabilitare Gatekeeper globalmente.

## Requisiti prima di una distribuzione pubblica

Prima di pubblicare binari per utenti finali occorre completare e verificare almeno:

- identità Developer ID Application gestita fuori dal repository;
- firma di bundle, helper e moduli nativi;
- hardened runtime ed entitlements minimi documentati;
- notarizzazione Apple e stapling del ticket;
- verifica Gatekeeper su una macchina o un profilo pulito;
- strategia esplicita per architetture supportate;
- provenienza e checksum degli artefatti;
- note di release, limitazioni note e procedura di rollback;
- workflow CI protetto con segreti a privilegi minimi;
- processo di aggiornamento dell'app progettato e testato, se introdotto.

Finché questi punti non sono implementati, la release pubblica deve distribuire il sorgente oppure etichettare chiaramente gli artefatti come build non firmate per sviluppatori.

## Checklist di consegna

- [ ] Working tree pulito e commit/tag identificato
- [ ] Versione coerente in `package.json` e note di rilascio
- [ ] Lint, test, audit CSS, build e diff check verdi
- [ ] Smoke packaged riuscito e processi temporanei rimossi
- [ ] DMG verificato
- [ ] Test manuale completato sulle aree rilevanti
- [ ] Screenshot e fixture privi di dati personali
- [ ] Stato di firma/notarizzazione descritto correttamente
- [ ] Artefatti e checksum pubblicati soltanto con autorizzazione esplicita

La creazione locale del pacchetto non autorizza automaticamente push, tag o upload su GitHub.
