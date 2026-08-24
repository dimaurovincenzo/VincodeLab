const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('Redis richiede un gesto esplicito e non associa SCAN alla selezione persistita', () => {
  const workspace = readFileSync(path.join(root, 'src/features/redis/components/redis-workspace.tsx'), 'utf8')

  assert.match(workspace, /const \[activeConnectionId, setActiveConnectionId\] = useState<string \| null>\(null\)/u)
  assert.match(workspace, /const connectSelected = useCallback\(async \(\) => \{/u)
  assert.match(workspace, /<RedisConnectionGate[\s\S]*onConnect=\{\(\) => void connectSelected\(\)\}/u)
  assert.doesNotMatch(workspace, /if \(selectedId\) void scan/u)
  assert.doesNotMatch(workspace, /\[selectedId\][^\n]*scan/u)
})

test('la vista Redis resta montata dopo la prima visita e il cambio tab non la ricrea', () => {
  const views = readFileSync(path.join(root, 'src/app/components/workspace-views.tsx'), 'utf8')

  assert.match(views, /\(loadedSections\.redis \|\| appSection === 'redis'\)[\s\S]{0,700}<RedisWorkspace[\s\S]{0,300}key=\{workspace\}/u)
  assert.doesNotMatch(views, /key=\{appSection\}[^>]*RedisWorkspace/u)
})
