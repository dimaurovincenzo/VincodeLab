# VincodeLab — baseline visiva enterprise

Data: 21 agosto 2026
Commit applicativo verificato: `ea47408`
Stato: **completa per il consolidamento CSS**

## Ambito e metodo

Le sette viste principali sono state aperte nella stessa applicazione Electron
con viewport ampia `1320 × 768`, prima in tema chiaro e poi in tema scuro. Home,
Terminale AI, Terminale libero, Database e Impostazioni sono state controllate
anche con finestra inferiore a 900 px. Le prove strette non sono conservate come
screenshot: l'esito è registrato nella matrice.

Le verifiche runtime sono state non distruttive. Nessuna issue, Project, commit,
push, query mutativa o impostazione sensibile è stata inviata a servizi remoti.
Gli stati funzionali già coperti dai test automatici restano distinti dalle
prove visuali manuali.

Legenda: **PASS** verificato; **FAIL** difetto riproducibile aperto; **N/A** stato
non applicabile o non riprodotto nella sessione, con motivazione esplicita.

## Matrice QA

| Vista | Chiaro | Scuro | Ampio | Stretto | Overflow | Focus | Loading | Empty | Errore | Modal/menu | Flusso funzionale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home | PASS — gerarchia compatta | PASS — contrasto coerente | PASS — canvas continuo | PASS — toolbar e stato vuoto entro 850 px | PASS — nessun overflow finestra | PASS — controlli raggiungibili | PASS — geometria stabile dai test | PASS — stato iniziale verificato | PASS — boundary conserva la shell dai test | N/A — nessun modal nel flusso base | PASS — scelta workspace e recenti coperti |
| Terminale AI | PASS — toolbar e PTY leggibili | PASS — superficie codice coerente | PASS — footer integro | PASS — controlli e recupero entro 850 px | PASS — nessuna barra orizzontale della pagina | PASS — ordine toolbar preservato | PASS — avvio Pi con feedback | N/A — la sessione ha sempre uno stato esplicito | PASS — errore Pi locale con azione di recupero | PASS — allegati e menu coperti dai test | PASS — sessione, resize e ritorno tab coperti |
| Terminale remoto | PASS — shell uniforme | PASS — shell uniforme | PASS — pannelli allineati | PASS — boundary di sezione resta nella shell; contenuto runtime non riprodotto | PASS — contenitore vincolato | PASS — tab e controlli accessibili | PASS — attesa e connessione esplicite dai test | PASS — assenza profilo esplicita | PASS — boundary locale non elimina la navigazione | PASS — drawer e profili coperti dai test | PASS — profili, copie e trasferimenti coperti dai test |
| Editor | PASS — explorer e codice distinti | PASS — contrasto codice coerente | PASS — master-detail compatto | N/A — non acquisito manualmente sotto 900 px; resize coperto strutturalmente | PASS — pane confinato | PASS — tab, explorer e ricerca coperti | PASS — lettura file con feedback dai test | PASS — nessun file selezionato coperto | PASS — lettura non supportata gestita dai test | PASS — ricerca e preview coperte | PASS — modifica, salvataggio e preview coperti |
| Database | PASS — SQL e griglia separati | PASS — superfici operative coerenti | PASS — splitter continuo | PASS — toolbar e boundary locale entro 850 px | PASS — nessun overflow pagina | PASS — sidebar, splitter e azioni coperti | PASS — loader schema esplicito dai test | PASS — nessuna connessione selezionata verificata | PASS — errore locale conserva shell e navigazione | PASS — connessione e conferme coperte dai test | PASS — schema/query/griglia coperti senza mutazioni |
| GitHub | PASS — gerarchia workbench | PASS — stati e corsie leggibili | PASS — area operativa continua | N/A — non acquisito manualmente sotto 900 px; layout adattivo coperto dai test | PASS — pane e tabelle confinati | PASS — tab e righe azionabili | PASS — Issue e Project espongono caricamento | PASS — modifiche vuote verificate | PASS — boundary vista preserva shell dai test | PASS — dettaglio Issue e conferme coperte | PASS — Git, Issue e Project coperti in sola lettura |
| Impostazioni | PASS — righe preferenza leggibili | PASS — token centralizzati | PASS — pannelli bilanciati | PASS — griglia e tab entro 850 px | PASS — nessun overflow orizzontale | PASS — controlli nativi e tab raggiungibili | PASS — aggiornamenti con feedback dai test | PASS — cataloghi vuoti gestiti dai test | PASS — errori runtime confinati dai test | PASS — selettori e conferme coerenti | PASS — valori globali/workspace distinti |

## Evidenze visuali

Le immagini originali della sessione storica non sono incluse nel repository
pubblico perché erano state acquisite su un workspace di sviluppo non
sanitizzato. Le evidenze pubblicabili correnti vengono generate sul workspace
demo isolato seguendo la [procedura screenshot](../screenshots.md).

## Gate di completamento

- Tutte le viste consumano il singolo entrypoint `src/styles/index.css`.
- I fogli legacy sono stati rimossi.
- Le viste non contengono selettori tema né palette locali.
- Non restano dichiarazioni applicative `!important`.
- Le collisioni residue sono sotto budget e controllate dall'audit automatico.
- La navigazione principale resta disponibile quando una singola vista fallisce.
- Non risultano bug CSS Critical o High conosciuti al termine della verifica.

Esito: **baseline approvata per il consolidamento CSS enterprise**. Il gate non
autorizza una release e non sostituisce le prove distruttive su ambienti di test
dedicati per GitHub e Database.
