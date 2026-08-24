const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createDeveloperToolsBridge(ipcRenderer) {
  return {
    files: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST),
      listDirectory: (directoryId) => ipcRenderer.invoke(IPC_CHANNELS.FILES_LIST_DIRECTORY, directoryId),
      index: (options) => ipcRenderer.invoke(IPC_CHANNELS.FILES_INDEX, options),
      indexStatus: () => ipcRenderer.invoke(IPC_CHANNELS.FILES_INDEX_STATUS),
      read: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.FILES_READ, fileId),
      preview: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.FILES_PREVIEW, fileId),
      prepareAttachment: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.FILES_PREPARE_ATTACHMENT, fileId),
      create: (directoryId, fileName) => ipcRenderer.invoke(IPC_CHANNELS.FILES_CREATE, directoryId, fileName),
      createDirectory: (parentId, directoryName) => ipcRenderer.invoke(IPC_CHANNELS.FILES_CREATE_DIRECTORY, parentId, directoryName),
      rename: (entryId, entryName, expectedKind) => ipcRenderer.invoke(IPC_CHANNELS.FILES_RENAME, entryId, entryName, expectedKind),
      duplicate: (entryId, expectedKind) => ipcRenderer.invoke(IPC_CHANNELS.FILES_DUPLICATE, entryId, expectedKind),
      trash: (entryId, expectedKind) => ipcRenderer.invoke(IPC_CHANNELS.FILES_TRASH, entryId, expectedKind),
      save: (fileId, content, options) => ipcRenderer.invoke(IPC_CHANNELS.FILES_SAVE, fileId, content, options),
    },
    instructions: {
      get: () => ipcRenderer.invoke(IPC_CHANNELS.INSTRUCTIONS_GET),
      save: (content) => ipcRenderer.invoke(IPC_CHANNELS.INSTRUCTIONS_SAVE, content),
      clear: () => ipcRenderer.invoke(IPC_CHANNELS.INSTRUCTIONS_CLEAR),
    },
    skills: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),
      get: (skillId) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_GET, skillId),
      create: (name) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_CREATE, name),
      update: (skillId, content) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_UPDATE, skillId, content),
      delete: (skillId) => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_DELETE, skillId),
      reload: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_RELOAD),
    },
    pi: {
      reload: () => ipcRenderer.invoke(IPC_CHANNELS.PI_RELOAD),
      restart: (options) => ipcRenderer.invoke(IPC_CHANNELS.PI_RESTART, options),
    },
    systemSkills: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SKILLS_LIST), get: (id) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SKILLS_GET, id), create: (name) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SKILLS_CREATE, name), update: (id, content) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SKILLS_UPDATE, id, content), delete: (id) => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SKILLS_DELETE, id),
    },
    runtime: {
      capabilities: () => ipcRenderer.invoke(IPC_CHANNELS.RUNTIME_CAPABILITIES),
    },
    piSystem: {
      status: () => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_STATUS), list: () => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_LIST), listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_LIST_SKILLS), install: (source) => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_INSTALL, source), update: (source) => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_UPDATE, source), remove: (source) => ipcRenderer.invoke(IPC_CHANNELS.PI_SYSTEM_REMOVE, source),
    },
    piConfig: {
      start: () => ipcRenderer.invoke(IPC_CHANNELS.PI_CONFIG_START), close: () => ipcRenderer.invoke(IPC_CHANNELS.PI_CONFIG_CLOSE), write: (data) => ipcRenderer.send(IPC_CHANNELS.PI_CONFIG_INPUT, data), resize: (dimensions) => ipcRenderer.send(IPC_CHANNELS.PI_CONFIG_RESIZE, dimensions),
      onData: (listener) => { const handler = (_event, data) => listener(data); ipcRenderer.on(IPC_CHANNELS.PI_CONFIG_DATA, handler); return () => ipcRenderer.removeListener(IPC_CHANNELS.PI_CONFIG_DATA, handler) },
      onExit: (listener) => { const handler = (_event, status) => listener(status); ipcRenderer.on(IPC_CHANNELS.PI_CONFIG_EXIT, handler); return () => ipcRenderer.removeListener(IPC_CHANNELS.PI_CONFIG_EXIT, handler) },
      onError: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on(IPC_CHANNELS.PI_CONFIG_ERROR, handler); return () => ipcRenderer.removeListener(IPC_CHANNELS.PI_CONFIG_ERROR, handler) },
    },
  }
}

module.exports = { createDeveloperToolsBridge }
