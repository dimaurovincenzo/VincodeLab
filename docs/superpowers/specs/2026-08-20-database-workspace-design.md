# Database workspace — Design

## Obiettivo

Introdurre una tab principale **Database** in VincodeLab per gestire e usare, nel solo workspace aperto, connessioni SQL Server, PostgreSQL, MySQL e SQLite. L'utente può creare profili, esplorare gli schemi, scrivere ed eseguire SQL con il dialetto corretto, consultare risultati, usare transazioni e mantenere query salvate e cronologia.

## Decisioni confermate

- Tutte le risorse Database appartengono esclusivamente al `workspace_path` attivo; non esiste un catalogo globale.
- La prima versione è completa: lettura, DML, DDL, transazioni, query salvate, cronologia e risultati.
- Le credenziali vengono salvate in chiaro nel database locale `vincodelab.sqlite`, su richiesta esplicita dell'utente. La UI può leggerle e modificarle senza mascheramenti.
- Query mutative (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `GRANT`, `REVOKE`, `EXEC`) richiedono sempre una conferma che mostra il testo SQL prima dell'invio.
- Non si registrano in log applicativi né password né testo SQL; il testo resta solo nelle tabelle locali previste per profili/query salvate/cronologia.

## Architettura

```text
Renderer React / CodeMirror
  └─ preload: database.* (DTO tipizzati, nessun modulo Node)
       └─ main Electron: verifica sender + workspace attivo + timeout
            ├─ database-service: driver e introspezione
            ├─ workspace-store: persistenza locale
            └─ driver: better-sqlite3 | pg | mysql2 | tedious
```

Il renderer non apre socket e non interroga SQLite direttamente. Il main process riceve solo l'ID della connessione e il testo SQL, rilegge il profilo filtrandolo per workspace attivo, apre/riusa la sessione e restituisce un DTO serializzabile. Nessun percorso, ID o config di un altro workspace è accettato dal renderer.

## Modello dati locale

`database_connections` contiene `id`, `workspace_path`, `name`, `driver`, host/porta/database/utente/password, `sqlite_path`, opzioni JSON e timestamp. `database_saved_queries` e `database_query_history` riferiscono una connessione appartenente allo stesso workspace. I risultati delle query non sono persistiti.

La cancellazione di una connessione elimina in cascata query salvate e cronologia. I profili e le query non entrano nella cache GitHub/Git e non vengono sincronizzati nel repository.

## Esperienza utente

La nuova tab **Database** sostituisce la pagina vuota con tre aree coordinate:

1. Barra laterale: connessioni del workspace, pulsante nuova connessione, indicatore di stato e explorer schema.
2. Area centrale: tab query con CodeMirror; selettore di dialetto automaticamente collegato al driver e autocomplete da schema.
3. Area inferiore: risultati paginati, messaggi/righe coinvolte, piano/errori leggibili e cronologia.

I comandi includono Esegui, Esegui selezione, Inizia transazione, Commit, Rollback, Salva query e aggiorna schema. Una query mutativa apre il `ConfirmationDialog`; la conferma è necessaria anche quando è in corso una transazione. Query in sola lettura partono direttamente.

## Dialetti e driver

CodeMirror riceve `@codemirror/lang-sql` configurato come `MSSQL`, `PostgreSQL`, `MySQL` o `SQLite`; lo schema introspezionato alimenta il completamento di tabelle e colonne.

| Motore | Driver main process | Introspezione |
| --- | --- | --- |
| SQL Server | `tedious` | `INFORMATION_SCHEMA` e schema `dbo` |
| PostgreSQL | `pg` | `information_schema` e schemi non di sistema |
| MySQL | `mysql2` | `information_schema` del database selezionato |
| SQLite | `better-sqlite3` già presente | `sqlite_master` e `PRAGMA table_info` |

Le sessioni remote sono create per connessione e chiuse su cambio workspace, eliminazione profilo, errore fatale e chiusura app. Ogni query applica timeout e limite risultato; l'esplorazione schema resta cache in memoria e viene invalidata dopo una query mutativa o un refresh esplicito.

## Errori e limiti operativi

- Il risultato ha limite di righe e paginazione per evitare di bloccare il renderer; la UI visualizza righe restituite/coinvolte e durata.
- Errori driver vengono normalizzati in italiano senza includere password o l'intero URL di connessione.
- Se il profilo o la connessione non appartengono al workspace attivo, il main fallisce prima di contattare il database.
- La conferma UI non sostituisce il controllo: il main classifica nuovamente la query come mutativa e rifiuta l'esecuzione senza flag di conferma esplicito.
- Non è prevista importazione/esportazione di backup o condivisione dei profili in questa modifica.

## Verifica

- Test del servizio: CRUD e isolamento workspace, ogni driver configurato, limite SQL, classificazione mutativa, transazioni e invalidazione schema.
- Test preload/main: nessun accesso Node nel renderer, ID filtrato per workspace, esecuzione mutativa rifiutata senza conferma.
- Test UI: tab principale Database, form profilo, dialog di conferma, editor SQL e risultati.
- Controllo manuale dev con SQLite temporaneo per `SELECT`, `CREATE TABLE`, `INSERT`, transazione e rollback; nessun package macOS durante lo sviluppo.
