---
name: vincodelab-electron-capability
description: Aggiunge o modifica capacità native, servizi Electron, preload e IPC di VincodeLab. Usala quando una richiesta coinvolge filesystem, processi, PTY, CLI, persistenza, bridge renderer, canali IPC, timeout, cancellazione o errori provenienti dal main process.
---

# Capacità Electron e IPC

## Disegno obbligatorio

Prima di scrivere codice, definisci operazione, input, output, limiti, timeout, cancellazione, errore pubblico e recovery. Mantieni questa direzione:

```text
renderer feature -> @/bridge -> preload -> IPC -> domain <- infrastructure
                                      electron/main.cjs compone le dipendenze
```

- Policy e use case appartengono a `electron/domains/<area>/`.
- CLI, filesystem, driver, rete e storage concreti appartengono a `electron/infrastructure/<area>/` e implementano porte piccole.
- I registrar appartengono a `electron/ipc/domains/`, validano mittente e argomenti ed esportano manifesti immutabili dei canali.
- Le sorgenti del bridge appartengono a `electron/preload/`; `electron/preload.cjs` è generato e non va modificato manualmente.
- `electron/main.cjs` è l'unica composition root. Non aggiungere service locator, singleton mutabili o facciate legacy alla radice `electron/`.

## Sicurezza e affidabilità

1. Applica paginazione e budget prima della materializzazione, non con uno `slice()` tardivo.
2. Rendi bounded apertura, comando, cancellazione e chiusura. Dopo un errore, una nuova operazione deve poter funzionare.
3. Non inviare al renderer stack trace, output raw di processi o driver, segreti, connection string e percorsi interni non necessari.
4. Classifica l'errore nel main, conserva la diagnostica sanitizzata e restituisci un contratto utile alla recovery UI.
5. Mantieni `sandbox`, `contextIsolation` e superficie preload minima. Non esporre API generiche per shell, filesystem o rete.
6. Aggiorna insieme sorgenti preload, `src/vincode-lab.d.ts`, contratti in `src/bridge/` e adapter della feature.

## Verifica

Aggiungi test di dominio/adapter, registrar IPC, guardie, argomenti, canali preload, timeout/cancellazione ed errore. Esegui:

```bash
npm run build:preload
npm run check:preload
npm run check:architecture
npm test
npm run build
git diff --check
```

Per una capacità nativa verifica anche il percorso reale in Electron; per packaging usa la skill `vincodelab-verification-release`.
