# Terminale e file remoti SSH — Design

## Obiettivo

Estendere la sezione principale **Terminale** con una sotto-tab **File remoti**. L'utente avvia una connessione SSH gestita nel Terminale libero, esplora i file del server mediante la stessa connessione OpenSSH autenticata, scarica una copia privata, la modifica nell'Editor di VincodeLab, confronta le modifiche e la ricarica in modo esplicito e sicuro.

La shell resta un terminale reale e libero. VincodeLab non interpreta l'output di xterm e non tenta di collegarsi a sessioni SSH arbitrarie già avviate: la gestione grafica dei file è disponibile esclusivamente per connessioni SSH gestite e multiplexate dall'app.

## Decisioni confermate

- La sezione **Terminale** contiene due sotto-tab: **Terminale** e **File remoti**.
- I comandi workspace esistenti restano comandi liberi e continuano a funzionare senza migrazioni manuali.
- Un comando può essere dichiarato **Connessione SSH gestita** indicando destinazione/alias SSH e cartella remota iniziale.
- Autenticazione, chiavi, SSH Agent, `ProxyJump`, verifica dell'host e opzioni specifiche restano responsabilità di OpenSSH e `~/.ssh/config`.
- VincodeLab non salva password SSH e non implementa un secondo stack di autenticazione.
- La connessione gestita usa `ControlMaster` e un socket privato per riutilizzare la sessione autenticata nei trasferimenti SFTP.
- Il salvataggio nell'Editor modifica soltanto la copia locale. Nessun upload avviene automaticamente.
- Prima dell'upload vengono controllate modifiche concorrenti sul server e viene mostrato un riepilogo esplicito.
- Il caricamento avviene tramite file temporaneo remoto e rinomina finale, preservando i permessi quando il server lo consente.

## Esperienza utente

### Terminale

Il drawer **Comandi workspace** distingue:

1. **Comando libero**: titolo, categoria, comando e nota come oggi.
2. **Connessione SSH gestita**: titolo, categoria, destinazione SSH e cartella remota iniziale.

La destinazione è un alias di `~/.ssh/config` oppure un token `utente@host`; non accetta flag o frammenti shell. L'app genera e mostra nel PTY un comando equivalente a:

```bash
ssh -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=<socket-privato> <destinazione>
```

Il comando resta visibile e la sessione rimane interattiva. Quando il master risponde a `ssh -O check`, la toolbar indica **SSH connesso** e abilita **Apri File remoti**. Un comando `ssh` scritto manualmente resta valido, ma non abilita la gestione grafica.

### File remoti

La sotto-tab usa lo stesso linguaggio visivo delle altre tab secondarie e contiene:

- selettore della connessione gestita attiva;
- stato `Connessione`, `Connesso`, `Disconnesso` o `Errore`;
- breadcrumb del percorso remoto e pulsanti Indietro, Aggiorna e Nuova cartella;
- Explorer remoto ridimensionabile con cartelle, file, dimensione e data;
- ricerca per nome nella cartella caricata;
- elenco dei file locali `Sincronizzato`, `Modificato`, `Conflitto` oppure `Offline`;
- coda trasferimenti con progresso determinato quando disponibile, annullamento ed esito.

Il doppio clic su un file esegue **Scarica e apri**. L'Editor mostra un badge `Remoto` con connessione, percorso e stato di sincronizzazione. Il salvataggio locale cambia il badge in `Remoto · Modificato`; le azioni **Confronta con server** e **Carica sul server** restano esplicite.

### Menu contestuale

Il menu rimane nativo e in italiano:

- terminale SSH gestito: Copia, Incolla, Cerca, Apri File remoti, Carica file nella cartella remota attiva;
- file remoto: Scarica e apri, Scarica in…, Copia percorso remoto, Rinomina, Elimina…;
- cartella remota: Apri, Aggiorna, Carica file qui…, Nuova cartella…;
- copia locale remota: Apri nell'Editor, Confronta con server, Carica aggiornamento…, Scarta copia locale…, Mostra nel Finder.

Rinomina, eliminazione, sovrascrittura e scarto di modifiche usano `ConfirmationDialog` con destinazione, percorso ed effetto. Le azioni non disponibili sono disabilitate con una motivazione accessibile.

## Architettura

```text
FreeTerminal / RemoteFiles React
  └─ preload tipizzato: managedSsh.* / remoteFiles.*
       └─ Electron main: sender fidato + workspace attivo + validazione DTO
            ├─ managed-ssh-service: socket, check, lifecycle
            ├─ sftp-service: elenco e operazioni file
            ├─ remote-file-store: metadati SQLite e cache privata
            └─ OpenSSH di sistema: ssh / sftp
```

Il renderer non riceve moduli Node, socket o comandi arbitrari. Ogni richiesta contiene ID opachi appartenenti al workspace attivo; il main rilegge destinazione, socket e percorso dal database locale prima di eseguire l'operazione.

### Connessione OpenSSH

`managed-ssh-service` risolve gli eseguibili `ssh` e `sftp` da percorsi di sistema consentiti, crea una directory temporanea privata con permessi `0700` e assegna un socket per workspace e comando gestito. Il percorso usa identificatori brevi sotto `app.getPath('temp')` per rispettare il limite di lunghezza dei socket Unix su macOS; non contiene alias, host o nomi del workspace. L'ID della connessione, non la destinazione grezza, attraversa IPC.

Il comando destinato al PTY viene costruito da argomenti validati e quotati per la shell interattiva. Le operazioni di controllo e SFTP usano `spawn` con array di argomenti, senza `shell: true` e senza concatenazione. Timeout, dimensione dell'output e numero di processi simultanei sono limitati. Il processo SFTP appartiene alla coda della singola connessione per evitare operazioni concorrenti incompatibili.

La connessione passa a `Connesso` soltanto dopo un `ssh -O check` riuscito. Alla chiusura del workspace o dell'app, VincodeLab chiude i processi di trasferimento e richiede al master gestito di terminare; i socket residui vengono rimossi. `ControlPersist` permette brevi cambi di tab senza interrompere i trasferimenti.

### Adapter SFTP

Il servizio usa `sftp` in modalità batch, con comandi scritti su `stdin`, ambiente `LC_ALL=C` e un'unica funzione di quoting che rifiuta caratteri di controllo e protegge backslash e virgolette. Stato di uscita e `stderr` determinano il successo: il renderer non deduce l'esito dal testo visualizzato.

L'elenco remoto viene normalizzato dal formato OpenSSH in DTO tipizzati. Il parser è coperto da fixture con spazi, Unicode, link e output ostile; nomi contenenti newline non sono supportati. Se gli attributi di una voce non sono interpretabili, la UI la mostra come elemento sconosciuto e disabilita le operazioni distruttive invece di indovinarne tipo o permessi.

### Compatibilità dei comandi workspace

La tabella `workspace_commands` riceve campi incrementali con valori predefiniti, almeno `kind`, `ssh_destination` e `remote_root`. `kind='shell'` è il default per tutte le righe esistenti. Per `kind='ssh'`, destinazione e root vengono validate separatamente; il campo storico `command` resta presente per compatibilità ma non viene interpretato come configurazione SSH.

Non vengono riconosciuti automaticamente `ssh`, alias o password dentro un comando libero. Questo evita parsing shell ambiguo, injection e associazioni errate tra terminale e server.

## Cache e modello di sincronizzazione

Le copie remote sono salvate sotto la directory privata `userData`, mai nel repository e mai in una cartella scelta implicitamente dal server:

```text
remote-files/<hash-workspace>/<connection-id>/<remote-file-id>/working-copy
```

Directory e file usano rispettivamente permessi `0700` e `0600` su sistemi POSIX. SQLite conserva soltanto metadati e associazioni:

- workspace e connessione gestita;
- percorso remoto canonico;
- ID e percorso interno della copia locale;
- dimensione, modifica e permessi osservati;
- hash SHA-256 del contenuto scaricato;
- stato e ultimo errore di sincronizzazione.

Il renderer usa ID opachi. Un percorso remoto deve essere assoluto o relativo alla root configurata, non può contenere NUL, newline o superare i limiti definiti. La normalizzazione impedisce di uscire dalla root quando il profilo è configurato come limitato; i link simbolici vengono mostrati come tali e non seguiti implicitamente per operazioni distruttive.

## Download, modifica e upload

### Download

1. Il main verifica workspace, connessione e percorso.
2. SFTP scarica in un file temporaneo locale.
3. Dimensione e hash vengono calcolati prima della promozione a `working-copy`.
4. Il manifesto viene aggiornato in una transazione SQLite.
5. L'Editor apre la risorsa mediante un nuovo handle remoto, non mediante un percorso arbitrario fornito dal renderer.

Un trasferimento annullato o fallito elimina il temporaneo e conserva l'ultima copia valida.

### Salvataggio nell'Editor

L'Editor tratta la risorsa come una sorgente distinta dai file workspace. Il salvataggio aggiorna atomicamente la copia privata e lo stato locale, ma non contatta il server. Preview immagini, PDF, CSV e Markdown riusano le capacità già presenti; il diff è disponibile solo per contenuti testuali entro un limite configurato.

### Controllo conflitti e upload

Prima di caricare, VincodeLab scarica la versione remota corrente in un temporaneo e ne confronta l'hash con quello registrato al download. Questo evita di affidarsi soltanto a data e dimensione e funziona anche quando il server non espone hash nativi.

- hash invariato: l'upload può procedere dopo il riepilogo;
- hash differente: stato `Conflitto`, upload bloccato, azioni Confronta/Riscarica/Forza sostituzione;
- file remoto assente: l'utente sceglie se ricrearlo;
- connessione assente: stato `Offline`, copia locale conservata.

L'upload invia un file temporaneo nella stessa directory remota, applica i permessi originali quando disponibili e usa la rinomina SFTP come commit finale. Se il server non supporta la rinomina atomica, la UI lo dichiara prima di consentire la sostituzione. Temporanei remoti falliti vengono rimossi per quanto possibile e registrati nel log senza contenuto né credenziali.

## Limiti e gestione errori

- Nessuna password, chiave privata, contenuto file o comando completo viene scritto nei log.
- Errori OpenSSH/SFTP vengono normalizzati senza nascondere host, percorso e fase utile alla diagnosi.
- Elenchi, file e output hanno limiti configurati; file grandi richiedono conferma e usano streaming, mai buffer completi nel renderer.
- La coda limita i trasferimenti simultanei per connessione e propaga annullamento e chiusura workspace.
- Il cambio tab non distrugge PTY, master SSH, coda o copie locali.
- Il riavvio del Terminale chiude esplicitamente la connessione gestita associata prima di creare un nuovo PTY.
- Se `ssh` o `sftp` non sono disponibili, il Terminale libero resta utilizzabile e la sotto-tab mostra una spiegazione con diagnostica.
- Operazioni incompatibili sullo stesso file vengono serializzate; una seconda azione riceve feedback invece di partire in parallelo.

## Stato, osservabilità e pulizia

Gli eventi applicativi includono solo ID, fase, durata, byte e risultato: connessione avviata/chiusa, elenco completato, download/upload completato, conflitto, annullamento ed errore normalizzato. Non includono credenziali o contenuto.

La cache sopravvive a riavvio e disconnessione per non perdere modifiche. Una schermata di gestione mostra spazio occupato e consente di eliminare copie sincronizzate o tutte le copie di una connessione. Copie modificate e conflitti richiedono conferma esplicita. Una politica di pulizia automatica può rimuovere soltanto temporanei incompleti e copie sincronizzate non usate oltre il limite configurato.

## Verifica

### Test automatici

- migrazione SQLite e compatibilità dei comandi `shell` esistenti;
- validazione destinazione, root e percorsi con spazi, Unicode, quote, newline e traversal;
- costruzione del comando PTY e degli argomenti `spawn` senza interpolazione shell;
- lifecycle `ControlMaster`, check, reconnect, cambio workspace e chiusura app;
- coda e timeout di elenco, download, upload, annullamento e cleanup;
- hash invariato, conflitto, file remoto eliminato e forza sostituzione;
- sostituzione tramite temporaneo, rinomina e ripristino permessi;
- isolamento della cache e degli ID tra workspace;
- integrazione Editor per testo, Markdown, CSV, immagini, PDF e binari non supportati;
- menu contestuale italiano, loading, empty state, errori, tastiera e temi chiaro/scuro;
- regressioni su Terminale libero, restart della shell e comandi workspace.

I test del main usano eseguibili fixture `ssh`/`sftp` controllati, così successi, timeout, conflitti e output ostili sono deterministici e non richiedono un server reale.

### Collaudo manuale

Il collaudo usa un host SSH non produttivo configurato in `~/.ssh/config`:

1. connessione gestita e verifica del riuso senza seconda autenticazione;
2. navigazione, ricerca e refresh;
3. download, modifica nell'Editor, diff e upload;
4. modifica concorrente remota e blocco per conflitto;
5. disconnessione, riavvio app e recupero della copia modificata;
6. file con spazi/Unicode, file vuoto, binario e file grande;
7. verifica permessi e assenza di temporanei residui;
8. cambio ripetuto tra Terminale, File remoti ed Editor senza perdita di stato.

## Rollback e rilascio

La modifica è additiva: i comandi esistenti restano `shell` e la nuova sotto-tab può essere disabilitata senza alterare il PTY. In caso di rollback del codice, le nuove colonne SQLite vengono ignorate; copie e metadati remoti restano nella directory privata finché l'utente non li elimina.

Prima del rilascio sono obbligatori test, lint, build, verifica del diff e collaudo runtime. Il package macOS viene creato soltanto dopo il completamento del collaudo su host non produttivo; nessuna release viene prodotta durante l'implementazione incrementale.
