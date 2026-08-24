const { createGithubUseCases } = require('../../electron/domains/github/github-use-cases.cjs')
const projects = require('../../electron/domains/github/github-projects.cjs')
const cache = require('../../electron/infrastructure/github/github-cache.adapter.cjs')
const runner = require('../../electron/infrastructure/github/command-runner.adapter.cjs')

function createGithubService() {
  return createGithubUseCases({ cache, projects, runner })
}

module.exports = { createGithubService }
