# Politica di sicurezza

La sicurezza di VincodeLab riguarda soprattutto il confine tra contenuti del workspace e capacità native: filesystem, terminali, processi, Git, database e connessioni remote.

## Versioni supportate

VincodeLab è in sviluppo attivo e non pubblica ancora binari firmati o release stabili.

| Versione | Supporto di sicurezza |
| --- | --- |
| Ultimo commit di `main` | Supportato |
| Tag e revisioni precedenti | Non garantito |

Prima di segnalare un problema, verifica quando possibile che sia ancora presente sull'ultima revisione senza usare dati o sistemi di produzione.

## Segnalare una vulnerabilità

Non aprire una issue, discussione o pull request pubblica per una vulnerabilità non corretta.

Invia invece una [segnalazione privata tramite GitHub Security Advisories](https://github.com/dimaurovincenzo/VincodeLab/security/advisories/new). Se GitHub non rende disponibile il modulo, contatta il maintainer dal [profilo GitHub](https://github.com/dimaurovincenzo) chiedendo soltanto un canale privato, senza includere dettagli sfruttabili nel messaggio iniziale.

Includi, se disponibili:

- componente e versione o commit interessato;
- condizioni necessarie e passi minimi per riprodurre il problema;
- impatto osservato e impatto potenziale;
- proof of concept ridotta e non distruttiva;
- mitigazioni già individuate;
- un recapito per il coordinamento.

Sanitizza sempre log, screenshot e fixture. Non inviare password, token, chiavi, connection string, percorsi personali completi o contenuti privati del workspace.

## Cosa aspettarsi

Il maintainer valuterà la segnalazione, confermerà l'ambito e coordinerà correzione e divulgazione con la persona che ha segnalato il problema. I tempi dipendono da gravità, riproducibilità e complessità; non viene promesso un SLA finché il progetto non dispone di un processo di release stabile.

Non divulgare pubblicamente i dettagli prima che sia disponibile una correzione o sia stata concordata una data di pubblicazione.

## Ambito prioritario

Sono particolarmente rilevanti:

- bypass di `contextIsolation`, sandbox, Content Security Policy o controlli di navigazione;
- chiamate IPC accettate da un mittente non autorizzato o con argomenti non validati;
- lettura o scrittura fuori dal workspace o dalle directory applicative consentite;
- command injection in shell, Pi, Git, GitHub CLI, SSH/SFTP o processi database;
- esposizione di credenziali database, token, chiavi SSH, log o diagnostica non sanitizzata;
- sovrascrittura o perdita di dati senza conferma nei flussi locali o remoti;
- aggiramento della verifica host SSH o dei confini della cache SFTP;
- esecuzione di contenuti non fidati nelle anteprime o nel renderer;
- dipendenze compromesse con un percorso realistico di sfruttamento nell'app.

In genere non sono vulnerabilità, salvo impatto aggiuntivo dimostrabile:

- la possibilità per l'utente locale di eseguire volontariamente comandi con i propri permessi;
- problemi che richiedono già accesso completo all'account macOS dell'utente;
- indisponibilità di servizi esterni o configurazioni locali non supportate;
- segnalazioni automatiche di dipendenze senza analisi di raggiungibilità;
- limiti di usabilità, crash o prestazioni senza conseguenze sulla sicurezza.

## Ricerca responsabile

Esegui test soltanto su dati, account, host e repository di tua proprietà o per i quali hai autorizzazione esplicita. Evita persistenza, esfiltrazione, social engineering, interruzione di servizi e accesso a dati di terzi. Interrompi il test appena dimostrato l'impatto minimo necessario.

La ricerca in buona fede che rispetta questa politica è benvenuta; questa pagina non concede autorizzazioni su sistemi di terzi né sostituisce le leggi applicabili.

## Dipendenze e segreti

- Non inserire segreti nel repository, nei test o negli screenshot.
- Le password database devono attraversare soltanto i percorsi protetti e vengono archiviate tramite Electron `safeStorage` quando disponibile.
- Il logger applicativo accetta campi limitati e sanitizza valori sensibili; non fare affidamento sul logging come deposito di dati applicativi.
- Firma, notarizzazione e credenziali di distribuzione non appartengono al repository. Il packaging corrente è intenzionalmente non firmato e non va presentato come una release pubblica attendibile.
