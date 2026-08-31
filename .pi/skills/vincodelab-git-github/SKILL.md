---
name: vincodelab-git-github
description: Modifica le funzioni Git e GitHub di VincodeLab, inclusi stato, branch, grafo, issue e GitHub Projects. Usala per ambito repository, GitHub CLI, paginazione, custom field dei Projects, azioni Git remote e relativa UX.
---

# Git e GitHub del workspace

## Ambito autorevole

- Ogni operazione usa esclusivamente il repository associato al workspace aperto; non cercare o aggregare repository esterni senza un requisito esplicito.
- Il grafo Git mostra il branch attivo del workspace. Non usare `--all` e non includere automaticamente altri branch locali o remoti.
- GitHub CLI è opzionale. La sua assenza o un'autenticazione non valida degrada solo le funzioni GitHub e produce un messaggio con recovery.
- Le operazioni remote e distruttive restano azioni esplicite; non eseguire push, merge, chiusure o cancellazioni come effetto collaterale della navigazione.

## Modellazione e UX

1. Mantieni Git locale in `src/features/git/` e GitHub remoto in `src/features/github/`; i consumer usano gli ingressi pubblici delle feature.
2. Confina GraphQL, `gh`, cache e processi in `electron/infrastructure/github/`; policy e modelli appartengono al dominio GitHub.
3. Gestisci paginazione e limiti come stato esplicito. “Vista parziale” deve spiegare cosa manca e come aggiornare o restringere la vista.
4. Per GitHub Projects conserva ed esponi tutti i campi disponibili, inclusi i custom field. Rendi distinguibili gruppo, contenitore, elemento figlio, stato, assegnatari, label e metadati utili.
5. Nelle issue mantieni numero, titolo e label leggibili; le label non devono diventare testo microscopico. L'espansione deve chiarire la gerarchia senza affollare la riga chiusa.
6. Classifica rete, autenticazione, permessi, rate limit, repository/branch mancanti e conflitti con messaggi diversi e recovery contestuale.

## Verifica

Aggiungi fixture deterministiche per repository e Project con campi built-in e custom. Copri repository errato, branch divergenti, risultati parziali, paginazione, accessibilità e assenza di `gh`. Esegui:

```bash
node --test test/github-service.test.cjs test/github-projects.test.cjs
npm run test:components
npm run check:architecture
npm run build
git diff --check
```

Non usare account, repository privati o token reali nei test e negli screenshot.
