function createDeveloperToolsBridge(ipcRenderer) {
  return {
    files: {
      list: () => ipcRenderer.invoke('files:list'),
      listDirectory: (directoryId) => ipcRenderer.invoke('files:listDirectory', directoryId),
      index: (options) => ipcRenderer.invoke('files:index', options),
      indexStatus: () => ipcRenderer.invoke('files:indexStatus'),
      read: (fileId) => ipcRenderer.invoke('files:read', fileId),
      preview: (fileId) => ipcRenderer.invoke('files:preview', fileId),
      prepareAttachment: (fileId) => ipcRenderer.invoke('files:prepareAttachment', fileId),
      create: (directoryId, fileName) => ipcRenderer.invoke('files:create', directoryId, fileName),
      createDirectory: (parentId, directoryName) => ipcRenderer.invoke('files:createDirectory', parentId, directoryName),
      rename: (entryId, entryName, expectedKind) => ipcRenderer.invoke('files:rename', entryId, entryName, expectedKind),
      duplicate: (entryId, expectedKind) => ipcRenderer.invoke('files:duplicate', entryId, expectedKind),
      trash: (entryId, expectedKind) => ipcRenderer.invoke('files:trash', entryId, expectedKind),
      save: (fileId, content, options) => ipcRenderer.invoke('files:save', fileId, content, options),
    },
    instructions: {
      get: () => ipcRenderer.invoke('instructions:get'),
      save: (content) => ipcRenderer.invoke('instructions:save', content),
      clear: () => ipcRenderer.invoke('instructions:clear'),
    },
    skills: {
      list: () => ipcRenderer.invoke('skills:list'),
      get: (skillId) => ipcRenderer.invoke('skills:get', skillId),
      create: (name) => ipcRenderer.invoke('skills:create', name),
      update: (skillId, content) => ipcRenderer.invoke('skills:update', skillId, content),
      delete: (skillId) => ipcRenderer.invoke('skills:delete', skillId),
      reload: () => ipcRenderer.invoke('skills:reload'),
    },
    pi: {
      reload: () => ipcRenderer.invoke('pi:reload'),
      restart: () => ipcRenderer.invoke('pi:restart'),
    },
    systemSkills: {
      list: () => ipcRenderer.invoke('systemSkills:list'), get: (id) => ipcRenderer.invoke('systemSkills:get', id), create: (name) => ipcRenderer.invoke('systemSkills:create', name), update: (id, content) => ipcRenderer.invoke('systemSkills:update', id, content), delete: (id) => ipcRenderer.invoke('systemSkills:delete', id),
    },
    runtime: {
      capabilities: () => ipcRenderer.invoke('runtime:capabilities'),
    },
    piSystem: {
      status: () => ipcRenderer.invoke('piSystem:status'), list: () => ipcRenderer.invoke('piSystem:list'), listSkills: () => ipcRenderer.invoke('piSystem:listSkills'), install: (source) => ipcRenderer.invoke('piSystem:install', source), update: (source) => ipcRenderer.invoke('piSystem:update', source), remove: (source) => ipcRenderer.invoke('piSystem:remove', source),
    },
    piConfig: {
      start: () => ipcRenderer.invoke('piConfig:start'), close: () => ipcRenderer.invoke('piConfig:close'), write: (data) => ipcRenderer.send('piConfig:input', data), resize: (dimensions) => ipcRenderer.send('piConfig:resize', dimensions),
      onData: (listener) => { const handler = (_event, data) => listener(data); ipcRenderer.on('piConfig:data', handler); return () => ipcRenderer.removeListener('piConfig:data', handler) },
      onExit: (listener) => { const handler = (_event, status) => listener(status); ipcRenderer.on('piConfig:exit', handler); return () => ipcRenderer.removeListener('piConfig:exit', handler) },
      onError: (listener) => { const handler = (_event, payload) => listener(payload); ipcRenderer.on('piConfig:error', handler); return () => ipcRenderer.removeListener('piConfig:error', handler) },
    },
  }
}

module.exports = { createDeveloperToolsBridge }
