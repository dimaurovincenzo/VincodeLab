# VincodeLab — Redesign UX/UI completo

## Direzione

VincodeLab adotta un linguaggio da cockpit macOS: superfici blu grafite in tema scuro, bianco freddo in tema chiaro, accento ciano usato solo per stato attivo e azione primaria. SF Pro governa navigazione e contenuto; SF Mono è riservato a percorsi, codice e dati tecnici.

## Design system

Un singolo set di token definisce superfici, testo, bordi, focus, stato, spaziatura (4/8/12/16/24/32), radius (6/10/14) e ombre. Nessuna sezione usa colori o dimensioni hard-coded quando esiste un token equivalente.

I controlli hanno quattro ruoli: primary per una sola azione dominante, secondary per azioni contestuali, ghost per utility e destructive per operazioni irreversibili. Tutti condividono altezza, focus ring, disabled, hover e active coerenti.

## Struttura delle pagine

- Home: recenti, ricerca, vista e apertura workspace con una gerarchia unica; sidebar ridotta a contesto, non a decorazione.
- AI: terminale come superficie primaria; tab skill e istruzioni come editor ordinati con toolbar compatta.
- Editor e Terminale: strumenti funzionali a densità controllata, con comandi raggruppati e stati vuoti espliciti.
- GitHub: testata repository, azioni Git, issue e Project board riorganizzati in pannelli leggibili; no stile GitHub web sovrapposto al prodotto.
- Impostazioni: gruppi Generali, Pi, Estensioni e Skill di sistema con una sola CTA primaria per gruppo e liste selezionabili senza rumore.

## Tema e accessibilità

Tema chiaro e scuro usano gli stessi token semantici. Focus visibile, contrasto leggibile, touch target di almeno 28px, motion ridotta e stati loading/empty/error riconoscibili in ogni superficie.

## Verifica

La review finale copre Home, AI (tutte le tab), Editor, Terminale, GitHub (modifiche/issue/progetti) e Impostazioni nella build macOS sia chiara sia scura. Build, lint e test devono restare verdi; l'audit visivo non sostituisce i controlli automatici.
