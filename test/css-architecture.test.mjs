import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  auditCssArchitecture,
  auditWithinBudget,
  formatCssAuditSummary,
} from "../scripts/lib/css-audit.mjs";
import appSourceHelper from "./helpers/app-source.cjs";
import settingsSourceHelper from "./helpers/settings-source.cjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { readAppSource } = appSourceHelper;
const { readSettingsSource } = settingsSourceHelper;

export const readWorkspaceFile = (file) =>
  fs.readFileSync(path.join(repoRoot, file), "utf8");
export const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("audit CSS rileva collisioni, important, palette locali e temi nelle viste", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "vincodelab-css-"));
  fs.mkdirSync(path.join(rootDir, "src/styles/views"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "src/a.css"),
    ".toolbar { color: var(--text-primary) !important; }",
  );
  fs.writeFileSync(
    path.join(rootDir, "src/styles/views/editor.css"),
    '.toolbar { color: #fff; } [data-theme="dark"] .panel { color: var(--text-primary); } @media (prefers-color-scheme: dark) { .panel { background: var(--surface-panel); } }',
  );

  const report = auditCssArchitecture({ rootDir });

  assert.equal(report.collisions.length, 1);
  assert.equal(report.importantOccurrences.length, 1);
  assert.equal(report.hardcodedColors.length, 1);
  assert.equal(report.viewThemeSelectors.length, 2);
});

test("audit CSS rende leggibile il report e rifiuta soltanto i budget superati", () => {
  const report = {
    files: ["src/a.css"],
    selectorCount: 4,
    collisions: [{ selector: ".toolbar", property: "color", occurrences: [] }],
    collisionSelectorCount: 1,
    importantOccurrences: [{ file: "src/a.css", line: 1 }],
    hardcodedColors: [],
    viewThemeSelectors: [],
  };
  const budget = {
    maxSelectors: 4,
    maxCollisionSelectors: 1,
    maxCollisionProperties: 1,
    maxImportantOccurrences: 1,
    maxHardcodedColors: 0,
    maxViewThemeSelectors: 0,
  };

  assert.equal(auditWithinBudget(report, budget), true);
  assert.equal(
    auditWithinBudget(report, { ...budget, maxSelectors: 3 }),
    false,
  );
  assert.equal(
    auditWithinBudget(report, { ...budget, maxCollisionSelectors: 0 }),
    false,
  );
  assert.equal(
    auditWithinBudget(report, { ...budget, maxCollisionProperties: 0 }),
    false,
  );
  assert.equal(
    auditWithinBudget(
      { ...report, hardcodedColors: [{ file: "src/a.css", line: 1 }] },
      budget,
    ),
    false,
  );
  assert.match(formatCssAuditSummary(report), /1 selettori collidenti/);
  assert.match(formatCssAuditSummary(report), /1 proprietà collidenti/);
  assert.match(formatCssAuditSummary(report), /1 occorrenze !important/);
});

test("audit CSS conta una dichiarazione una sola volta anche con più selettori", () => {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vincodelab-css-selectors-"),
  );
  fs.mkdirSync(path.join(rootDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(rootDir, "src/a.css"),
    ".button, .link { color: #fff !important; }",
  );

  const report = auditCssArchitecture({ rootDir });

  assert.equal(report.selectorCount, 2);
  assert.equal(report.importantOccurrences.length, 1);
  assert.equal(report.hardcodedColors.length, 1);
});

test("package espone i comandi di audit CSS in lettura e controllo", () => {
  const packageJson = JSON.parse(readWorkspaceFile("package.json"));

  assert.equal(packageJson.scripts["audit:css"], "node scripts/audit-css.mjs");
  assert.equal(
    packageJson.scripts["audit:css:check"],
    "node scripts/audit-css.mjs --check",
  );
});

test("temi e token sono separati dalle viste", () => {
  const tokens = readWorkspaceFile("src/theme/tokens.ts");
  const globalCss = readWorkspaceFile("src/theme/global-css.ts");
  const styleEntry = readWorkspaceFile("src/styles/index.css");
  const app = readAppSource();
  const main = readWorkspaceFile("src/main.tsx");

  for (const token of [
    "'--radius-sm': 'var(--radii-l1)'",
    "'--control-height-sm': 'var(--sizes-control-sm)'",
    "l2: { value: '9px' }",
    "controlMd: { value: '32px' }",
  ]) {
    assert.match(tokens, new RegExp(escapeRegExp(token)));
  }
  assert.match(tokens, /explicitDark:\s*':root\[data-theme="dark"\] &'/);
  assert.match(tokens, /systemTheme:[^\n]*data-theme="system"/);
  assert.match(tokens, /_osDark:\s*\{\s*_systemTheme:/);
  assert.match(globalCss, /_motionReduce/);
  assert.doesNotMatch(styleEntry, /\.\/(base|tokens|themes|primitives)\.css/);
  for (const removedFile of ["base.css", "tokens.css", "themes.css", "primitives.css"]) {
    assert.equal(fs.existsSync(path.join(repoRoot, "src/styles", removedFile)), false);
  }
  assert.match(app, /document\.documentElement\.dataset\.theme = appearance/);
  assert.match(main, /\.\/styles\/index\.css/);
});

test("primitive e shell rispettano la geometria enterprise", () => {
  const recipes = readWorkspaceFile("src/theme/recipes.ts");
  const shellStyles = readWorkspaceFile("src/theme/styles/shell.ts");
  const shell = readWorkspaceFile("src/styles/shell.css");
  const button = readWorkspaceFile("src/components/ui/button.tsx");

  assert.match(shellStyles, /export const shellStyles/);
  assert.match(shellStyles, /gridTemplateColumns:\s*'minmax\(0, 1fr\) auto minmax\(0, 1fr\)'/);
  assert.match(shellStyles, /overflowX:\s*'auto'/);
  assert.match(shellStyles, /@media \(max-width: 1340px\)/);
  assert.match(shellStyles, /'\& \[data-scope="tabs"\]\[data-part="trigger"\]':\s*\{\s*gap:\s*'1',\s*px:\s*'1\.5'\s*\}/);
  assert.match(recipes, /borderRadius:\s*'l2'/);
  assert.match(recipes, /_focusVisible:\s*\{[^}]*focusRing/);
  assert.doesNotMatch([recipes, shellStyles].join("\n"), /linear-gradient|radial-gradient/);
  assert.doesNotMatch(shell, /box-shadow:\s*var\(--elevation-overlay\)/);
  assert.match(shell, /-webkit-app-region:\s*drag/);
  assert.match(button, /styled\(ark\.button, button\)/);
  assert.match(button, /styled-system\/recipes/);
  assert.doesNotMatch(button, /class-variance-authority|tailwind/);
});

test("Terminale e AI possiedono stili isolati e senza palette locale", () => {
  const ai = readWorkspaceFile("src/theme/styles/ai.ts");
  const terminalEntry = readWorkspaceFile("src/theme/styles/terminal.ts");
  const terminalSession = readWorkspaceFile("src/theme/styles/terminal-session.ts");
  const terminalFreeCommand = readWorkspaceFile("src/theme/styles/terminal-free-command.ts");
  const terminalDiagnostics = readWorkspaceFile("src/theme/styles/terminal-diagnostics.ts");
  const terminal = [terminalEntry, terminalSession, terminalFreeCommand, terminalDiagnostics].join("\n");
  const remote = readWorkspaceFile("src/theme/styles/remote.ts");
  const xtermBridge = readWorkspaceFile("src/styles/views/terminal.css");
  for (const source of [ai, terminal, remote, xtermBridge]) {
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    assert.doesNotMatch(source, /!important|data-theme|prefers-color-scheme/);
  }
  assert.match(ai, /export const aiStyles/);
  assert.match(terminalEntry, /export const terminalStyles/);
  assert.match(terminalEntry, /import \{ terminalSessionStyles \} from '\.\/terminal-session'/);
  assert.match(terminalEntry, /import \{ terminalFreeCommandStyles \} from '\.\/terminal-free-command'/);
  assert.match(terminalEntry, /import \{ terminalDiagnosticsStyles \} from '\.\/terminal-diagnostics'/);
  for (const owner of ["terminalSessionStyles", "terminalFreeCommandStyles", "terminalDiagnosticsStyles"]) {
    assert.match(terminalEntry, new RegExp(`\\.\\.\\.${owner}`));
  }
  assert.match(terminalSession, /export const terminalSessionStyles/);
  assert.match(terminalSession, /sessionWorkspace:\s*css\(/);
  assert.match(terminalFreeCommand, /export const terminalFreeCommandStyles/);
  assert.match(terminalFreeCommand, /freePage:\s*css\(/);
  assert.match(terminalFreeCommand, /commandSidebar:\s*css\(/);
  assert.match(terminalDiagnostics, /export const terminalDiagnosticsStyles/);
  assert.match(terminalDiagnostics, /diagnostics:\s*css\(/);
  assert.doesNotMatch(terminalEntry, /^  (?:sessionWorkspace|freePage|commandSidebar|diagnostics):\s*css\(/m);
  assert.match(remote, /export const remoteStyles/);
  assert.match(terminal, /minW:\s*'0'/);
  assert.match(remote, /gridTemplateColumns:/);
  assert.match(xtermBridge, /\[data-xterm-host\] \.xterm/);
});

test("Skill progetto mantiene elenco ed editor affiancati nel workbench AI", () => {
  const ai = readWorkspaceFile("src/theme/styles/ai.ts");

  assert.match(ai, /skillsPage:\s*css\(/);
  assert.match(ai, /--splitter-display/);
  assert.match(ai, /@media \(max-width: 760px\)/);
  assert.match(ai, /gridTemplateColumns:\s*'minmax\(0, 1fr\)'/);
  assert.match(ai, /gridTemplateRows:\s*'minmax\(150px, 42%\) minmax\(0, 1fr\)'/);
});

test("Editor usa token e confina le integrazioni CodeMirror", () => {
  const editor = readWorkspaceFile("src/theme/styles/editor.ts");
  const bridge = readWorkspaceFile("src/styles/views/editor.css");

  assert.match(editor, /export const editorStyles/);
  assert.match(editor, /--splitter-display/);
  assert.match(bridge, /\.codemirror-host \.cm-editor/);
  assert.match(bridge, /\[data-codemirror-merge\] \.cm-editor/);
  assert.doesNotMatch(
    [editor, bridge].join("\n"),
    /#[0-9a-f]{3,8}\b|!important|data-theme|prefers-color-scheme/i,
  );
  for (const token of ["codeSurface", "stateSuccess", "stateWarning", "stateError"]) assert.match(editor, new RegExp(token));
  for (const token of ["--code-surface", "--code-text", "--code-line"]) assert.match(bridge, new RegExp(token));
});

test("Database usa explorer e split pane enterprise senza palette locale", () => {
  const database = readWorkspaceFile("src/theme/styles/database.ts");
  const databaseTableGrid = readWorkspaceFile("src/theme/styles/database-table-grid.ts");
  const bridge = readWorkspaceFile("src/styles/views/database.css");

  assert.match(database, /export const databaseStyles/);
  assert.match(database, /import \{ databaseTableGridStyles \} from '\.\/database-table-grid'/);
  assert.match(database, /\.\.\.databaseTableGridStyles/);
  assert.doesNotMatch(database, /^  grid(?:Row|Cell)?:\s*(?:css|cva)\(/m);
  assert.match(databaseTableGrid, /export const databaseTableGridStyles/);
  assert.match(databaseTableGrid, /grid:\s*css\(\{[\s\S]*?gridTemplateRows:/);
  assert.match(database, /--splitter-display/);
  assert.match(database, /gridTemplateRows:/);
  assert.match(bridge, /\.cm-/);
  assert.doesNotMatch(
    [database, databaseTableGrid, bridge].join("\n"),
    /#[0-9a-f]{3,8}\b|!important|data-theme|prefers-color-scheme/i,
  );
});

test("GitHub usa layout operativi continui e stati semantici", () => {
  const githubEntry = readWorkspaceFile("src/theme/styles/github.ts");
  const githubIssueDetail = readWorkspaceFile("src/theme/styles/github-issue-detail.ts");
  const githubProjectBoard = readWorkspaceFile("src/theme/styles/github-project-board.ts");
  const github = [githubEntry, githubIssueDetail, githubProjectBoard].join("\n");

  for (const layout of ["changesContent", "graphContent", "issuesContent", "projectContent"]) assert.match(github, new RegExp(`${layout}:`));
  for (const state of ["stateSuccess", "stateWarning", "stateError", "stateInfo"]) assert.match(github, new RegExp(state));
  assert.match(githubEntry, /import \{ githubIssueDetailStyles \} from '\.\/github-issue-detail'/);
  assert.match(githubEntry, /import \{ githubProjectBoardStyles \} from '\.\/github-project-board'/);
  assert.match(githubEntry, /\.\.\.githubIssueDetailStyles/);
  assert.match(githubEntry, /\.\.\.githubProjectBoardStyles/);
  assert.match(githubIssueDetail, /export const githubIssueDetailStyles/);
  assert.match(githubIssueDetail, /issueListPanel:\s*css\(/);
  assert.match(githubIssueDetail, /modalContent:\s*css\(/);
  assert.match(githubProjectBoard, /export const githubProjectBoardStyles/);
  assert.match(githubProjectBoard, /projectListPanel:\s*css\(/);
  assert.match(githubProjectBoard, /projectTableRow:\s*cva\(/);
  assert.doesNotMatch(githubEntry, /^  (?:issueListPanel|modalContent|projectListPanel|projectTableRow):\s*(?:css|cva)\(/m);
  assert.doesNotMatch(
    github,
    /linear-gradient|radial-gradient|#[0-9a-f]{3,8}\b|!important|data-theme/i,
  );
});

test("entrypoint CSS non dipende dai fogli legacy", () => {
  const app = readAppSource();
  const main = readWorkspaceFile("src/main.tsx");
  const entrypoint = readWorkspaceFile("src/styles/index.css");
  const legacy = [
    "App.css",
    "design-system.css",
    "dark-theme.css",
    "skills.css",
    "persistent-tabs.css",
    "github.css",
    "settings.css",
    "index.css",
  ];

  for (const file of legacy) {
    assert.equal(app.includes(`'./${file}'`), false);
    assert.equal(main.includes(`'./${file}'`), false);
    assert.equal(entrypoint.includes(`../${file}`), false);
  }
  assert.match(main, /\.\/styles\/index\.css/);
  const viewImports = [...entrypoint.matchAll(/@import "\.\/views\/([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(viewImports, ["database.css", "editor.css", "terminal.css"]);
  assert.doesNotMatch(entrypoint, /views\/(?:home|ai|github|settings)\.css/);
});

test("Home e Impostazioni riusano la shell operativa e le tab condivise", () => {
  const app = readAppSource();
  const settings = readSettingsSource();
  const tabs = readWorkspaceFile("src/components/ui/tabs.tsx");
  const recipes = readWorkspaceFile("src/theme/recipes.ts");
  const homeStyles = readWorkspaceFile("src/theme/styles/home.ts");
  const settingsStyles = readWorkspaceFile("src/theme/styles/settings.ts");

  assert.match(app, /className=\{homeStyles\.root\}/);
  assert.match(settings, /className=\{settingsStyles\.page\}/);
  assert.match(settings, /<Tabs\.Root asChild value=\{tab\}/);
  assert.match(settings, /<Tabs\.List className=\{settingsStyles\.tabs\}/);
  assert.match(settings, /<Tabs\.Indicator\s*\/>/);
  assert.match(tabs, /createStyleContext\(tabs\)/);
  assert.match(tabs, /ArkTabs\.Trigger/);
  assert.match(tabs, /ArkTabs\.Content/);
  assert.match(recipes, /export const tabsRecipe = defineSlotRecipe/);
  assert.doesNotMatch(settings, /role="(?:tablist|tab)"|settings-tab-active/);
  assert.match(homeStyles, /toolbar:\s*css\(\{[\s\S]*?bg:\s*'surfaceRaised'/);
  assert.match(homeStyles, /bodyHeader:\s*css\(\{[\s\S]*?borderBottomColor:\s*'borderDefault'/);
  assert.match(homeStyles, /card:\s*cva\(\{[\s\S]*?bg:\s*'transparent'/);
  assert.doesNotMatch(homeStyles, /welcome:\s*css\(/);
  assert.match(settingsStyles, /panel:\s*css\(/);
  assert.match(settingsStyles, /preferenceSection:\s*css\(\{[\s\S]*?bg:\s*'transparent'/);
  assert.doesNotMatch([homeStyles, settingsStyles].join("\n"), /backdrop-filter|linear-gradient|radial-gradient/);
});
