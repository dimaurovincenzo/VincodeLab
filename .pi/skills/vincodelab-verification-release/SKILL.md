---
name: vincodelab-verification-release
description: Verifica, compila e prepara build locali di VincodeLab. Usala quando viene chiesto di eseguire test, controlli, build, packaging macOS, smoke test o di valutare se il repository e il remoto sono pronti per commit, merge o pubblicazione.
---

# Verifica, build e release locale

## Protezione dello stato

1. Inizia con `git status --short --branch` e identifica modifiche preesistenti. Non cancellarle, non includerle implicitamente in commit e non dichiarare pulito un worktree che non lo è.
2. Usa test mirati durante lo sviluppo e il gate completo prima della consegna di codice.
3. Non eseguire commit, merge, push, tag, upload o release GitHub senza richiesta esplicita. Build e packaging non autorizzano operazioni remote.

## Gate standard

Per modifiche di codice esegui:

```bash
npm run check
git diff --check
```

Per sole modifiche Markdown usa `npm run check:repo` e `git diff --check`, dichiarando che il gate completo non era pertinente. Se un controllo fallisce, separa regressione introdotta, problema preesistente e limite ambientale; non descrivere il lavoro come completato finché resta un failure pertinente.

## Pacchetto macOS

Quando l'utente chiede una build installabile:

```bash
npm run package
node scripts/smoke-packaged-macos.mjs --app release/mac-arm64/VincodeLab.app
node scripts/smoke-packaged-macos.mjs --app release/mac-arm64/VincodeLab.app --without-pi
```

- Il pacchetto è intenzionalmente non firmato e non notarizzato; non presentarlo come release pubblica attendibile.
- Verifica il DMG con `hdiutil verify` usando versione e architettura effettive.
- Per cambiamenti al recovery usa `--fault-recovery` con profilo temporaneo, mai con dati reali.
- Non eseguire soak di 8–12 ore salvo richiesta esplicita; usa benchmark o smoke bounded pertinenti.

## Resoconto

Riporta comandi eseguiti, risultati, test manuali realmente svolti, verifiche non eseguite e percorso assoluto degli artefatti. Distingui sempre build riuscita, smoke riuscito e collaudo manuale: nessuno dei tre implica automaticamente gli altri.
