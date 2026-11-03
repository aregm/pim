import { contextBridge, ipcRenderer } from 'electron'

// The only bridge between the renderer and the core. Every call is typed in @pim/contracts.
contextBridge.exposeInMainWorld('pim', {
  engineWorkers: (): Promise<string[]> => ipcRenderer.invoke('engine:workers'),
})
