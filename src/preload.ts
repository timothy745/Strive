import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('striveAPI', {
  login: (email: string, password: string) =>
    ipcRenderer.invoke('login', { email, password }),

  register: (email: string, password: string) =>
    ipcRenderer.invoke('register', { email, password }),

  updateProfile: (data: any) =>
    ipcRenderer.invoke('updateProfile', data),

  getCurrentUser: () =>
    ipcRenderer.invoke('getCurrentUser'),

  uploadProfilePic: () =>
    ipcRenderer.invoke('uploadProfilePic'),
});
