# Ridisegno UX Git workspace

## Obiettivo

Rendere le schede **Modifiche** e **Issue** leggibili come strumenti operativi desktop, eliminando card concorrenti, grandi aree vuote e duplicazioni con la scheda Grafo.

## Ambito

- Solo renderer React e CSS della sezione Git.
- Nessuna modifica ai contratti IPC, ai servizi Git/GitHub o ai dati persistenti.
- Restano invariati conferme, protezione dei file sensibili e permessi delle azioni remote.
- Grafo e Progetti restano schede indipendenti.

## Modifiche

La scheda usa un flusso master-detail:

- una barra operativa compatta mostra branch attivo, stato upstream e azioni di sincronizzazione;
- il cambio branch e la creazione di un branch vivono in un pannello compatto, non in una card principale;
- il pannello sinistro contiene i gruppi comprimibili `Modifiche` e `Pronti per il commit`;
- la preparazione del commit resta esplicita per singolo file o per gruppo;
- il compositore del commit resta vicino ai file in staging e comunica quando non è utilizzabile;
- il pannello destro mostra il diff del file selezionato oppure uno stato vuoto operativo;
- la cronologia lineare viene rimossa da Modifiche perché è già disponibile nella scheda Grafo;
- il layout passa a una colonna su viewport stretti senza perdere azioni.

## Issue

La scheda è list-first:

- elenco e filtri occupano tutta la superficie disponibile;
- la creazione di una issue si apre da `Nuova issue` in un modal accessibile;
- la toolbar contiene ricerca, filtro stato, conteggio visibile e azione di creazione;
- la ricerca accetta `175` e `#175` come numero esatto, oltre a titolo, descrizione ed etichette;
- ogni riga separa numero, stato, titolo, metadati ed etichette;
- il click sulla riga continua ad aprire il modal di dettaglio;
- caricamenti, errori e risultati vuoti non alterano la geometria della pagina.

## Accessibilita e comportamento

- Le tab mantengono `role=tablist`, `aria-selected` e navigazione da tastiera.
- I modal trattengono il focus, si chiudono con `Escape` e ripristinano il focus al trigger.
- I gruppi comprimibili espongono `aria-expanded` e un nome accessibile.
- Le azioni distruttive o mutative continuano a usare la conferma interna all'app.
- Gli stati disabilitati spiegano il prerequisito tramite testo o tooltip.

## Validazione

- Test TDD sulla nuova gerarchia Modifiche.
- Test TDD sulla ricerca per numero issue e sul modal di creazione.
- Regressione delle tab Git, del dettaglio issue, delle conferme e dei dati GitHub.
- `npm test`, `npm run lint`, `npm run build` e `git diff --check`.
- Verifica manuale nella sessione Electron con hot reload a viewport ampio e ristretto.

## Rischi e rollback

Il rischio principale e una regressione nelle azioni Git durante il riordino del markup. Le callback esistenti non vengono modificate e i test verificano la presenza delle azioni. Il rollback e limitato ai file renderer della sezione Git e ai relativi test.
