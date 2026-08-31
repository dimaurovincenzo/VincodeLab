import { getVincodeLabBridge, type GitHubApi } from '@/bridge'

export const githubBridge = {
  addIssueToProject: (...args: Parameters<GitHubApi['addIssueToProject']>) => getVincodeLabBridge().github.addIssueToProject(...args),
  archiveProjectItem: (...args: Parameters<GitHubApi['archiveProjectItem']>) => getVincodeLabBridge().github.archiveProjectItem(...args),
  closeProject: (...args: Parameters<GitHubApi['closeProject']>) => getVincodeLabBridge().github.closeProject(...args),
  createIssue: (...args: Parameters<GitHubApi['createIssue']>) => getVincodeLabBridge().github.createIssue(...args),
  createProject: (...args: Parameters<GitHubApi['createProject']>) => getVincodeLabBridge().github.createProject(...args),
  createProjectDraft: (...args: Parameters<GitHubApi['createProjectDraft']>) => getVincodeLabBridge().github.createProjectDraft(...args),
  createRepository: (...args: Parameters<GitHubApi['createRepository']>) => getVincodeLabBridge().github.createRepository(...args),
  data: (...args: Parameters<GitHubApi['data']>) => getVincodeLabBridge().github.data(...args),
  editProject: (...args: Parameters<GitHubApi['editProject']>) => getVincodeLabBridge().github.editProject(...args),
  projectBoard: (...args: Parameters<GitHubApi['projectBoard']>) => getVincodeLabBridge().github.projectBoard(...args),
  projectItemFields: (...args: Parameters<GitHubApi['projectItemFields']>) => getVincodeLabBridge().github.projectItemFields(...args),
  updateProjectItem: (...args: Parameters<GitHubApi['updateProjectItem']>) => getVincodeLabBridge().github.updateProjectItem(...args),
}
