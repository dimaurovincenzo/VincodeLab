# Screenshot pubblici

Gli screenshot del README devono mostrare l'app Electron reale nel workspace riproducibile [`examples/demo-workspace`](../examples/demo-workspace). Non devono esporre dati personali né simulare funzionalità che l'app non possiede.

## Immagini canoniche

| File | Vista |
| --- | --- |
| `assets/screenshots/ai-workbench.png` | Terminale AI e identità generale del workspace |
| `assets/screenshots/editor-workspace.png` | Explorer ed editor con file dimostrativo |
| `assets/screenshots/terminal-workspace.png` | Sessioni shell del workspace |
| `assets/screenshots/git-workspace.png` | Stato Git/diff con repository fixture |
| `assets/screenshots/database-workspace.png` | Editor SQL, schema e risultati fixture |
| `assets/screenshots/settings.png` | Impostazioni globali e del workspace |

Le sottodirectory esistenti in `assets/screenshots/` conservano baseline visuali storiche e non sostituiscono queste immagini pubbliche.

## Dati ammessi

Usa soltanto:

- nomi neutri come `vincodelab-demo`;
- file, commit e branch creati per la fixture;
- output terminale breve e preparato per la dimostrazione;
- database SQLite locale con persone, prodotti e valori inventati;
- issue o board simulate soltanto quando provengono da fixture locali chiaramente non reali.

Non mostrare:

- percorsi home assoluti, nome account macOS o directory personali;
- repository privati, remote URL, organizzazioni o account reali;
- token, password, chiavi SSH, host, email o connection string;
- prompt AI e cronologia shell provenienti da sessioni personali;
- notifiche di sistema, altre finestre, barra dei menu con dati non necessari;
- dati di produzione o informazioni identificabili anche se parzialmente sfocati.

Lo sfocamento non è una sanitizzazione affidabile: ricrea lo stato con dati fittizi.

## Procedura

1. Crea il workspace demo in una directory temporanea:

   ```bash
   npm run demo:create
   ```

   Per rigenerare la destinazione predefinita usa `--force`: lo script rifiuta di eliminare cartelle prive del proprio marker di sicurezza.

2. Usa una directory dati VincodeLab isolata, così recenti e preferenze personali non entrano nell'immagine.
3. Imposta una finestra coerente e controlla sia il contenuto centrale sia titlebar, sidebar e tooltip.
4. Mostra un singolo percorso comprensibile per immagine, senza dialog o menu accidentali.
5. Cattura la finestra Electron reale alla risoluzione prevista; evita mockup o ricostruzioni grafiche.
6. Ispeziona l'immagine a dimensione originale e rimuovi i metadati non necessari.
7. Verifica il link dal README e aggiungi un testo alternativo descrittivo.

La cattura automatizzata applica questi vincoli a un bundle già creato:

```bash
npm run screenshots:capture -- \
  --app release/mac-arm64/VincodeLab.app
```

Lo script usa un profilo temporaneo, il workspace demo, un runtime Pi fittizio e offline e un renderer Electron reale; blocca la rete esterna e ripulisce i dati temporanei. Controlla comunque visivamente ogni PNG prima di pubblicarlo.

Quando cambia in modo sostanziale una vista, aggiorna soltanto gli screenshot coinvolti e annota nella pull request workspace fixture, tema e dimensione della finestra usati.
