const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

test('carica issue e Projects con il PATH minimale del bundle macOS', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-packaged-github-'))
  const fakeGh = path.join(root, 'gh')
  const workspace = path.join(root, 'workspace')
  const servicePath = path.join(__dirname, '../electron/github-service.cjs')
  fs.mkdirSync(workspace)
  fs.writeFileSync(fakeGh, `#!/bin/sh
if [ "$1 $2" = "repo view" ]; then
  printf '%s\\n' '{"nameWithOwner":"acme/workspace","url":"https://github.com/acme/workspace","owner":{"login":"acme"}}'
elif [ "$1 $2" = "issue list" ]; then
  printf '%s\\n' '[{"number":42,"title":"Issue dal bundle","body":"","state":"OPEN","author":{"login":"mario"},"createdAt":"2026-08-21T00:00:00Z","updatedAt":"2026-08-21T00:00:00Z","url":"https://github.com/acme/workspace/issues/42","labels":[]}]'
elif [ "$1 $2" = "api graphql" ]; then
  printf '%s\\n' '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_bundle","number":7,"title":"Project dal bundle","shortDescription":"","closed":false,"url":"https://github.com/orgs/acme/projects/7"}]}}}}'
else
  exit 9
fi
`, { mode: 0o755 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))

  const script = `const { getGitHubData } = require(${JSON.stringify(servicePath)}); getGitHubData(${JSON.stringify(workspace)}).then((data) => process.stdout.write(JSON.stringify(data)))`
  const output = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      HOME: os.homedir(),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      VINCODELAB_DATA_DIR: path.join(root, 'data'),
      VINCODELAB_GH_PATH: fakeGh,
    },
  })
  const data = JSON.parse(output)

  assert.ok(data.repository, JSON.stringify(data))
  assert.equal(data.repository.nameWithOwner, 'acme/workspace')
  assert.deepEqual(data.issues.map((issue) => issue.number), [42])
  assert.deepEqual(data.projects.map((project) => project.number), [7])
  assert.equal(data.githubDiagnostic, null)
  assert.equal(data.projectsDiagnostic, null)
})
