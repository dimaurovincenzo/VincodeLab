const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { discoverManagedPiPackages, parseGitHubPackageSource } = require('../electron/update-discovery.cjs')

test('riconosce solo le sorgenti GitHub dichiarate da Pi', () => {
  assert.deepEqual(parseGitHubPackageSource('git:github.com/obra/superpowers'), { owner: 'obra', repository: 'superpowers', ref: null })
  assert.deepEqual(parseGitHubPackageSource('git:github.com/pasky/chrome-cdp-skill@v1.0.1'), { owner: 'pasky', repository: 'chrome-cdp-skill', ref: 'v1.0.1' })
  assert.equal(parseGitHubPackageSource('npm:pi-paster'), null)
  assert.equal(parseGitHubPackageSource('git:example.com/owner/repo'), null)
})

test('registra soltanto pacchetti confinati nella root Pi e con commit verificabile', async () => {
  const allowedRoot = path.join(path.sep, 'Users', 'test', '.pi', 'agent')
  const records = [
    { source: 'git:github.com/obra/superpowers', root: path.join(allowedRoot, 'git', 'github.com', 'obra', 'superpowers') },
    { source: 'npm:pi-paster', root: path.join(allowedRoot, 'npm', 'node_modules', 'pi-paster') },
    { source: 'git:github.com/evil/repo', root: path.join(path.sep, 'tmp', 'repo') },
  ]
  const discovered = await discoverManagedPiPackages(records, allowedRoot, {
    realpath: (value) => value,
    readPackage: () => ({ name: 'superpowers' }),
    readGit: async (_root, args) => args[0] === 'rev-parse' ? 'abcdef1234567' : 'main',
  })

  assert.deepEqual(discovered, [{
    id: 'pi-extension:obra/superpowers',
    kind: 'pi-extension',
    name: 'superpowers',
    sourceType: 'github',
    sourceUrl: 'git:github.com/obra/superpowers',
    owner: 'obra',
    repository: 'superpowers',
    ref: 'main',
    channel: 'stable',
    activeVersion: 'abcdef1234567',
    targetPath: path.join(allowedRoot, 'git', 'github.com', 'obra', 'superpowers'),
  }])
})
