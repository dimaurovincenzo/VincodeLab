---
name: vincodelab-renderer-ux
description: Progetta, implementa o corregge interfacce React di VincodeLab usando Ark UI, componenti Park-style, Panda CSS e il linguaggio Graphite. Usala per viste, toolbar, sidebar, dialog, menu, focus, tastiera, temi, responsive layout e persistenza delle viste.
---

# Renderer UX di VincodeLab

## Confini da rispettare

- Individua prima l'owner in `src/features/<area>/`; componi la vista dalla shell in `src/app/` senza spostare logica di feature nell'app.
- Importa primitive condivise soltanto da `@/components/ui`. Prima di creare un controllo, verifica se Ark UI o un componente Park-style esistente copre il comportamento.
- Metti token, recipe e stili Panda in `src/theme/`. Non introdurre colori arbitrari, classi Tailwind, CSS globale o CSS locale, salvo integrazioni tecniche come xterm e CodeMirror.
- Consuma capacità native tramite l'adapter della feature e `@/bridge`; non accedere a `window.vincodeLab` dal componente.

## Workflow

1. Leggi il componente, il relativo model/controller, gli stili Graphite e i test esistenti prima di modificare la UI.
2. Definisci chiaramente gerarchia, azione primaria, stati vuoto/loading/error/success/cancelled e comportamento alle dimensioni minime e ampie.
3. Mantieni le sidebar operative collassabili e, quando già previsto, ridimensionabili. Il collasso deve lasciare un comando comprensibile per riaprirle.
4. Non rimontare Editor, CodeMirror, terminali xterm, griglie Database o altre viste persistenti durante la navigazione. Verifica l'identità del nodo quando il rischio esiste.
5. Mantieni terminologia italiana, densità da developer tool, focus visibile e motion controllato. Rispetta `prefers-reduced-motion`.
6. Associa gli errori al punto che li possiede. Usa inline o callout per problemi locali, toast per esiti transitori e dialog soltanto se serve una decisione o c'è rischio di perdita dati.
7. Aggiungi test semantici con Testing Library per tastiera, focus, accessibilità, recovery e persistenza rilevanti.

## Gate mirati

Esegui almeno:

```bash
npm run audit:css:check
npm run test:components
npm run build
git diff --check
```

Se cambi token o recipe, esegui prima `npm run panda -- codegen`. Non modificare `styled-system/` a mano.
