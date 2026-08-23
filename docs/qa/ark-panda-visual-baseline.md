# VincodeLab — baseline visiva Ark UI, Park UI e Panda CSS

Data: 22 agosto 2026

Commit applicativo verificato: `98bd61d`

Viewport delle catture: `1440 × 900`
Stato: **approvata per il workbench Graphite**

## Ambito

Questa baseline certifica la migrazione completa dell'interfaccia a Ark UI,
Park UI e Panda CSS. Copre le sette aree principali in tema chiaro e scuro,
gli stati trasversali più importanti e il comportamento runtime della shell
Electron.

La precedente baseline Enterprise CSS resta un riferimento storico e non è
usata come baseline corrente.

## Metodo e sicurezza dei dati

Le catture sono state prodotte dal bundle relativo al commit applicativo
indicato, in un profilo Electron isolato, con un workspace dimostrativo, un
repository Git e un database SQLite interamente sintetici. Terminale e
assistente usano processi fittizi con output esplicitamente dimostrativo.

Prima dell'acquisizione sono stati rimossi dal DOM i percorsi del fixture. Le
26 immagini sono state ispezionate visualmente e controllate anche come file:
non contengono percorsi personali, credenziali, chiavi, output reale del
terminale o dati di workspace/database reali.

Le prove sono state non distruttive. Lo stato di errore è stato generato
avviando Pi con un eseguibile fittizio che termina con codice `1`; non è stato
simulato modificando il DOM. Non sono stati eseguiti push, query mutative,
collegamenti SSH, pubblicazioni GitHub o operazioni su servizi remoti.

## Evidenze delle viste principali

| Vista | Tema chiaro | Tema scuro |
| --- | --- | --- |
| Home | [light-home.png](../assets/screenshots/ark-panda/light-home.png) | [dark-home.png](../assets/screenshots/ark-panda/dark-home.png) |
| Terminale AI | [light-terminal-ai.png](../assets/screenshots/ark-panda/light-terminal-ai.png) | [dark-terminal-ai.png](../assets/screenshots/ark-panda/dark-terminal-ai.png) |
| Terminale libero | [light-terminal-remote.png](../assets/screenshots/ark-panda/light-terminal-remote.png) | [dark-terminal-remote.png](../assets/screenshots/ark-panda/dark-terminal-remote.png) |
| Editor | [light-editor.png](../assets/screenshots/ark-panda/light-editor.png) | [dark-editor.png](../assets/screenshots/ark-panda/dark-editor.png) |
| GitHub | [light-github.png](../assets/screenshots/ark-panda/light-github.png) | [dark-github.png](../assets/screenshots/ark-panda/dark-github.png) |
| Database | [light-database.png](../assets/screenshots/ark-panda/light-database.png) | [dark-database.png](../assets/screenshots/ark-panda/dark-database.png) |
| Impostazioni | [light-settings.png](../assets/screenshots/ark-panda/light-settings.png) | [dark-settings.png](../assets/screenshots/ark-panda/dark-settings.png) |

## Evidenze degli stati trasversali

| Stato | Evidenza | Esito |
| --- | --- | --- |
| Dialog | [state-dialog.png](../assets/screenshots/ark-panda/state-dialog.png) | Dialog Ark con titolo accessibile e focus iniziale nel primo campo |
| Conferma | [state-confirmation-dialog.png](../assets/screenshots/ark-panda/state-confirmation-dialog.png) | Azione distruttiva distinta, Escape e ripristino del focus verificati |
| Diff remoto | [state-remote-diff.png](../assets/screenshots/ark-panda/state-remote-diff.png) | `RemoteDiffDialog` reale con CodeMirror MergeView e dati sintetici |
| Workspace popover | [state-workspace-popover.png](../assets/screenshots/ark-panda/state-workspace-popover.png) | Popover Ark, focus e gerarchia delle azioni coerenti |
| Select | [state-select.png](../assets/screenshots/ark-panda/state-select.png) | Select Ark con opzione selezionata e navigazione da tastiera |
| Tooltip | [state-tooltip.png](../assets/screenshots/ark-panda/state-tooltip.png) | Tooltip Ark con ruolo semantico e attivazione da focus |
| Toast | [state-toast.png](../assets/screenshots/ark-panda/state-toast.png) | Feedback non bloccante con ruolo `status` |
| Tree view | [state-tree-view.png](../assets/screenshots/ark-panda/state-tree-view.png) | Ramo espanso, file selezionato e focus distinguibili |
| Splitter attivo | [state-splitter-active.png](../assets/screenshots/ark-panda/state-splitter-active.png) | Separatore focalizzato e affordance di ridimensionamento visibile |
| Vuoto | [state-empty.png](../assets/screenshots/ark-panda/state-empty.png) | Stato vuoto contestuale con azione successiva chiara |
| Caricamento | [state-loading.png](../assets/screenshots/ark-panda/state-loading.png) | Spinner e testo di avanzamento senza salto del layout |
| Errore | [state-error.png](../assets/screenshots/ark-panda/state-error.png) | Recovery Pi reale con ruolo `alert`, diagnostica locale e azione di riavvio |

Il diff remoto è stato renderizzato da `RemoteDiffDialog` e dalla MergeView
CodeMirror reali, usando il sorgente corrente in un runtime temporaneo isolato.
Il fixture usa contenuto e percorso remoto fittizi; non è stata aperta alcuna
connessione SSH.

## Matrice di collaudo Electron

| Area | Prova | Esito |
| --- | --- | --- |
| Temi espliciti | Selezione `Chiaro` e `Scuro` dal Select Ark | PASS — i token semantici aggiornano shell, overlay, editor, terminale e griglie |
| Tema di sistema | `system` verificato simulando preferenza OS chiara e scura | PASS — la palette segue il media query senza perdere la preferenza |
| Reduced motion | Confronto fra preferenza normale e `prefers-reduced-motion: reduce` | PASS — transizioni e animazioni diventano pressoché istantanee |
| Navigazione principale | Arrow Right fra le tab principali | PASS — focus e selezione passano da AI a Editor |
| Dialog e focus | Apertura, focus iniziale, Escape e ritorno al trigger | PASS |
| Tooltip e toast | Attivazione da focus e feedback senza selezione terminale | PASS — ruoli `tooltip` e `status` presenti |
| Splitter da tastiera | Arrow Right sul separatore | PASS — valore 21 → 22 e focus conservato |
| Persistenza splitter | Resize, navigazione e riapertura | PASS — valore salvato in `sessionStorage` |
| Reset splitter | Doppio clic dopo valore persistito non predefinito | PASS — geometria e storage tornano da 314 a 300 px |
| Persistenza Editor | Editor → AI → Editor | PASS — stessa istanza DOM di CodeMirror |
| Persistenza Terminale | Terminale → GitHub → Terminale | PASS — stessa istanza DOM xterm |
| Persistenza Database | Database → Impostazioni → Database | PASS — pannello e CodeMirror non rimontati |
| Finestra compatta | Tutte le aree a `900 × 700` | PASS — nessun overflow orizzontale di documento o `body` |
| Stati delle viste | loading, empty, error e success | PASS — feedback locali e shell sempre operativa |

Le integrazioni persistenti conservano quindi identità e stato durante la
navigazione. La shell non usa `display: none` per aggirare il layout di xterm,
CodeMirror o della griglia Database: ogni area mantiene il proprio contenitore
stabile e riceve il resize disponibile.

## Design system e accessibilità

- `@/components/ui` è l'unico ingresso applicativo per primitive e componenti
  condivisi.
- Ark UI fornisce i comportamenti nativi per dialog, popover, select, tooltip,
  tabs, toast e tree view; le recipe Park sono adattate ai token del prodotto.
- Panda CSS governa reset, token, token semantici, recipe e temi `system`,
  `light` e `dark`.
- Le varianti standard sono `solid`, `subtle`, `surface`, `outline` e `plain`;
  dimensioni, raggi, spacing e stati interattivi sono centralizzati.
- Focus visibile, tastiera, focus trap, Escape, ripristino del focus e
  `reduced-motion` sono coperti da test e collaudo runtime.
- xterm e CodeMirror mantengono solo il CSS tecnico indispensabile e consumano
  i token semantici Graphite.
- Le icone decorative sono escluse dall'albero accessibile; le azioni solo
  icona hanno nome e tooltip.

## Gate automatici

| Gate | Esito |
| --- | --- |
| Test Node | PASS — 419/419 |
| Test componenti | PASS — 18/18 |
| Totale test | PASS — 437/437 |
| Type-check e build Vite | PASS — 3.384 moduli trasformati |
| Lint | PASS |
| `git diff --check` | PASS |
| Audit CSS | PASS — 5 file, 49 selettori, 0 collisioni, 0 `!important`, 0 colori locali, 0 selettori tema locali |
| Residui Tailwind/shadcn/Base UI | PASS — nessun import, dipendenza o classe legacy applicativa |

## Prestazioni e stabilità

Il bundle di produzione genera un chunk applicativo principale di circa
`839,90 kB` raw / `247,28 kB` gzip. Il warning Vite oltre 500 kB è noto e non
blocca questa migrazione: CodeMirror, xterm e le aree specialistiche restano in
chunk separati dove previsto. Nel collaudo Electron la navigazione fra viste è
immediata e, soprattutto, non paga il costo di rimontare editor, terminali o
griglie persistenti.

## Esito

La baseline Ark/Panda è approvata: identità Graphite coerente, temi completi,
primitive native accessibili, viste operative preservate e nessun residuo dello
stack UI precedente. Il gate certifica il worktree locale; non implica un push
o una release e non sostituisce prove distruttive in ambienti remoti dedicati.
