---
name: vincodelab-modular-refactor
description: Pianifica ed esegue refactor strutturali della codebase VincodeLab senza cambiare comportamento. Usala per dividere file monolitici, spostare responsabilità, introdurre moduli tematici, rimuovere owner legacy o correggere dipendenze tra renderer, Electron e infrastruttura.
---

# Refactor modulare sicuro

## Prima del cambiamento

1. Leggi `docs/architecture.md`, `CONTRIBUTING.md` e i test path-based dell'area.
2. Mappa owner attuale, API pubblica, consumer, stato, side effect, contratti IPC/persistiti e test che proteggono il comportamento.
3. Definisci il confine finale prima di spostare file. Non creare livelli o cartelle vuote “per il futuro”.
4. Se il cambiamento modifica un contratto pubblico, persistenza o sicurezza, trattalo come evoluzione funzionale e non come semplice refactor.

## Strategia a slice

Usa la sequenza:

```text
sposta -> verifica -> estrai -> verifica -> ripulisci -> verifica
```

- Renderer: `src/app/` compone; `src/features/<nome>/` possiede la capacità; `index.ts` è l'unico ingresso esterno; gli import interni restano relativi.
- Electron: domini e application non dipendono dall'infrastruttura; adapter concreti entrano dalla composition root.
- Evita re-export generici, facciate temporanee senza condizione di rimozione, service locator e duplicazione di owner.
- Mantieni firme, errori pubblici, ordine degli eventi, identity React, stato persistito e comportamento utente invariati.
- Prima di aggiornare un test testuale per un nuovo percorso, aggiungi un test diretto del comportamento o del contratto; conserva soltanto i ratchet architetturali necessari.

## Gestione del worktree

Preserva modifiche locali non correlate. Non fare reset, checkout distruttivi o riscritture massive. Mantieni ogni slice rivedibile e non unire pulizia estranea al refactor.

## Verifica

Dopo ogni slice esegui i test mirati e `npm run check:architecture`. Prima della consegna esegui:

```bash
npm run check
git diff --check
```

Per viste persistenti verifica l'identità DOM nella shell reale; per spostamenti preload verifica anche `npm run check:preload`.
