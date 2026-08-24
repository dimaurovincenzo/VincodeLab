const { createGitLocalUseCases } = require('./git-local-use-cases.cjs')
const { createGitHubIssueUseCases } = require('./github-issue-use-cases.cjs')
const { createGitHubProjectUseCases } = require('./github-project-use-cases.cjs')

function createGithubUseCases({ cache, projects, runner }) {
  const git = createGitLocalUseCases({ cache, runner })
  const github = createGitHubIssueUseCases({ cache, git, projects, runner })
  const project = createGitHubProjectUseCases({ cache, github, projects, runner })

  return {
    addGitHubRemote: github.addGitHubRemote,
    addWorkspaceIssueToProject: project.addWorkspaceIssueToProject,
    archiveWorkspaceProjectItem: project.archiveWorkspaceProjectItem,
    closeWorkspaceProject: project.closeWorkspaceProject,
    commit: git.commit,
    createBranch: git.createBranch,
    createGitHubRepository: github.createGitHubRepository,
    createIssue: github.createIssue,
    createWorkspaceProject: project.createWorkspaceProject,
    createWorkspaceProjectDraft: project.createWorkspaceProjectDraft,
    editWorkspaceProject: project.editWorkspaceProject,
    fetchRemote: git.fetchRemote,
    getCachedGitHubData: github.getCachedGitHubData,
    getCachedGitStatus: git.getCachedGitStatus,
    getCachedProjectBoard: project.getCachedProjectBoard,
    getFileDiff: git.getFileDiff,
    getGitHubData: github.getGitHubData,
    getGitStatus: git.getGitStatus,
    getLinkedProjectBoard: project.getLinkedProjectBoard,
    getWorkspaceProjectItemFields: project.getWorkspaceProjectItemFields,
    githubAccessDiagnostic: github.githubAccessDiagnostic,
    githubProjectsDiagnostic: github.githubProjectsDiagnostic,
    githubUnavailableData: github.githubUnavailableData,
    initializeGitRepository: git.initializeGitRepository,
    isGitRepository: git.isGitRepository,
    listBranches: git.listBranches,
    pullRebase: git.pullRebase,
    push: git.push,
    revertCommit: git.revertCommit,
    stageFiles: git.stageFiles,
    switchBranch: git.switchBranch,
    unstageFiles: git.unstageFiles,
    updateIssue: github.updateIssue,
    updateWorkspaceProjectItem: project.updateWorkspaceProjectItem,
  }
}

module.exports = { createGithubUseCases }
