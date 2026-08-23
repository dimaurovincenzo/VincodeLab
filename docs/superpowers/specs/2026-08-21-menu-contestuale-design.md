# Menu contestuale globale — Design

## Obiettivo

Offrire in tutta VincodeLab un menu nativo al clic destro. Il nucleo minimo contiene Copia e Incolla; i controlli editabili ricevono anche Annulla, Ripeti, Taglia e Seleziona tutto. Le aree operative aggiungono soltanto azioni coerenti con la sezione attiva.

## Architettura

Un listener globale del renderer identifica soltanto la natura del target cliccato: controllo editabile, presenza di una selezione o canvas xterm. Il main process valida questo descrittore minimale, costruisce il menu nativo con ruoli Electron per i normali controlli HTML e inoltra le azioni applicative tramite il bus esistente `appMenu:command`.

Il renderer non invia template, label, nomi di comandi o callback. Tutti i comandi applicativi appartengono all'allowlist già condivisa con il menu macOS. Questa scelta mantiene un solo catalogo di azioni, evita menu HTML duplicati e conserva `contextIsolation`.

## Comportamento

- Campi editabili: Annulla, Ripeti, Taglia, Copia, Incolla e Seleziona tutto, abilitati in base agli `editFlags` nativi.
- Testo non editabile: Copia e Incolla sempre visibili; Copia è disponibile quando esiste una selezione, Incolla resta disabilitato quando il target non può ricevere testo.
- Terminale AI e Terminale libero: Copia e Incolla usano le API xterm esistenti, perché i ruoli DOM non possono operare sul canvas del terminale.
- Editor: Salva file, Cerca nel file, Aggiorna Explorer.
- GitHub: Aggiorna dati GitHub, Verifica aggiornamenti remoti.
- Database: Esegui SQL, Aggiorna schema.
- Impostazioni e home: nessuna azione applicativa aggiuntiva.

Le azioni remote o potenzialmente mutative riusano gli handler UI esistenti, incluse conferme, stati disabilitati e notifiche. Il menu contestuale non accede direttamente a Git, database, filesystem o PTY.

## Rischi e limiti

- Il menu dipende dalla sezione attiva registrata nel main process; un tipo di target non riconosciuto ricade sul menu base.
- I terminali richiedono comandi dedicati per Copia/Incolla; sugli input interni alla toolbar prevalgono invece i ruoli nativi.
- Nessuna persistenza o migrazione dati è necessaria.

## Verifica

- Unit test del template: input editabile, testo selezionato, terminali e azioni per sezione.
- Test allowlist: rifiuto di comandi arbitrari.
- Test integrazione main/preload: un solo listener nativo e nessuna nuova API Node nel renderer.
- Suite completa, lint, build, `git diff --check` e prova nel runtime Electron dev.
