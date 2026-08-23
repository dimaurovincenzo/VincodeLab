# Database — griglia dati modificabile

## Obiettivo

Estendere il Database workspace con una vista dati della tabella selezionata,
simile a un foglio Excel. L'utente può cercare tabelle e colonne, consultare
le righe con paginazione, modificare celle in modo controllato e applicare le
variazioni soltanto nella transazione esplicita già prevista dal prodotto.

Non è un diagramma ER: la rappresentazione grafica richiesta è la griglia dei
dati reali della tabella.

## Decisioni confermate

- Il click su una tabella apre la griglia dati; continua anche a predisporre
  l'anteprima SQL nell'editor, così SQL e vista visuale restano coordinati.
- La ricerca individua tabelle e colonne nello schema già caricato, senza
  eseguire query aggiuntive durante la digitazione.
- La griglia viene caricata paginata dal main process: non vengono trasferite
  tutte le righe al renderer.
- Le celle sono modificabili soltanto quando l'introspezione identifica una
  chiave primaria completa e la connessione consente la scrittura.
- Le modifiche restano bozze nella griglia finché l'utente non seleziona
  **Salva modifiche**; questa azione richiede una transazione attiva.
- **Commit** rende persistenti gli aggiornamenti; **Rollback** annulla la
  transazione e scarta le bozze della griglia.
- Mancanza di PK, permessi insufficienti, tipi non editabili o errori di
  lettura producono una vista in sola lettura con motivazione esplicita.

## Alternativa scelta

1. **Griglia integrata e API database esplicite — scelta.** Il main process
   legge metadati, pagina e aggiorna righe usando query parametrizzate; il
   renderer gestisce solo interazione, bozze e feedback.
2. SQL costruito dal renderer. Scartato: rende più fragile il confine Electron
   e aumenta il rischio di query non parametrizzate.
3. Dipendenza data-grid esterna. Scartata: il requisito iniziale non richiede
   virtualizzazione avanzata, formule o import/export; il layout esistente è
   sufficiente e mantiene coerente la UX.

## Contratti

### Metadati schema

`inspectSchema` estende ciascuna tabella con colonne e chiave primaria:

```ts
type DatabaseColumn = {
  name: string
  type?: string
  nullable: boolean
  primaryKeyPosition?: number
  editable: boolean
}

type DatabaseTableSchema = {
  name: string
  columns: DatabaseColumn[]
  primaryKey: string[]
}
```

L'ordine PK serve per aggiornamenti composti. `editable` è falso per colonne
di sistema, generate, binarie/LOB non supportate o senza PK nella tabella.

### Lettura griglia

Il preload espone `database.tableRows(connectionId, tableName, options)` con
`{ offset, limit, filter? }`. Il main process verifica workspace e connessione,
valida un identificatore schema-tabella già restituito da `inspectSchema` e
genera SQL per il solo driver corrente. Restituisce:

```ts
type DatabaseTablePage = {
  table: DatabaseTableSchema
  rows: Record<string, unknown>[]
  offset: number
  hasMore: boolean
  durationMs: number
  readOnlyReason?: string
}
```

Il filtro cerca nelle sole colonne testuali supportate, parametrizzato per ogni
driver. Un filtro vuoto non cambia la query. Il limite iniziale è 100 righe e
non può superare 500.

### Aggiornamenti

`database.updateTableRows(connectionId, tableName, changes)` riceve un elenco
limitato di bozze `{ key, values }`, dove `key` contiene tutti i valori PK
originari e `values` contiene le sole colonne variate. L'handler rifiuta:

- assenza di una transazione attiva per la connessione;
- tabella/colonne non appartenenti allo schema introspezionato;
- PK incompleta, valori non serializzabili, identificatori non validi;
- modifiche a colonne non editabili o chiavi primarie.

Il servizio costruisce `UPDATE` parametrizzati con clausola `WHERE` su ogni
colonna PK e verifica una riga aggiornata per ciascuna bozza. Se una riga non
è più trovata, la griglia segnala conflitto e non dichiara il salvataggio.

## Esperienza utente

La sidebar Database riceve un campo **Cerca nello schema** prima dell'elenco.
Ogni risultato espone nome tabella e numero di colonne; il match su colonna
rimane leggibile come `tabella · colonna`.

L'area risultati diventa una tab interna:

- **Risultato SQL** conserva il comportamento attuale.
- **Dati tabella** appare quando si seleziona una tabella e include ricerca,
  aggiornamento, contatore righe, carica altre righe e stato di sola lettura.

Le celle sono pulsanti/controlli accessibili: Invio avvia l'editing, Esc annulla
la bozza, Tab passa alla cella seguente. Celle modificate ricevono un indicatore
visivo e una descrizione accessibile. Il footer mostra il numero di modifiche
in sospeso, **Scarta bozze** e **Salva modifiche**.

**Salva modifiche** è disabilitato senza transazione o bozze. Prima di inviare
aggiornamenti, un `ConfirmationDialog` riepiloga tabella e numero di righe;
non riporta valori potenzialmente sensibili. `Rollback` pulisce la griglia;
`Commit` ricarica dati e schema per riflettere trigger/default del database.

## Driver e tipi

SQLite legge PK da `PRAGMA table_info`, SQL Server da `INFORMATION_SCHEMA` e
vincoli, PostgreSQL da `pg_catalog`, MySQL da `information_schema`. Il primo
contratto di test è SQLite; gli altri driver implementano lo stesso DTO.

Sono inizialmente editabili `text/varchar/nvarchar`, numeri, booleani/date e
valori null. Blob, JSON complesso, XML, geometry, colonne calcolate e identity
restano leggibili ma non editabili. Il valore vuoto non viene convertito in
`NULL` automaticamente: la UI offre un'azione esplicita **Imposta NULL** solo
per colonne nullable.

## Errori, concorrenza e prestazioni

- Errori restano normalizzati in italiano e non includono SQL, password o
  valori cella.
- La ricerca non blocca l'editor: viene filtrata in memoria con debounce lato
  renderer.
- Il caricamento è cancellabile logicamente: risultati di una tabella o filtro
  precedente non sovrascrivono la selezione corrente.
- Il confronto PK impedisce aggiornamenti su righe diverse; non implementa un
  lock ottimistico universale perché i driver non offrono un token comune.
- Dopo errori di update, la transazione resta controllabile: l'utente può
  correggere, riprovare o eseguire Rollback.

## Verifica

- Test servizio per PK semplice/composta, identificatori, filtro
  parametrizzato, limite, update transazionale, conflitto e rollback.
- Test preload/main per superficie IPC minimale, workspace isolation e rifiuto
  update fuori transazione.
- Test UI per ricerca schema, sola lettura senza PK, bozze, conferma, tastiera,
  annullamento e aggiornamento dopo Commit/Rollback.
- Verifica manuale con SQLite temporaneo: tabella con PK, tabella senza PK,
  aggiornamento, rollback, commit, filtro e 501 righe.
