# Terminale AI: pipeline xterm ad alte prestazioni

## Stato e relazione con le specifiche esistenti

Questa specifica estende
`2026-08-20-terminali-xterm-ux-design.md` e non ne modifica i vincoli:

- una sola sessione Pi per workspace;
- PTY nel processo principale e renderer non privilegiato;
- allegati inseriti come percorsi validati, senza copia o lettura preventiva;
- cambio tab e pulizia della vista non sostituiscono il PTY.

La modifica riguarda esclusivamente il trasporto dell'output, l'invio degli
input voluminosi, il recupero della vista e la loro osservabilità.

## Obiettivo

Rendere il Terminale AI affidabile durante un uso agentico intensivo, inclusi
output molto lunghi, incolla di JSON o documenti, reload del renderer e cambi
tab ripetuti. Il terminale non deve perdere, duplicare o riordinare byte e
l'interfaccia deve restare utilizzabile mentre Pi produce output continuo.

### Criteri misurabili

- 100 MB di output sintetico consegnati byte per byte nello stesso ordine.
- Latenza della tastiera al PTY con p95 inferiore a 50 ms in condizioni normali.
- Coda limitata e memoria che torna stabile dopo il drenaggio.
- Reload e cambio tab senza schermata nera, duplicazioni o riordinamenti.
- Incolla fino a 5 MB cancellabile, con avanzamento e risultato espliciti.
- Nessun contenuto del terminale, comando, path o allegato nella telemetria.

## Problemi rilevati nell'implementazione corrente

Il flusso attuale presenta quattro colli di bottiglia collegati:

1. ogni frammento prodotto da `node-pty` genera un evento IPC separato;
2. lo storico concatena e ritaglia una stringa fino a 1.000.000 di caratteri
   per ogni frammento, causando copie ripetute;
3. il renderer accoda fino a 1.000.000 di caratteri e poi ignora silenziosamente
   l'output eccedente;
4. tutti i frammenti ricevuti nello stesso frame vengono uniti in un'unica
   scrittura xterm, senza una conferma end-to-end al processo principale.

Una prova sintetica della concatenazione corrente ha richiesto circa 0,9 ms
per 1 MB, 181 ms per 9,8 MB, 761 ms per 39,1 MB e 1.925 ms per 97,7 MB. La
crescita deriva dalle copie ripetute, non dalla quantità finale dello storico.

Inoltre, l'input interattivo usa una chiamata con risposta per ogni evento di
tastiera. Questa scelta aggiunge un round-trip non necessario sul percorso più
sensibile alla latenza.

## Alternative valutate

### Solo tuning di xterm

Ridurre lo scrollback, cambiare il renderer o aumentare i limiti non risolve la
perdita silenziosa né crea backpressure tra renderer e PTY. È utile soltanto
come ottimizzazione successiva e misurata.

### Worker e memoria condivisa

Un worker dedicato o un ring buffer in memoria condivisa potrebbe ridurre
alcune copie, ma introduce sincronizzazione, packaging e recovery più
complessi. Non è giustificato finché una pipeline a blocchi controllata soddisfa
i carichi misurati.

### Decisione: pipeline adattiva lossless

Il processo principale aggrega, ordina e conserva i blocchi. Il renderer ne
elabora uno alla volta e conferma soltanto quando xterm ha completato la
scrittura. La pressione della coda sospende e riprende `node-pty`, evitando sia
perdita di dati sia crescita illimitata della memoria.

## Architettura proposta

### TerminalStreamController nel processo principale

Un controller per sessione Pi possiede:

- identificatore immutabile `sessionId`;
- sequenza monotona `sequence` per i blocchi;
- aggregatore dei frammenti `node-pty`;
- coda dei blocchi non confermati;
- storico circolare a blocchi;
- stato di pressione e recovery;
- metriche aggregate prive di contenuto.

L'aggregatore chiude un blocco quando raggiunge 64 KB oppure alla fine del
turno corrente dell'event loop tramite `setImmediate`. Questa coalescenza evita
un ritardo fisso sui ridisegni interattivi di Pi fullscreen. Alla terminazione
di Pi, l'ultimo blocco parziale viene chiuso prima dell'evento di uscita.

Il controller invia un solo blocco non confermato alla volta. Il blocco resta
nella coda finché non arriva una conferma valida per lo stesso `sessionId` e la
stessa `sequence`.

### TerminalHistoryBuffer

Lo storico diventa un buffer circolare composto dagli stessi blocchi della
pipeline, con capacità iniziale di 4 MB. L'espulsione elimina blocchi interi
dalla testa senza concatenare o ritagliare ripetutamente una stringa.

Lo storico è destinato esclusivamente al recupero della vista durante la
sessione. Non viene scritto su disco e non sostituisce la fonte di verità Pi.

### XtermOutputController nel renderer

Il renderer mantiene una sola istanza xterm per la vista Pi del workspace e un
controller con:

- ultimo `sessionId` accettato;
- ultima sequenza confermata;
- blocco attualmente in scrittura;
- stato di rendering e recovery;
- misure locali di latenza e frame lenti.

La conferma viene emessa esclusivamente dal callback di `terminal.write`. Un
evento IPC ricevuto non equivale a un blocco renderizzato. Il controller non
unisce arbitrariamente tutti i blocchi disponibili nello stesso frame e non
possiede un secondo limite che possa scartare output.

### Protocollo IPC

I messaggi logici sono:

```ts
type TerminalOutputBlock = {
  sessionId: string
  sequence: number
  data: string
  snapshot: boolean
}

type TerminalOutputAck = {
  sessionId: string
  sequence: number
}

type TerminalResumeRequest = {
  knownSessionId?: string
  lastAcknowledgedSequence?: number
}
```

Il preload espone metodi stretti e tipizzati. Non espone `ipcRenderer`, il PTY
o letture arbitrarie del filesystem.

## Backpressure e stati

Le soglie iniziali sono esplicite e regolabili soltanto nel processo
principale:

- chiusura blocco: 64 KB o fine del turno corrente dell'event loop;
- sospensione PTY: coda superiore a 4 MB;
- ripresa PTY: coda inferiore a 1 MB;
- rilevamento conferma lenta: 2 secondi;
- storico sessione: 4 MB.

La differenza tra soglia di sospensione e ripresa evita oscillazioni frequenti.
Le soglie non diventano preferenze utente: sono parametri tecnici da modificare
solo attraverso benchmark ripetibili.

Gli stati del controller sono:

- `running`: acquisizione e rendering regolari;
- `paused`: PTY sospeso per pressione della coda;
- `stalled`: conferma assente da almeno 2 secondi;
- `recovering`: renderer o xterm in ricostruzione;
- `ended`: Pi terminato e blocchi residui drenati.

Se una conferma non arriva entro 2 secondi, il controller sospende il PTY e la
UI mostra “Rendering rallentato”. Non elimina il blocco e non riavvia Pi.

## Reload, cambio tab e ordinamento

Il cambio tab rende invisibile la superficie senza distruggere xterm o il PTY.
Al ritorno, il resize viene ricalcolato e il controller continua dalla sequenza
corrente.

Dopo un reload del renderer:

1. il renderer invia `TerminalResumeRequest`;
2. il processo principale risponde con `sessionId`, snapshot dello storico e
   prima sequenza live successiva;
3. il renderer ripristina lo snapshot;
4. i blocchi live restano accodati finché lo snapshot non è confermato;
5. il flusso riprende senza sovrapporre snapshot e output live.

Conferme riferite a una vecchia sessione vengono ignorate. Il cambio workspace
invalida atomicamente coda, timer e conferme della sessione precedente prima di
creare la nuova sessione.

Se xterm genera un errore durante `write`, il blocco resta non confermato. Viene
ricreata soltanto la superficie xterm, quindi lo stesso blocco viene riprodotto;
la sessione Pi non viene terminata.

## Input interattivo e incolla voluminoso

L'input viene separato in due percorsi:

- i tasti interattivi usano un evento IPC fire-and-forget a bassa latenza;
- incolla e inserimenti voluminosi usano un controller con avanzamento,
  cancellazione e risultato finale.

L'incolla accetta inizialmente fino a 5 MB e invia blocchi tra 8 e 16 KB. Il
controller rallenta automaticamente quando la coda di output è sotto pressione,
per impedire che input e output si amplifichino senza controllo.

La cancellazione interrompe soltanto i blocchi non ancora inviati e comunica
quanti byte sono già entrati nel PTY. Un contenuto oltre il limite o non
inviabile produce un dialogo esplicito; nessun input viene scartato
silenziosamente.

Gli allegati continuano a inserire `@<path-assoluto>` validati: trasferire il
contenuto attraverso xterm sarebbe meno efficiente e cambierebbe il contratto
già approvato.

## Rendering xterm

Lo scrollback predefinito resta 10.000 righe e continua a essere configurabile
entro il limite esistente. Ricerca, selezione, copia e auto-scroll devono essere
verificati sotto carico, senza introdurre un secondo modello di buffer.

`@xterm/addon-webgl` viene valutato con benchmark comparativi. Può essere
abilitato solo se riduce in modo misurabile frame lenti o tempo di rendering sul
carico reale. Incompatibilità o perdita del contesto grafico causano fallback
automatico al renderer standard senza ricreare Pi. Un interruttore diagnostico
permette di disabilitarlo.

Non sono previste altre ottimizzazioni del bundle: il bundle corrente è entro
soglia e l'eventuale addon è ammesso solo se il beneficio misurato supera il
costo e il rischio operativo.

## Osservabilità e privacy

Le metriche ammesse sono:

- byte ricevuti e renderizzati;
- dimensione media e massima dei blocchi;
- coda corrente e picco;
- numero e durata delle sospensioni;
- latenza delle conferme xterm p50, p95 e p99;
- frame lenti;
- renderer standard o WebGL;
- esito e byte dell'incolla;
- reload e recovery della vista.

Sono vietati contenuto, comandi, output, path, nomi file e riferimenti agli
allegati. Un pannello compatto nelle Impostazioni mostra lo stato della pipeline
e consente di esportare un report tecnico privo di dati sensibili.

I log seguono transizioni e anomalie, non ogni blocco. Questo evita che la
diagnostica diventi un nuovo collo di bottiglia.

## Gestione degli errori

- **Renderer lento → coda crescente → PTY sospeso:** l'output resta nella coda,
  la UI segnala il rallentamento e la ripresa è automatica sotto 1 MB.
- **Renderer ricaricato → ACK interrotto → handshake di recovery:** snapshot e
  sequenze ripristinano la vista senza riavviare Pi.
- **Errore xterm → blocco non confermato → sola superficie ricreata:** la
  conversazione resta attiva e il blocco viene riscritto una volta.
- **Pi terminato → ultimo frammento parziale → flush prima dello stato finale:**
  l'utente vede tutto l'output che precede l'uscita.
- **Cambio workspace → messaggi tardivi → sessione scartata:** nessun output del
  vecchio progetto entra nella nuova vista.
- **WebGL non disponibile → renderer standard:** nessun blocco e nessun input
  vengono persi.
- **Incolla annullato → coda input interrotta:** la UI indica i byte già inviati
  e non promette un rollback impossibile.

## Strategia di verifica

### Test unitari

- inserimento, espulsione e ordine del buffer circolare;
- sequenze, conferme duplicate, tardive e di sessioni obsolete;
- soglie di sospensione e ripresa senza oscillazioni;
- timeout, recovery e flush finale;
- chunking, avanzamento e cancellazione dell'incolla.

### Test di integrazione

Un PTY controllato simula output rapido, lento, interrotto e molto verboso. I
test verificano ordine byte per byte, codici ANSI, Unicode, uscita e recovery.

Scenari obbligatori:

- flussi da 1 MB, 10 MB e 100 MB;
- JSON e testo Unicode incollati da 200 KB, 1 MB e 5 MB;
- reload durante output continuo;
- cambio tab e tema durante streaming;
- resize ripetuto e ricerca con storico ampio;
- perdita del contesto WebGL;
- sessione prolungata con verifica della memoria dopo il drenaggio;
- cancellazione dell'incolla a metà trasferimento.

### Benchmark e criteri di adozione WebGL

Il benchmark registra durata, picco coda, picco memoria, latenza ACK e frame
lenti con renderer standard e WebGL sulla stessa macchina e sullo stesso input.
WebGL viene adottato solo in presenza di un miglioramento ripetibile senza
regressioni di compatibilità o recovery.

### Esito benchmark renderer — 2026-08-21

Ambiente di prova: Apple Silicon `arm64`, macOS 26.5.2 e Node.js 24.19.0.
La pipeline lossless è stata eseguita tre volte per ogni dimensione; le mediane
sono 34,57 ms per 1 MB, 263,11 ms per 10 MB e 2.322,32 ms per 100 MB. In tutti
i campioni i byte ricevuti e confermati coincidono esattamente e il picco della
coda resta a 65.536 byte.

La prova runtime del renderer standard ha drenato la coda a zero con un picco
di 11,8 kB e ACK xterm p95 di 0,3 ms dopo il carico. Il ritorno alla vista AI
dopo cambio tab, il cambio tema con ripristino e il riavvio controllato della
sessione hanno mantenuto il terminale disponibile senza schermate nere. La
parità byte per byte dei 100 MB e l'isteresi `pause`/`resume` sono verificate dal
test di integrazione indipendente dalla velocità della macchina.

Renderer selezionato: **standard**. Il renderer corrente è già ampiamente sotto
la soglia di 50 ms e non è emerso un collo di bottiglia misurabile che renda
possibile dimostrare il miglioramento minimo del 20% richiesto per WebGL.
L'addon non viene quindi aggiunto: si evita una dipendenza e il relativo rischio
di perdita del contesto grafico senza rinunciare a prestazioni misurate.

## Migrazione incrementale

1. Introdurre buffer circolare e test puri senza cambiare il protocollo.
2. Introdurre messaggi a blocchi, sequenze e conferme dietro un controller
   isolato.
3. Collegare `pause` e `resume` con metriche e stati UI.
4. Separare input interattivo e incolla voluminoso.
5. Aggiungere handshake di reload e prove di recovery.
6. Valutare WebGL con benchmark; abilitarlo solo se supera i criteri.
7. Rimuovere la vecchia concatenazione e il limite renderer che scarta output.

Non devono restare due pipeline PTY attive in produzione. Durante lo sviluppo
il rollback consiste nel disabilitare il nuovo controller prima della rimozione
del vecchio percorso; dopo la migrazione, il rollback avviene per commit e non
tramite logica duplicata permanente.

## Analisi di impatto

- **Breaking change:** nessuna modifica ai comandi Pi o ai riferimenti degli
  allegati; cambia il protocollo IPC interno e deve essere aggiornato
  atomicamente tra main, preload e renderer.
- **Sicurezza:** la superficie preload resta più stretta dell'IPC sottostante;
  metriche e report non contengono dati terminale.
- **Prestazioni:** meno eventi IPC e copie; memoria limitata dalla coda e dallo
  storico; il PTY può essere sospeso senza perdita.
- **Scalabilità:** una pipeline per sessione mantiene isolamento tra workspace
  e consente in futuro più finestre senza condividere sequenze.
- **Operatività:** stati e metriche rendono distinguibile un Pi lento da un
  renderer lento o bloccato.
- **Packaging:** nessuna dipendenza obbligatoria nuova; WebGL è opzionale e
  subordinato a benchmark e verifica del pacchetto macOS.
- **Rollback:** controller isolato, migrazione per fasi e nessun cambio al
  formato dei dati persistenti.

## Fuori ambito

- seconda sessione Pi o Pi Web UI;
- persistenza su disco dell'output;
- multiplexing e split terminali;
- worker o memoria condivisa senza evidenza che la pipeline approvata sia
  insufficiente;
- ottimizzazione generale del bundle non sostenuta da misure.
