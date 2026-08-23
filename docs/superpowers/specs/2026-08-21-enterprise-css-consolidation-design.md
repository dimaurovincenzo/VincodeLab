# Consolidamento CSS e Workbench enterprise

## Stato della decisione

La direzione approvata e un **Workbench enterprise compatto**, vicino a un IDE e a un client database desktop. Questa specifica sostituisce le indicazioni puramente visuali di `2026-08-20-ux-ui-redesign-design.md` quando prescrivono card rialzate, raggi 6/10/14 e un linguaggio da dashboard. Restano validi i flussi, i contratti funzionali, i requisiti di accessibilita e le conferme gia definite.

## Obiettivo

Rendere VincodeLab un'applicazione desktop professionale, densa e coerente, eliminando la percezione da SaaS e riducendo il costo di manutenzione del CSS. Il risultato deve offrire la stessa gerarchia e gli stessi stati in tema chiaro e scuro, senza dipendere dall'ordine accidentale degli import o da override globali.

Il lavoro procede per tranche e per singola vista. Ogni tranche deve lasciare l'app utilizzabile, verificabile e reversibile.

## Evidenza iniziale

L'audit del 21 agosto 2026 rileva:

- 11 file CSS applicativi e circa 2.572 righe;
- 1.836 selettori analizzati dal parser PostCSS;
- 147 selettori collidenti e 268 coppie selettore/proprieta dichiarate in file differenti;
- 93 dichiarazioni `!important` in `src/design-system.css`;
- temi distribuiti tra `prefers-color-scheme`, `data-theme` e regole di compatibilita;
- `src/design-system.css` usato contemporaneamente come token layer, base globale, libreria componenti e foglio di correzione delle viste;
- import CSS ordinati per ottenere precedenza, con `settings.css` caricato dopo il design system;
- bundle JavaScript principale dichiarato inizialmente a 454,20 kB e misurato a 463,98 kB il 21 agosto 2026;
- CSS compilato misurato a 181,17 kB.

La differenza del bundle JavaScript e registrata come trend, non come problema da ottimizzare.

## Linguaggio visuale

### Geometria e densita

- Le pagine sono superfici operative continue, non collezioni di card.
- Pannelli, alberi, tabelle, editor e inspector sono separati da bordi e split pane.
- I controlli ordinari hanno altezza 28-32 px; 36 px e riservato a campi o CTA che richiedono maggiore evidenza.
- I raggi standard sono 2 px e 4 px. Modali e popover possono usare 6 px.
- Le ombre sono riservate a modali, menu, tooltip e superfici realmente sovrapposte.
- La spaziatura segue la scala 2/4/6/8/12/16/24, privilegiando 4/8/12 nelle viste operative.
- La tipografia ordinaria resta 12-13 px; 11 px per metadati e 14-16 px per intestazioni di sezione.

### Colore e gerarchia

- L'accento identifica selezione, focus, stato attivo e singola azione primaria.
- Le superfici differiscono principalmente per luminosita e bordo, non per gradienti o ombre.
- I gradienti decorativi vengono rimossi.
- Successo, avviso, errore, informazione e stato inattivo usano token semantici stabili.
- Gli stati Git e GitHub Project mantengono colori distinti e leggibili in entrambi i temi.
- Hover e selezione sono distinguibili: l'hover e temporaneo e leggero, la selezione e persistente e piu netta.

### Comportamento desktop

- Le toolbar sono compatte, allineate e con gruppi di azioni separati.
- Le azioni secondarie sono iconiche solo quando icona, tooltip e nome accessibile sono inequivocabili.
- Le viste vuote non diventano hero promozionali: descrivono stato, causa e prossima azione.
- Modali e menu contestuali sono gli unici contenitori flottanti principali.
- Il ridimensionamento dei pannelli conserva limiti minimi, stato e affordance condivisi.

## Architettura CSS target

```text
src/styles/
├── tokens.css
├── themes.css
├── base.css
├── primitives.css
├── shell.css
└── views/
    ├── home.css
    ├── ai.css
    ├── editor.css
    ├── terminal.css
    ├── github.css
    ├── database.css
    └── settings.css
```

### Responsabilita dei layer

`tokens.css`
: Definisce scale, dimensioni, raggi, motion e ruoli semantici senza selettori di vista.

`themes.css`
: Assegna esclusivamente valori ai token per `light`, `dark` e `system`. Non contiene regole di componenti.

`base.css`
: Contiene reset, tipografia, focus, selezione, scrollbar e comportamento degli elementi nativi. Non corregge classi applicative.

`primitives.css`
: Contiene pulsanti, campi, tab, badge, menu, dialog, toolbar e stati comuni. Le primitive espongono varianti esplicite, non dipendono dalla pagina ospitante.

`shell.css`
: Governa finestra, header, navigazione principale, area contenuti, split pane, resize handle e boundary di errore che mantiene visibile la toolbar.

`views/*.css`
: Ogni file governa esclusivamente layout e componenti specifici della propria vista. Non ridefinisce primitive globali.

## Tema chiaro e scuro

La preferenza applicativa e la sola fonte di verita. `system` segue il sistema operativo, mentre `light` e `dark` lo sovrascrivono. Il renderer espone un unico attributo sul nodo radice; i componenti consumano soltanto token semantici.

Vincoli:

- nessuna palette duplicata dentro le viste;
- nessun selettore `[data-theme="dark"]` nei file `views`;
- `prefers-color-scheme` e confinato al bootstrap del valore `system`;
- contrasto e gerarchia devono essere equivalenti, non semplicemente invertiti;
- xterm e CodeMirror ricevono temi derivati dagli stessi ruoli semantici, mantenendo le proprie API.

## Regole di specificita e override

- Un componente ha un solo proprietario CSS.
- La specificita ordinaria non supera una classe di componente piu uno stato.
- `!important` e vietato, salvo integrazioni di terze parti documentate accanto alla regola.
- Le varianti usano classi o attributi espliciti; non si correggono tramite posizione nell'albero.
- L'ordine degli import non deve essere necessario per risolvere collisioni tra viste.
- Le regole temporanee di compatibilita devono contenere il prefisso `legacy-bridge` nel commento, una vista proprietaria e il criterio di rimozione.
- A fine tranche, il conteggio delle collisioni e degli `!important` non puo aumentare.

## Inventario e tracciamento del debito

Lo script di audit deve produrre un report ripetibile con:

- selettore;
- proprieta collidente;
- file e posizione delle dichiarazioni;
- proprietario target;
- vista coinvolta;
- stato `legacy`, `migrato` o `eccezione documentata`.

Il report diventa una verifica tecnica, non un file aggiornato manualmente. La baseline PostCSS riproducibile e 147 selettori collidenti, 268 coppie selettore/proprieta e 140 occorrenze `!important` complessive rilevate nei CSS applicativi; i valori vengono ricalcolati prima di ogni tranche.

## Ordine di migrazione

### Tranche 1 — Fondazioni e shell

- creare i layer target;
- unificare tema e token;
- migrare header, navigazione, tab, toolbar, pulsanti, campi, dialog e resize handle;
- mantenere la toolbar principale visibile nei boundary di errore;
- introdurre audit automatico e baseline visive.

### Tranche 2 — Terminale e AI

- migrare Terminale AI, Terminale libero, File remoti, drawer Comandi, Skill e Istruzioni;
- verificare xterm dopo cambio tab, reload, resize e tema;
- preservare PTY, sessioni e trasferimenti remoti.

### Tranche 3 — Editor

- migrare explorer, tab file, toolbar, ricerca, preview e stati Git;
- verificare resize sidebar, file speciali, salvataggio e preview.

### Tranche 4 — Database

- migrare explorer, oggetti, editor SQL, griglia, split pane, cronologia e modali;
- verificare loading, errori, transazioni, fullscreen dei pannelli e modifica dati.

### Tranche 5 — GitHub

- migrare Modifiche, Grafo, Issue e Project;
- preservare colori semantici, gruppi, sub-issue, ricerca numerica, caricamenti e conferme remote.

### Tranche 6 — Home e Impostazioni

- migrare recenti, apertura workspace, impostazioni globali e override workspace;
- eliminare gli ultimi bridge legacy e i vecchi fogli non piu referenziati.

L'ordine puo cambiare solo per una dipendenza tecnica dimostrata. Fondazioni e shell restano la prima tranche.

## Strategia di verifica

### Test automatici

- test strutturali sugli import e sui confini dei layer;
- test dell'audit collisioni e `!important`;
- test dei token obbligatori per entrambi i temi;
- test funzionali esistenti della vista migrata;
- `npm test`, `npm run lint`, `npm run build` e `git diff --check` a ogni tranche.

### Baseline visive

Per tema chiaro e scuro vengono acquisite almeno queste viste:

- Home;
- Terminale AI;
- Terminale libero e File remoti;
- Editor con explorer e file aperto;
- GitHub: Modifiche, Grafo, Issue e Project;
- Database con explorer, SQL e griglia;
- Impostazioni Generali.

Ogni vista viene controllata a viewport ampio e ristretto. La review copre overflow, elementi tagliati, spazi vuoti anomali, focus, loading, empty state, errore, modal e menu contestuale.

### Regressione funzionale

La migrazione CSS non modifica callback, IPC o persistenza. Ogni tranche ripete i flussi principali correlati e almeno un caso di errore. Le sessioni xterm, gli editor embedded e gli split pane richiedono verifica runtime nella sessione Electron con hot reload.

## Monitoraggio bundle

Il bundle non e un obiettivo di ottimizzazione in questa iniziativa.

- Baseline dichiarata: 454,20 kB per il main JavaScript.
- Misura corrente: 463,98 kB raw e 142,48 kB gzip.
- CSS corrente: 181,17 kB raw e 28,04 kB gzip.
- Ogni tranche registra main JavaScript e CSS, raw e gzip, prodotti da `npm run build`.
- Nessun intervento viene aperto per una variazione non accompagnata da superamento della soglia stabilita o da un problema misurabile di caricamento, memoria o interazione.
- Le metriche devono confrontare lo stesso tipo di artefatto; non si confronta raw con gzip.

## Impatto e rischi

### Compatibilita

Il cambiamento e limitato al renderer e non deve modificare contratti IPC o formato dei dati. Il rischio maggiore e una regressione di layout dovuta a classi condivise implicitamente.

### Prestazioni

La rimozione degli override puo ridurre lavoro CSS, ma non viene considerata un'ottimizzazione finche non e misurata. Nessuna nuova libreria visuale viene introdotta.

### Manutenibilita

Il beneficio atteso e la proprieta esplicita delle regole. Le tranche non devono produrre un secondo design system parallelo permanente.

### Rollback

Ogni tranche e un commit autonomo. I bridge legacy garantiscono compatibilita temporanea, ma devono essere rimossi nella tranche proprietaria. Il rollback avviene per tranche senza ripristinare file gia eliminati da tranche precedenti consolidate.

## Criteri di completamento

Il lavoro e completo soltanto quando:

- tutte le viste elencate sono migrate e verificate in chiaro e scuro;
- non esistono collisioni non classificate;
- nessun `!important` applicativo rimane, salvo eccezioni di terze parti documentate;
- `dark-theme.css` e gli override tardivi non sono piu necessari;
- l'ordine degli import non governa la correttezza delle viste;
- la UX usa densita, geometria e gerarchia del Workbench enterprise approvato;
- test, lint, build, audit CSS e verifica runtime risultano positivi;
- il trend del bundle e registrato senza ottimizzazioni speculative;
- non risultano regressioni funzionali note Critical o High.
