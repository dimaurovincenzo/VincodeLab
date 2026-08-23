# Multi-istanza workspace e testata centrata

**Data:** 21 agosto 2026
**Stato:** approvato
**Ambito:** processo Electron, selezione workspace, testata macOS, incolla nel Terminale AI

## Obiettivo

Consentire di lavorare contemporaneamente su due workspace senza convertire VincodeLab in un'applicazione multi-workspace interna. Ogni finestra deve restare un processo Electron indipendente con un solo workspace attivo.

La stessa modifica deve spostare logo, nome dell'applicazione e progetto nell'area centrale della testata, proteggere le modifiche non salvate durante il cambio workspace e rendere esplicito il rifiuto di contenuti troppo grandi incollati nel Terminale AI.

## Decisioni approvate

- massimo due istanze VincodeLab contemporanee;
- un solo workspace per istanza;
- lo stesso workspace non può essere aperto in due istanze;
- nessuna conversione dello stato globale esistente in uno store multi-workspace;
- il blocco centrale della testata apre il selettore progetto;
- `Apri qui` protegge i file non salvati con un dialogo a tre azioni;
- nessun input del terminale può essere scartato senza feedback;
- nessuna release viene pubblicata durante lo sviluppo della modifica.

## Architettura

### Isolamento per processo

Ogni processo conserva l'attuale modello singleton:

- un `BrowserWindow`;
- un `activeWorkspacePath`;
- una sessione Pi;
- una sessione shell libera;
- le proprie connessioni SSH e database.

Le sessioni operative non vengono condivise. Il secondo processo può condividere soltanto le risorse locali già globali, come preferenze e workspace recenti.

Questa scelta limita il rischio: i servizi che oggi dipendono dal workspace attivo continuano a ricevere un solo percorso e non richiedono una chiave workspace aggiuntiva.

### Registro delle istanze

Un servizio isolato nel processo principale mantiene un registro locale con:

- identificatore univoco dell'istanza;
- PID;
- percorso workspace normalizzato, se presente;
- istante di avvio;
- ultimo heartbeat.

Il registro usa lo storage SQLite locale già disponibile, con transazioni brevi, WAL e `busy_timeout`. Prima di registrare una nuova istanza elimina le righe non più vive verificando heartbeat e processo.

La registrazione deve essere atomica: due avvii simultanei non possono superare entrambi il limite. Il processo aggiorna il workspace registrato dopo ogni apertura e rimuove la propria voce durante la chiusura ordinata.

### Regole di ammissione

1. Nessuna istanza registrata: l'avvio prosegue.
2. Una sola istanza: può essere avviata la seconda.
3. Due istanze vive: la terza mostra un messaggio nativo e termina.
4. Workspace già presente nel registro: l'apertura viene bloccata con un messaggio chiaro.
5. Voce obsoleta dopo un arresto anomalo: viene rimossa prima della valutazione.

### Avvio della seconda istanza

Il processo principale espone un'operazione dedicata, non una shell generica. Il percorso viene validato e passato come argomento separato.

- App installata: eseguibile corrente più `--workspace` e percorso assoluto.
- Sviluppo: eseguibile Electron, percorso dell'app e gli stessi argomenti.

Il processo figlio è indipendente, con standard input/output scollegati. Il renderer non può scegliere un eseguibile arbitrario.

## Esperienza utente

### Testata macOS

Logo, `VincodeLab` e nome del progetto formano un unico controllo centrale. Il controllo viene centrato nello spazio realmente disponibile tra i semafori macOS e la navigazione, evitando un posizionamento assoluto rispetto all'intera finestra.

Regole responsive:

- il nome progetto usa ellissi quando necessario;
- il percorso completo è disponibile come tooltip;
- a larghezze ridotte la scritta `VincodeLab` può essere nascosta;
- icona e nome progetto restano visibili finché lo spazio lo consente;
- la navigazione principale non deve sovrapporsi al selettore.

### Selettore progetto

Il controllo centrale apre un pannello compatto contenente:

- progetto corrente;
- workspace recenti;
- `Apri qui`;
- `Apri in nuova finestra`;
- `Scegli cartella`.

Quando sono già attive due istanze, `Apri in nuova finestra` è disabilitato e spiega `Limite di due finestre raggiunto`.

Quando il workspace è già aperto, l'azione viene bloccata e spiega `Progetto già aperto in un'altra finestra`.

### Cambio nella finestra corrente

`Apri qui` interroga lo stato dell'Editor prima di chiudere le sessioni del workspace. Se esistono modifiche non salvate presenta:

- `Salva e cambia`;
- `Scarta e cambia`;
- `Annulla`.

Il salvataggio deve completarsi per tutti i file prima di procedere. Un errore conserva il workspace corrente e le sessioni attive. Solo dopo la conferma vengono chiusi Pi, terminale libero, SSH e database e viene aperto il nuovo workspace.

`Apri in nuova finestra` non modifica né interrompe lo stato della prima istanza.

## Contratti IPC

Il preload espone API ristrette e tipizzate:

- stato delle istanze e capacità residua;
- apertura di un workspace in una nuova istanza;
- verifica della disponibilità di un percorso;
- aggiornamenti del registro necessari alla UI.

Ogni handler:

- verifica il mittente;
- normalizza il percorso;
- verifica che esista e sia una cartella;
- impedisce duplicati e superamento del limite;
- restituisce errori strutturati e traducibili.

Gli errori restano confinati al selettore o a una notifica e non sostituiscono l'intera area di lavoro.

## Terminale AI: incolla di grandi dimensioni

### Causa confermata

Il renderer legge il testo dagli appunti e lo invia al processo principale. L'handler corrente accetta soltanto stringhe fino a 65.536 caratteri; oltre tale soglia l'input viene ignorato senza risposta.

### Comportamento richiesto

- nessun contenuto viene scartato silenziosamente;
- il renderer misura l'input prima dell'invio;
- l'API restituisce un esito, anziché usare un evento senza risposta;
- quando sicuro, il contenuto viene scritto nel PTY in blocchi ordinati con backpressure controllata;
- se il limite complessivo viene superato, non viene inviato alcun frammento;
- l'utente vede dimensione rilevata, limite applicato e azione alternativa;
- focus, output esistente e sessione Pi vengono conservati.

Il limite complessivo deve proteggere memoria e reattività, non essere usato come scarto implicito. I blocchi non devono alterare il testo né aggiungere ritorni a capo.

## Impatto e rischi

### Correttezza

- Un registro non atomico permetterebbe tre processi: la verifica e l'inserimento devono avvenire nella stessa transazione.
- Un percorso confrontato in forma diversa permetterebbe duplicati: i percorsi devono essere risolti e normalizzati prima del confronto.
- Cambiare workspace prima del salvataggio causerebbe perdita di dati: il cambio resta subordinato all'esito dell'Editor.

### Sicurezza

- Nessun comando di avvio passa attraverso una shell.
- Il renderer non controlla eseguibile o argomenti liberi.
- I percorsi vengono validati nuovamente nel processo principale.
- L'incolla mantiene un limite complessivo per evitare blocchi o consumo incontrollato di memoria.

### Manutenibilità

Il registro è un servizio separato dal workspace store e dai terminali. Non introduce uno store multi-workspace né modifica le firme dei servizi già legati al workspace attivo.

### Prestazioni e operatività

Due processi duplicano renderer e runtime, ma il limite fisso rende il consumo prevedibile. Heartbeat e registrazione usano scritture minime. Il bundle resta solo monitorato: questa modifica non autorizza ottimizzazioni speculative.

### Rollback

Il registro e il selettore possono essere disattivati senza migrare progetti o preferenze. L'apertura singola continua a usare il flusso esistente.

## Strategia di verifica

### Test automatici

- registrazione della prima e della seconda istanza;
- rifiuto atomico della terza;
- eliminazione di processi obsoleti;
- rifiuto dello stesso workspace con percorsi equivalenti;
- validazione degli argomenti di avvio in sviluppo e nell'app installata;
- protezione delle modifiche non salvate per tutte le tre azioni del dialogo;
- mancato cambio workspace quando un salvataggio fallisce;
- rendering responsive della testata e stati disabilitati del selettore;
- incolla sotto, esattamente al limite e oltre 65.536 caratteri;
- nessun invio parziale in caso di rifiuto;
- ricomposizione byte-per-byte dell'input trasmesso a blocchi.

### Verifica manuale

1. Avviare due istanze con workspace differenti.
2. Verificare Pi, shell, SSH e database indipendenti.
3. Tentare terza istanza e workspace duplicato.
4. Terminare forzatamente un processo e verificare il recupero del posto disponibile.
5. Ridimensionare la finestra e controllare testata e navigazione.
6. Provare `Apri qui` con file puliti, modificati e con errore di salvataggio.
7. Incollare JSON di piccole e grandi dimensioni nel Terminale AI.
8. Ripetere i flussi sull'app macOS installata.

## Criteri di completamento

- massimo due istanze applicato anche con avvii simultanei;
- nessun workspace duplicato;
- nessuna perdita di modifiche non salvate;
- sessioni operative isolate;
- testata leggibile e priva di collisioni;
- nessun input terminale ignorato senza feedback;
- suite completa senza regressioni;
- pacchetto macOS verificato localmente;
- nessuna release pubblicata prima del completamento complessivo.
