import { getVincodeLabBridge, type GitHubApi, type VincodeLabBridge } from '@/bridge'

export const gitBridge = {
  addRemote: (...args: Parameters<GitHubApi['addRemote']>) => getVincodeLabBridge().github.addRemote(...args),
  branches: (...args: Parameters<GitHubApi['branches']>) => getVincodeLabBridge().github.branches(...args),
  commit: (...args: Parameters<GitHubApi['commit']>) => getVincodeLabBridge().github.commit(...args),
  createBranch: (...args: Parameters<GitHubApi['createBranch']>) => getVincodeLabBridge().github.createBranch(...args),
  fetch: (...args: Parameters<GitHubApi['fetch']>) => getVincodeLabBridge().github.fetch(...args),
  fileDiff: (...args: Parameters<GitHubApi['fileDiff']>) => getVincodeLabBridge().github.fileDiff(...args),
  gitStatus: (...args: Parameters<GitHubApi['gitStatus']>) => getVincodeLabBridge().github.gitStatus(...args),
  initRepository: (...args: Parameters<GitHubApi['initRepository']>) => getVincodeLabBridge().github.initRepository(...args),
  pullRebase: (...args: Parameters<GitHubApi['pullRebase']>) => getVincodeLabBridge().github.pullRebase(...args),
  push: (...args: Parameters<GitHubApi['push']>) => getVincodeLabBridge().github.push(...args),
  stage: (...args: Parameters<GitHubApi['stage']>) => getVincodeLabBridge().github.stage(...args),
  switchBranch: (...args: Parameters<GitHubApi['switchBranch']>) => getVincodeLabBridge().github.switchBranch(...args),
  unstage: (...args: Parameters<GitHubApi['unstage']>) => getVincodeLabBridge().github.unstage(...args),
  get contextMenu(): VincodeLabBridge['contextMenu'] | undefined { return getVincodeLabBridge().contextMenu },
}
