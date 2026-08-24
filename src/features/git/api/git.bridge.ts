import { getVincodeLabBridge, type VincodeLabBridge } from '@/bridge'

type GitApi = VincodeLabBridge['github']

export const gitBridge = {
  addRemote: (...args: Parameters<GitApi['addRemote']>) => getVincodeLabBridge().github.addRemote(...args),
  branches: (...args: Parameters<GitApi['branches']>) => getVincodeLabBridge().github.branches(...args),
  commit: (...args: Parameters<GitApi['commit']>) => getVincodeLabBridge().github.commit(...args),
  createBranch: (...args: Parameters<GitApi['createBranch']>) => getVincodeLabBridge().github.createBranch(...args),
  fetch: (...args: Parameters<GitApi['fetch']>) => getVincodeLabBridge().github.fetch(...args),
  fileDiff: (...args: Parameters<GitApi['fileDiff']>) => getVincodeLabBridge().github.fileDiff(...args),
  gitStatus: (...args: Parameters<GitApi['gitStatus']>) => getVincodeLabBridge().github.gitStatus(...args),
  initRepository: (...args: Parameters<GitApi['initRepository']>) => getVincodeLabBridge().github.initRepository(...args),
  pullRebase: (...args: Parameters<GitApi['pullRebase']>) => getVincodeLabBridge().github.pullRebase(...args),
  push: (...args: Parameters<GitApi['push']>) => getVincodeLabBridge().github.push(...args),
  stage: (...args: Parameters<GitApi['stage']>) => getVincodeLabBridge().github.stage(...args),
  switchBranch: (...args: Parameters<GitApi['switchBranch']>) => getVincodeLabBridge().github.switchBranch(...args),
  unstage: (...args: Parameters<GitApi['unstage']>) => getVincodeLabBridge().github.unstage(...args),
  get contextMenu(): VincodeLabBridge['contextMenu'] | undefined { return getVincodeLabBridge().contextMenu },
}
