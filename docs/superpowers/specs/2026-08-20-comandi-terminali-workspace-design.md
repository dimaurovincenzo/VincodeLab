# Libreria comandi del Terminale libero — Design

## Obiettivo

Consentire di salvare ed eseguire comandi ricorrenti esclusivamente nel workspace aperto: accessi SSH, build, test, script di manutenzione e operazioni locali. La libreria deve accelerare il lavoro senza modificare il contratto del Terminale libero: la shell resta un PTY esplicito e persistente nel workspace.

## Ambito

- Inclusi: categorie create dall’utente, comandi liberi, ricerca, CRUD, riordino e spostamento tra categorie; conferma prima dell’esecuzione; persistenza SQLite locale per workspace.
- Esclusi: libreria globale, sincronizzazione cloud/Git, esecuzione schedulata o automatica, storico dei comandi eseguiti e logging del contenuto dei comandi.

## UX

Il Terminale libero ottiene un pulsante `Comandi` nella toolbar. Il pulsante apre una sidebar a comparsa sul lato destro, sovrapposta alla superficie del terminale: non modifica le dimensioni della shell, non rimonta xterm e non altera la sessione PTY.

La sidebar contiene ricerca, azione per creare una categoria, azione per creare un comando e sezioni categoria comprimibili. Ogni comando visualizza titolo, anteprima monospazio e nota opzionale. Le azioni sono modifica, duplica, sposta ed elimina.

`Esegui` apre una conferma accessibile con titolo del comando e testo completo. Dopo la conferma, l’app invia il testo al PTY esistente seguito da invio. Se la shell non è pronta, l’azione resta disabilitata e l’utente non perde il comando.

## Modello dati

Le tabelle risiedono nel database locale `vincodelab.sqlite`:

- `workspace_command_categories`: `id`, `workspace_path`, `name`, `sort_order`, `created_at`, `updated_at`.
- `workspace_commands`: `id`, `workspace_path`, `category_id`, `title`, `command`, `note`, `sort_order`, `created_at`, `updated_at`.

`workspace_path` è il percorso assoluto del workspace e isola rigorosamente dati e query. Le foreign key sono attive; l’eliminazione di una categoria richiede conferma e rimuove i suoi comandi. Titolo e categoria sono obbligatori; il testo del comando è libero, incluso materiale riservato, secondo la scelta esplicita dell’utente.

## Sicurezza e confini

I comandi sono salvati in chiaro nel database locale dell’app. Non vengono filtrati, mascherati, trasmessi, sincronizzati o scritti nei log applicativi. Il renderer non accede a SQLite né scrive direttamente nel PTY.

Il main process espone IPC strettamente tipizzate, conserva `assertTrustedSender` e verifica il workspace attivo. L’operazione di esecuzione verifica che la shell appartenga al workspace corrente; la conferma UI è obbligatoria, quindi non esistono auto-run all’apertura della sidebar, all’avvio dell’app o al cambio workspace.

## Flusso

1. Il renderer apre la sidebar e carica categorie/comandi del workspace attivo.
2. L’utente crea o aggiorna una categoria o un comando; il main process persiste solo per quel `workspace_path`.
3. L’utente seleziona `Esegui`; il renderer mostra il dialog con il comando completo.
4. Dopo conferma, il main process invia il testo al PTY della shell attiva e il terminale mostra il normale output.
5. Il cambio workspace chiude la shell esistente e la sidebar ricarica solamente i comandi del nuovo workspace.

## Verifica

- Unit test SQLite: isolamento workspace, CRUD, ordine, spostamento, eliminazione categoria e contenuto libero del comando.
- IPC test: nessun accesso del renderer a SQLite, sender e workspace validati.
- Test terminale: esecuzione rifiutata senza shell o con workspace diverso; nessun comando viene inviato prima della conferma.
- Test UI: sidebar apribile/chiudibile, ricerca, gestione tastiera, nessun overflow orizzontale e PTY preservato durante l’apertura.
- Verifica finale: `npm test && npm run lint && npm run build && git diff --check` e collaudo dev manuale con comando innocuo.
