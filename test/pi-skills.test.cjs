const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { createSystemSkillsUseCases } = require('../electron/domains/ai/system-skills.cjs')
const { createSystemSkillsFilesystemAdapter } = require('../electron/infrastructure/filesystem/system-skills-filesystem.adapter.cjs')

const { deleteSystemSkill, listSystemSkills } = createSystemSkillsUseCases({
  storage: createSystemSkillsFilesystemAdapter(),
})

test('il catalogo skill Pi riconosce anche file markdown diretti', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-pi-skills-'))
  try {
    fs.writeFileSync(path.join(root, 'review.md'), '---\nname: review\ndescription: Revisiona il codice.\n---\n')

    assert.deepEqual(listSystemSkills(root).map((skill) => skill.id), ['review'])
    deleteSystemSkill(root, 'review')
    assert.equal(fs.existsSync(path.join(root, 'review.md')), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
