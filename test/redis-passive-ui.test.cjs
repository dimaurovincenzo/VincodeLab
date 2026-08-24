const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('Redis richiede un gesto esplicito e non associa SCAN alla selezione persistita', () => {
  const workspace = readFileSync(path.join(root, 'src/features/redis/components/redis-workspace.tsx'), 'utf8')
  const content = readFileSync(path.join(root, 'src/features/redis/components/redis-workspace-content.tsx'), 'utf8')
  const session = readFileSync(path.join(root, 'src/features/redis/hooks/use-redis-session-controller.ts'), 'utf8')
  const state = readFileSync(path.join(root, 'src/features/redis/hooks/use-redis-workspace-state.ts'), 'utf8')

  assert.match(workspace, /useRedisWorkspaceController\(props\)/u)
  assert.doesNotMatch(workspace, /redisApi|useState/u)
  assert.match(state, /const \[activeConnectionId, setActiveConnectionId\] = useState<string \| null>\(null\)/u)
  assert.match(session, /const connectSelected = useCallback\(async \(\) => \{/u)
  assert.match(content, /<RedisConnectionGate[\s\S]*onConnect=\{\(\) => void controller\.connectSelected\(\)\}/u)
  assert.doesNotMatch(session, /if \(selectedId\) void browser\.scan/u)
  assert.doesNotMatch(session, /\[selectedId\][^\n]*browser\.scan/u)
})

test('la vista Redis resta montata dopo la prima visita e il cambio tab non la ricrea', () => {
  const views = readFileSync(path.join(root, 'src/app/components/workspace-views.tsx'), 'utf8')

  assert.match(views, /\(loadedSections\.redis \|\| appSection === 'redis'\)[\s\S]{0,700}<RedisWorkspace[\s\S]{0,300}key=\{workspace\}/u)
  assert.doesNotMatch(views, /key=\{appSection\}[^>]*RedisWorkspace/u)
})

test('Redis espone disconnect esplicito nella toolbar e nella Command Palette', () => {
  const toolbar = readFileSync(path.join(root, 'src/features/redis/components/redis-workspace-toolbar.tsx'), 'utf8')
  const controller = readFileSync(path.join(root, 'src/features/redis/hooks/use-redis-workspace-controller.ts'), 'utf8')
  const commands = readFileSync(path.join(root, 'src/app/hooks/use-workbench-commands.ts'), 'utf8')
  const session = readFileSync(path.join(root, 'src/features/redis/hooks/use-redis-session-controller.ts'), 'utf8')

  assert.match(toolbar, /sessionCanDisconnect[\s\S]*Disconnetti/u)
  assert.match(controller, /useRedisMenuCommand\('redis\.disconnect'/u)
  assert.match(commands, /id: 'redis\.disconnect'[\s\S]*context\.redis\.canDisconnect/u)
  assert.match(session, /await api\.disconnect\(connectionId\)/u)
})
