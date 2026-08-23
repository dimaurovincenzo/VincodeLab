# Menu contestuale globale — Implementation Plan

**Goal:** aggiungere un menu contestuale nativo, coerente e sicuro in tutta VincodeLab.

**Architecture:** un builder puro produce template Electron da sezione attiva e metadati `context-menu`; il main registra un solo listener per finestra e inoltra soltanto comandi presenti nell'allowlist applicativa esistente.

**Spec:** `docs/superpowers/specs/2026-08-21-menu-contestuale-design.md`

## Attività

- [x] Test RED del builder per campi, selezioni, xterm e azioni contestuali.
- [x] Implementare `electron/context-menu.cjs` senza dipendenze dal renderer.
- [x] Registrare il menu nativo nel main process con validazione dei comandi.
- [x] Aggiungere Copia/Incolla xterm al bus dei comandi e ai due terminali.
- [x] Aggiornare tipi e test dei confini IPC.
- [x] Eseguire test, lint, build, `git diff --check` e collaudo dev.
- [x] Committare con messaggi descrittivi in italiano e pubblicare su `main`, senza creare release.
