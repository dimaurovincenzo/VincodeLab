# VincodeLab — matrice QA Material 3

Stato: **in corso** · Obiettivo: beta pronta per rilascio, senza difetti Critical o High noti.

Ultima evidenza tecnica: `npm test` (185 test), `npm run lint`, `npm run build`
e `git diff --check` superati sul ramo `main`. Le righe della matrice restano
aperte finché non viene registrata anche la corrispondente prova manuale.

| Area | Flusso da verificare | Stati e casi limite | Viewport e tema | Evidenza | Stato |
| --- | --- | --- | --- | --- | --- |
| Home e navigazione | apertura workspace, cambio tab, ritorno al contesto | nessun workspace, errore recuperabile, refresh | stretto/largo, chiaro/scuro, motion ridotto | da eseguire | aperto |
| Editor | explorer, ricerca, salvataggio, preview e file non testuali | `.env`, file molto grandi, errore lettura, Git M/A/D | pane ridimensionato, chiaro/scuro | manuale: `.env`, badge cartella M, filtro e Markdown; da completare | aperto |
| Terminale | terminale libero, comandi workspace, copia/incolla | PTY inattivo, output lungo, resize, errore comando | stretto/largo, font 11px | manuale: shell pronta, toolbar e pannello comandi; da completare | aperto |
| Terminale AI | Pi, allegato interno/esterno, cambio tab | sessione assente, file mancante, drag & drop invalido | chiaro/scuro, motion ridotto | manuale: Pi pronto dopo ritorno da GitHub, toolbar e font 11px; da completare | aperto |
| Git e GitHub | stato, commit/push, grafo, issue, Project | repository assente, API fallita, dati vuoti, nomi lunghi | tabella stretta/larga, modal | manuale: stato locale, azioni remote, Issue e dettaglio modale; da completare | aperto |
| Database | connessione, query, griglia, modifica e transazione | query invalida, timeout, zero righe, PK assente, rollback | SQL/griglia ridimensionati, chiaro/scuro | manuale: schema, tabella, query e griglia in sola lettura; automatico: errore sicuro, conferma e rollback; da completare | aperto |
| Impostazioni Pi | runtime, skill, estensioni e aggiornamenti | Pi non installato, operazione fallita, lista lunga | tab, scroll, chiaro/scuro | manuale: tab e catalogo skill Pi; da completare | aperto |

## Regole di registrazione

Ogni difetto scoperto viene riportato in questo formato, con un retest dopo la
correzione: **Problema → Riproduzione → Attuale → Atteso → Gravità → Correzione → Retest**.

- **Critical:** blocca un flusso fondamentale, perde/corrompe dati o espone dati.
- **High:** rende errata o inutilizzabile una funzione importante.
- **Medium:** problema evidente con workaround.
- **Low:** imperfezione di rifinitura o grafica senza impatto sul flusso.

Le mutazioni GitHub e database in ambienti produttivi non sono prove QA
automatiche: richiedono una conferma esplicita e una verifica successiva.

## Evidenza runtime — 20 agosto 2026

- **Editor:** explorer con `.env` visibile, filtro, separatore ridimensionabile
  e preview Markdown verificati sul workspace aperto; il file sensibile non è
  stato aperto durante il test.
- **Terminale e Terminale AI:** entrambi pronti con font 11 px, ricerca,
  copia/incolla, toolbar e input; i passaggi Terminale → AI e GitHub → AI
  mantengono Pi pronto senza schermata nera. Pi è rimasto pronto anche dopo
  l'hot reload del tema xterm.
- **GitHub:** stato locale, grafo, Issue, dettaglio modale chiudibile con
  `Esc`, Projects del solo remote del workspace e board raggruppata per stato
  verificati in sola lettura. Nessuna Issue, commit, push o aggiornamento
  remoto è stato eseguito.
- **Database:** schema e griglia SQL Server con 37 righe verificati; un filtro
  senza risultati mostra 0 righe con intestazioni e controlli coerenti. Il
  filtro è stato ripristinato; non è stata avviata alcuna transazione né
  eseguita alcuna mutazione. Il retest diretto del servizio SQL Server sulla
  tabella `dbo.Allert_Web` conferma anche la paginazione: 37 righe iniziali e
  0 per filtro impossibile, senza errore `FETCH`; nessun dato è stato scritto.
- **Impostazioni Pi:** runtime rilevato, skill globali Pi e pacchetti separati
  sono visibili e scrollabili; non sono state avviate installazioni,
  aggiornamenti o rimozioni.
- **Ripristino renderer:** il workspace recente `TycheSocApi` è stato riaperto
  nell'Electron di sviluppo e la shell ha ripristinato correttamente contesto,
  tab principali e pannello Impostazioni dopo il caricamento. Il controller
  desktop non invia in modo affidabile `ArrowRight` alle tab HTML (accetta solo
  il codice nativo `Right`), quindi la prova manuale completa della navigazione
  a frecce resta aperta e non viene classificata come difetto dell'app.
- **Tema:** il tema scuro è stato controllato visivamente. Il test del tema
  chiaro e dei viewport stretti resta aperto: il controller desktop non espone
  l'azione del selettore aspetto in modo affidabile.

## Difetti corretti

### M3-QA-001 — stati della griglia Database non semanticamente mappati

**Problema →** lo stato di modifica usava variabili legacy non definite nella
fondazione M3. **Riproduzione →** avviare una transazione e modificare una
cella nella griglia. **Attuale →** il colore poteva essere incoerente tra i
temi. **Atteso →** stato warning/modified e stato editabile leggibili con gli
stessi ruoli semantici nei due temi. **Gravità →** Medium. **Correzione →**
`--state-warning`, `--state-warning-soft` e `--state-success` applicati alla
griglia. **Retest →** test UI, lint e build superati.

### M3-QA-002 — separatore Database non accessibile da tastiera

**Problema →** il separatore SQL/griglia riceveva focus ma non gestiva tasti.
**Riproduzione →** raggiungerlo con Tab e usare frecce o Page Up/Down.
**Attuale →** nessun ridimensionamento. **Atteso →** variazione prevedibile
senza mouse. **Gravità →** Medium. **Correzione →** frecce di 16 px e pagine di
64 px, con istruzione accessibile. **Retest →** test UI, lint e build superati.

### M3-QA-003 — barra delle sezioni può eccedere lo spazio disponibile

**Problema →** le tab principali potevano forzare l’overflow della finestra in
un viewport stretto. **Riproduzione →** ridurre la finestra sotto 900 px con
un workspace aperto. **Attuale →** controlli compressi o fuori dalla viewport.
**Atteso →** tutte le sezioni restano raggiungibili senza scroll orizzontale
della finestra. **Gravità →** Medium. **Correzione →** toolbar adattiva e
scorrimento limitato al solo tablist. **Retest →** test UI, lint e build
superati.

### M3-QA-004 — caricamento griglia Database causa render a cascata

**Problema →** l'effetto di caricamento impostava lo stato sincrono prima di
avviare il task differito. **Riproduzione →** aprire una tabella Database o
modificarne il filtro. **Attuale →** il lint React segnalava un aggiornamento
di stato nell'effetto, con rischio di render ridondante. **Atteso →** lo stato
di caricamento parte insieme alla richiesta differita. **Gravità →** Low.
**Correzione →** `setTableLoading(true)` è eseguito nel timer che avvia la
lettura della tabella. **Retest →** test UI, suite completa, lint, build e
controllo whitespace superati.

### M3-QA-005 — tema scuro con palette duplicata

**Problema →** il foglio del tema scuro ridefiniva colori specifici per ogni
componente. **Riproduzione →** confrontare Editor, Terminale e GitHub in tema
scuro dopo l'evoluzione dei token centrali. **Attuale →** i ruoli potevano
divergere tra sezioni e richiedevano override fragili. **Atteso →** il tema
cambia solo i valori dei ruoli M3. **Gravità →** Medium. **Correzione →**
il foglio scuro associa le superfici legacy a token semantici e non contiene
colori letterali. **Retest →** test dedicato, lint, build e controllo
whitespace superati.

### M3-QA-006 — gerarchia tipografica non tokenizzata

**Problema →** il sistema definiva le famiglie di font ma non una scala comune
per titoli, sezioni, testo operativo e metadati. **Riproduzione →** confrontare
le intestazioni delle superfici Home, GitHub e Impostazioni. **Attuale →** le
dimensioni potevano divergere senza un contratto centrale. **Atteso →** ogni
ruolo tipografico desktop è disponibile come token riusabile. **Gravità →**
Medium. **Correzione →** introdotti token `--type-*`, pesi e line-height,
applicati alle intestazioni e metadati principali. **Retest →** test dedicato,
lint, build e controllo whitespace superati.

### M3-QA-007 — il click su una Issue non mostrava il suo contenuto

**Problema →** la riga Issue espandeva soltanto azioni operative, senza rendere
consultabile titolo, descrizione e metadati. **Riproduzione →** aprire GitHub,
selezionare la tab Issue e attivare una riga. **Attuale →** nessun dettaglio
della Issue era visualizzato. **Atteso →** un dettaglio modale leggibile,
chiudibile e senza mutazioni implicite. **Gravità →** Medium. **Correzione →**
la riga apre un dialog con stato, autore, etichette e descrizione; focus,
chiusura con `Esc` e ripristino del focus sono gestiti esplicitamente.
**Retest →** test dedicato, suite completa (169), lint, build e prova manuale
in Electron con apertura e chiusura tramite `Esc` superati.

### M3-QA-008 — shell con superfici locali fuori dal contratto M3

**Problema →** Home, toolbar, toast e recupero del terminale mantenevano
colori locali. **Riproduzione →** passare tra Home, Terminale e notifiche nei
due temi. **Attuale →** il contrasto dipendeva da palette duplicate, con rischio
di divergenza tra chiaro e scuro. **Atteso →** canvas, toolbar, feedback e
superficie del terminale devono consumare ruoli semantici centralizzati.
**Gravità →** Medium. **Correzione →** `App.css` mappa le superfici a
`--surface-*`, il codice a `--code-*` e il recupero a `--state-error-soft`.
**Retest →** test dedicato, suite completa (172), lint, build e verifica
manuale in Electron del Terminale AI scuro superati.

### M3-QA-009 — preview e ricerca editor con palette indipendente

**Problema →** preview CSV/Markdown e pannello di ricerca CodeMirror usavano
una palette ad hoc. **Riproduzione →** aprire una preview o la ricerca editor
nei due temi. **Attuale →** bordi e testo potevano non ereditare il contratto
M3 della superficie codice. **Atteso →** le preview dense restano leggibili
con ruoli `--code-*`, mentre gli input usano i ruoli di superficie e focus.
**Gravità →** Medium. **Correzione →** mappate preview, tabella CSV, Markdown
e ricerca ai token semantici. **Retest →** test dedicato, lint e build
superati; la prova manuale completa dell'Editor resta nella matrice aperta.

### M3-QA-010 — `EXECUTE` SQL Server bypassava la conferma

**Problema →** la classificazione delle query mutative riconosceva `EXEC`, ma
non il sinonimo T-SQL `EXECUTE`. **Riproduzione →** inserire
`EXECUTE dbo.procedura` nella console Database e avviare l'esecuzione.
**Attuale →** la UI poteva non mostrare la conferma e il processo principale
non la imponeva. **Atteso →** ogni invocazione di stored procedure richiede la
conferma esplicita prima dell'IPC di esecuzione. **Gravità →** High.
**Correzione →** entrambe le barriere riconoscono `EXECUTE`; la UI condivide
ora la propria classificazione tramite `database-query`. **Retest →** test
backend e renderer dedicati, suite completa (174), lint, build e controllo
whitespace superati; prova manuale Electron con dialogo aperto prima di ogni
esecuzione; nessuna procedura è stata confermata o eseguita durante il test.

### M3-QA-011 — CTE mutativa eseguibile senza conferma

**Problema →** il controllo considerava il primo token SQL; una query
`WITH … DELETE` o `WITH … UPDATE` iniziava quindi con `WITH` e passava per una
lettura. **Riproduzione →** eseguire senza conferma
`WITH target AS (SELECT 1 AS id) DELETE FROM users WHERE id IN (SELECT id FROM target)`.
**Attuale →** la query poteva raggiungere il driver con paginazione da lettura.
**Atteso →** soltanto un `SELECT` senza parole chiave di mutazione può partire
senza conferma. **Gravità →** High. **Correzione →** backend e renderer usano
una policy conservativa: ogni forma diversa da un `SELECT` sicuramente
read-only richiede conferma e non riceve limiti automatici. **Retest →**
integrazione SQLite reale con riga invariata senza conferma, test renderer,
lint, build e suite completa eseguiti; nessun database remoto è stato toccato.

### M3-QA-012 — Editor con palette locale fuori dal contratto M3

**Problema →** Explorer, CodeMirror, preview e ricerca dichiaravano colori
letterali oltre ai token centrali. **Riproduzione →** confrontare gli stili
dell'Editor nei due temi o modificare un ruolo del design system.
**Attuale →** il tema poteva divergere e richiedere override locali.
**Atteso →** l'Editor consuma soltanto ruoli di superficie, codice, stato Git
e focus condivisi. **Gravità →** Medium. **Correzione →** sostituita la
palette locale con `--code-*`, `--git-*`, `--state-*`, `--surface-*` e
`--text-*`. **Retest →** test di assenza palette locale inizialmente rosso e
poi verde, suite completa (176), lint, build e controllo whitespace superati.

### M3-QA-013 — GitHub con palette locale fuori dal contratto M3

**Problema →** repository, grafo, Issue, Projects e dettaglio attività
dichiaravano colori e scrim letterali. **Riproduzione →** confrontare le
superfici GitHub nei temi chiaro e scuro oppure modificare un ruolo del design
system. **Attuale →** i componenti potevano divergere dal contratto della
shell e richiedere override duplicati. **Atteso →** ogni superficie, stato,
bordo, focus e ombra usa un ruolo M3 semantico condiviso. **Gravità →**
Medium. **Correzione →** la palette è stata sostituita con ruoli
`--surface-*`, `--text-*`, `--line-*`, `--brand-*`, `--state-*` e
`--shadow-*`; inclusi modal e gruppi della tabella Project. **Retest →** test
di assenza palette locale inizialmente rosso e poi verde, suite completa
(177), lint, build e controllo whitespace superati. La prova manuale completa
GitHub resta aperta nella matrice.

### M3-QA-014 — Shell dell'app con palette locale fuori dal contratto M3

**Problema →** Home, navigazione, toast, focus, error boundary e toolbar dei
terminali conservavano colori letterali. **Riproduzione →** aprire o cambiare
workspace, mostrare un feedback e passare fra le sezioni nei due temi.
**Attuale →** il contrasto e le superfici dipendevano da una palette separata
dal design system. **Atteso →** la shell usa esclusivamente ruoli semantici e
adatta automaticamente il tema. **Gravità →** Medium. **Correzione →** tutti
i colori sono ricondotti a `--surface-*`, `--text-*`, `--line-*`,
`--brand-*`, `--state-*` e `--focus`; le trasparenze mantengono il ruolo con
`color-mix`. **Retest →** test di assenza palette locale inizialmente rosso e
poi verde, suite completa (178), lint, build e controllo whitespace superati.
Le prove manuali di Home e terminali restano aperte nella matrice.

### M3-QA-015 — Alias shadcn con palette parallela al design system

**Problema →** `index.css` dichiarava una seconda palette generica chiara e
scura per gli alias shadcn. **Riproduzione →** usare Button o Sonner e
confrontare le variabili `--primary`, `--background` e `--ring` con i ruoli
M3. **Attuale →** gli alias potevano divergere dalla shell pur senza essere
usati direttamente dalle pagine. **Atteso →** shadcn resta una fondazione
tecnica, con alias derivati dal solo design system M3. **Gravità →** Medium.
**Correzione →** le palette duplicate sono state rimosse da `index.css` e gli
alias sono mappati centralmente a superfici, testo, stati e focus M3.
**Retest →** test dedicato inizialmente rosso e poi verde, suite completa
(179), lint, build e controllo whitespace superati.

### M3-QA-016 — tema xterm isolato e non reattivo al cambio aspetto

**Problema →** le istanze xterm dichiaravano una palette letterale nel
renderer. **Riproduzione →** aprire Terminale o Terminale AI e cambiare
l'aspetto dell'applicazione. **Attuale →** il canvas poteva non rispettare i
ruoli M3 e restare con colori del tema precedente. **Atteso →** entrambe le
istanze ricevono i colori calcolati dai token `--code-*` e aggiornano la
palette senza riavviare il PTY. **Gravità →** Medium. **Correzione →**
`src/lib/xterm-theme.ts` traduce i token CSS in colori canvas; Pi aggiorna il
tema alla preferenza dell'app e la shell libera osserva il cambio di schema.
**Retest →** test dedicato inizialmente rosso e poi verde, suite completa
(180), lint, build e controllo whitespace superati; Pi pronto verificato dopo
hot reload. Il retest manuale del selettore chiaro resta nella matrice aperta.

### M3-QA-017 — tooltip mancanti su controlli solo-icona

**Problema →** alcuni controlli compatti avevano il solo nome accessibile,
senza il tooltip operativo previsto per un’interfaccia desktop densa.
**Riproduzione →** usare ricerca terminale, selettore vista, allegati o
gestione comandi workspace con il puntatore. **Attuale →** la funzione poteva
restare ambigua a chi non conosce l’icona. **Atteso →** ogni controllo
solo-icona mantiene `aria-label` e un tooltip conciso. **Gravità →** Low.
**Correzione →** aggiunti titoli ai controlli di ricerca, vista, allegati e
gestione comandi; il test statico copre i casi rappresentativi. **Retest →**
test dedicato inizialmente rosso e poi verde, suite completa (180), lint,
build e controllo whitespace superati.

### M3-QA-018 — il renderer perdeva il workspace dopo un rimontaggio

**Problema →** il processo principale conservava il workspace attivo, ma il
renderer non poteva rileggerlo dopo hot reload o remount. **Riproduzione →**
aprire un workspace e rimontare l’interfaccia senza chiudere Electron.
**Attuale →** l’app poteva mostrare la Home pur con la sessione Pi ancora nel
processo principale. **Atteso →** il renderer ripristina workspace e stato Pi
dal processo principale senza ripetere toast o avviare una seconda sessione.
**Gravità →** High. **Correzione →** introdotto `workspace:getActive`,
strettamente read-only e protetto dal trusted sender; il renderer lo usa al
mount e conserva l’eventuale errore Pi già noto. **Retest →** test di
regressione inizialmente rosso e poi verde, suite completa (181), lint, build
e controllo whitespace superati. Il retest desktop con una sessione attiva
resta nella matrice aperta.

### M3-QA-019 — pannelli Impostazioni privi della tab etichettante

**Problema →** le tab dichiaravano il pannello controllato, ma il pannello non
esponeva il collegamento inverso `aria-labelledby`. **Riproduzione →**
navigare le Impostazioni con uno screen reader o con le tab ARIA. **Attuale →**
il contesto del pannello poteva non essere annunciato in modo completo.
**Atteso →** ogni tab e il proprio pannello sono associati in entrambe le
direzioni. **Gravità →** Medium. **Correzione →** assegnati ID stabili alle
quattro tab e `aria-labelledby` ai pannelli corrispondenti. **Retest →** test
dedicato inizialmente rosso e poi verde, suite completa (182), lint, build e
controllo whitespace superati.

### M3-QA-020 — salvataggio parziale della griglia Database

**Problema →** il salvataggio di più righe eseguiva gli `UPDATE` in sequenza
nella transazione attiva. **Riproduzione →** modificare una riga valida e una
riga rimossa o già cambiata da un altro utente, quindi salvare entrambe.
**Attuale →** la prima modifica poteva restare applicata quando la seconda
falliva. **Atteso →** il pulsante Salva applica tutte le bozze oppure nessuna,
lasciando poi all’utente la scelta di correggere, ritentare o fare Rollback.
**Gravità →** High. **Correzione →** ogni batch usa un savepoint compatibile
con SQLite, PostgreSQL, MySQL e SQL Server; al primo errore torna al savepoint
senza chiudere la transazione principale. **Retest →** test SQLite reale
inizialmente rosso (la prima riga restava aggiornata) e poi verde; suite
completa (183), lint, build e controllo whitespace superati.

### M3-QA-021 — override cromatici legacy nel design system

**Problema →** alcune superfici centrali conservavano valori colore letterali
oltre ai token M3, soprattutto nel tema scuro. **Riproduzione →** cambiare un
ruolo semantico e confrontare welcome, card, dialogo e input tra i temi.
**Attuale →** gli override potevano mantenere un colore non aggiornato dal
ruolo, rendendo il contratto M3 fragile. **Atteso →** le superfici usano solo
token o composizioni (`color-mix`) dei token. **Gravità →** Medium.
**Correzione →** rimossi gli override legacy e formattato il foglio centrale
per rendere verificabili le regole; il tema scuro usa ora la superficie
semantica anche per i campi. **Retest →** test dedicato inizialmente rosso e
poi verde; suite completa (184), lint, build e controllo whitespace superati.

### M3-QA-022 — motion limitato al solo dialogo di conferma

**Problema →** Motion for React era installato ma accompagnava soltanto il
dialogo di conferma, lasciando senza continuità visiva Home, pannelli
Impostazioni e dettagli GitHub. **Riproduzione →** cambiare vista nella Home,
selezionare una tab Impostazioni oppure aprire il dettaglio di una Issue o di
un'attività Project. **Attuale →** il cambio era immediato e le durate Motion
erano definite direttamente nel componente. **Atteso →** le superfici
informative usano transizioni M3 coerenti con i token, rispettano la riduzione
del movimento e non rimontano Editor, terminali o Database. **Gravità →**
Medium. **Correzione →** `MotionPresence` legge `--motion-standard` e
`--ease-standard` dal design system; il wrapper è applicato alla Home, ai
pannelli Impostazioni e ai due dettagli consultabili GitHub, mai alle viste
operative persistenti. **Retest →** test inizialmente rosso e poi verde; suite
completa (185), lint, build e controllo whitespace superati. Il renderer
Electron ha inoltre mantenuto l'Editor disponibile dopo hot reload.
