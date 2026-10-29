import { contextBridge, ipcRenderer } from 'electron';
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc';
import type { JingjingBridge } from '../shared/ipc';

const bridge = {
  invoke: async (method: string, params?: unknown) => {
    return ipcRenderer.invoke(IPC_INVOKE, { method, params });
  },
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { channel: string; payload: unknown }) => {
      if (data.channel === channel) cb(data.payload);
    };
    ipcRenderer.on(IPC_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_EVENT, listener);
  },
  once: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { channel: string; payload: unknown }) => {
      if (data.channel === channel) {
        ipcRenderer.removeListener(IPC_EVENT, listener);
        cb(data.payload);
      }
    };
    ipcRenderer.on(IPC_EVENT, listener);
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, value: boolean) => cb(value);
      ipcRenderer.on('window:maximized-change', listener);
      return () => ipcRenderer.removeListener('window:maximized-change', listener);
    },
  },
  platform: process.platform,
  versions: {
    app: process.env.JINGJING_VERSION ?? '1.0.0',
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
  },
};

contextBridge.exposeInMainWorld('jingjing', bridge as unknown as JingjingBridge);
