# VincodeLab UX foundations

## Obiettivo

Rendere VincodeLab un cockpit affidabile per un workspace locale: ogni sezione deve comunicare subito il proprio stato, preservare spazio operativo e non esporre accidentalmente file sensibili.

## Flussi e decisioni

### Workspace recenti

- La home resta focalizzata su una sola azione primaria: aprire un workspace.
- Recenti mostra quantità, ricerca con esito esplicito e card/lista più leggibili; i controlli di vista diventano secondari.
- Durante l'apertura, la card selezionata e l'azione primaria mostrano uno stato coerente di caricamento.

### Navigazione del workspace

- AI, Editor e Terminale sono pagine mutuamente esclusive, con stato attivo, label e scorciatoie coerenti.
- Le sezioni lazy-loaded non attive non devono restare percepibili né raggiungibili da tastiera/accessibility tree.
- Ogni pagina espone un titolo, una descrizione breve e uno stato operativo; il cambio sezione conserva lo stato già caricato.

### Terminali

- Pi e shell libera condividono struttura: stato iniziale visibile, stato pronto, errore ed empty state distinguibili.
- Il terminale libero visualizza subito "Avvio shell" con spinner e non appare come una superficie rotta; al prompt pronto indica workspace e shell.
- I comandi di terminale mantengono tooltip, label accessibili e scorciatoie. Non viene introdotta alcuna esecuzione automatica o preset eseguibile.

### Editor ed explorer

- L'explorer riceve ricerca locale, gerarchia più leggibile, contatore/stato di caricamento e un'altezza stabile.
- File che possono contenere credenziali (`.env`, `.env.*`, chiavi e certificati) sono esclusi a livello main process: non compaiono, non sono leggibili e non sono salvabili tramite IPC. I template esplicitamente sicuri (`.env.example`, `.env.sample`, `.env.template`) restano visibili.
- Il minimap diventa un dettaglio discreto: larghezza ridotta e nascosto su finestre strette. Barra e tab indicano chiaramente file, modifiche non salvate e scorciatoie (`Cmd/Ctrl+S`, `Cmd/Ctrl+F`).
- La chiusura di un tab con modifiche resta confermata; il salvataggio conserva il contratto atomico esistente.

### Coerenza visiva e accessibilità

- Si uniformano densità, colori di stato, terminologia italiana e gerarchia tipografica.
- Ogni controllo icon-only conserva label accessibile e tooltip; focus visibile e contrasto vengono mantenuti.
- Nessuna modifica a IPC non correlato, gestione workspace, PTY o formato dei dati persistiti.

## Impatto e rischi

- Il filtro dei file protegge dati locali ma può nascondere configurazioni che oggi alcuni utenti modificano dall'editor. La scelta è intenzionale: tali file continuano a essere gestibili dal terminale, che rende esplicita l'azione.
- L'accessibilità delle pagine inattive viene corretta senza smontare le sezioni già caricate, quindi non si interrompono PTY o tab aperti.
- Le modifiche sono locali al renderer e al filtraggio file dell'IPC; nessuna migrazione, dipendenza o cambiamento di packaging.

## Validazione

1. Typecheck e lint.
2. Avvio Electron in sviluppo, apertura di un workspace recente e di una cartella scelta.
3. Verifica manuale AI, Editor, Terminale, ricerca recenti, ricerca explorer, apertura/salvataggio file e chiusura tab modificato.
4. Verifica che `.env` non sia elencato, letto né scritto dall'IPC mentre `.env.example` resti disponibile.
5. Verifica visuale su finestra normale e stretta: minimap, sidebar, stati di caricamento e focus tastiera.

## Rollback

Le modifiche non alterano dati. In caso di regressione il rollback consiste nel ripristino dei file renderer e del filtro `electron/project-files.cjs`; nessun dato workspace richiede recupero.
