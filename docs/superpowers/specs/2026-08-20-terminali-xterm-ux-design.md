# Terminali xterm: UX condivisa per Pi e shell

## Obiettivo

Rendere i terminali integrati di VincodeLab affidabili, coerenti e gradevoli
nell'uso quotidiano senza creare una seconda sessione Pi, duplicare l'output
oppure spostare privilegi nel renderer.

Il Terminale AI continua a usare l'unico PTY Pi del workspace. Il Terminale
libero continua a usare il proprio PTY shell. Le due superfici condividono
comportamenti e controlli xterm; gli allegati sono disponibili soltanto nel
Terminale AI.

## Ambito

### Funzioni condivise

- Toolbar compatta con stato, percorso, ricerca, zoom, copia, incolla,
  pulizia della sola vista e riavvio della sessione.
- Scorciatoie: `Cmd/Ctrl+F`, `Cmd/Ctrl++`, `Cmd/Ctrl+-`, `Cmd/Ctrl+0`,
  `Cmd/Ctrl+C`, `Cmd/Ctrl+V` e `Cmd/Ctrl+K`.
- Ripristino di focus e `FitAddon` dopo cambio tab, hot reload e resize.
- Auto-scroll solo quando l'utente sta seguendo l'ultimo output; controllo
  esplicito per tornare in fondo quando sta leggendo lo storico.
- Stati accessibili e non ambigui: avvio, attivo, terminato, errore.

### Allegati del Terminale AI

- Pulsante per il selettore nativo e drag & drop sulla superficie Pi.
- Sono ammessi file esterni al workspace.
- Il processo principale convalida il path reale: path assoluto, file regolare,
  esistente e leggibile. Cartelle e file non disponibili producono un errore
  puntuale.
- Il renderer mostra gli allegati in attesa come chip rimovibili.
- L'azione esplicita di inserimento scrive i riferimenti `@<path-assoluto>`
  nell'input Pi senza inviare Invio. Non copia file, non carica file e non ne
  legge il contenuto prima che Pi lo elabori.

## Architettura

Il renderer resta non privilegiato. Le API preload restano strette e tipizzate:

1. il picker nativo restituisce soltanto metadata validati dal main process;
2. il drop passa un oggetto `File` al preload, che ottiene il path attraverso
   l'API Electron prevista e non espone una lettura arbitraria del filesystem;
3. il main process normalizza e verifica ogni file prima di restituire
   `{ absolutePath, name }`;
4. il renderer conserva soltanto la coda temporanea e invia i caratteri al PTY
   già attivo tramite l'API terminale esistente.

Un componente di toolbar e piccole utility pure evitano divergenze tra Pi e
shell. Cambio tab, refit e pulizia della vista non sostituiscono i PTY. L'azione
esplicita di riavvio del Terminale libero passa invece dal main process, termina
il PTY corrente e ne crea uno nuovo prima di ripristinare focus e geometria:
rimontare soltanto xterm lascerebbe un canvas vuoto collegato alla vecchia shell.

## Preferenze locali

La dimensione del font e l'auto-scroll sono preferenze leggere per workspace
nel local storage dell'app. Non vengono persistiti output, comandi digitati,
allegati o contenuti Pi/shell: il PTY e Pi restano le fonti di verità.

## Gestione errori

- Un PTY terminato non smonta la pagina: resta lo stato e un'azione univoca di
  riavvio, che sostituisce realmente la sessione nel main process.
- Un failure di refit non blocca l'input; il successivo resize o ritorno alla
  tab ritenta il calcolo.
- Se un file è stato eliminato o non è più leggibile prima dell'inserimento,
  viene rimosso dalla coda e l'utente riceve un messaggio chiaro.
- I file duplicati sono deduplicati per path reale.

## Fuori ambito

- Pi Web UI, server locale e una seconda sessione agentica.
- Multiplexing, split terminali, tab di sessione e cronologia persistente dei
  comandi.
- Copia, upload o indicizzazione preventiva dei file allegati.

## Verifica

- Test unitari delle utility di preferenza, refit, auto-scroll e path degli
  allegati.
- Test di superficie per API preload, toolbar condivisa, scorciatoie e flusso
  allegati esclusivo di Pi.
- Verifica di regressione: cambio tab principale e AI, hot reload, resize,
  sessione terminata e allegati esterni con nomi contenenti spazi.
- Gate finale: `npm test`, `npm run lint`, `npm run build` e `git diff --check`.
