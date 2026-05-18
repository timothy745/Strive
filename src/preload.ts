import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('striveAPI', {
  login: (email: string, password: string) =>
    ipcRenderer.invoke('login', { email, password }),

  register: (email: string, password: string) =>
    ipcRenderer.invoke('register', { email, password }),

  resetPassword: (email: string, password: string) =>
    ipcRenderer.invoke('resetPassword', { email, password }),

  updateProfile: (data: any) =>
    ipcRenderer.invoke('updateProfile', data),

  getCurrentUser: () =>
    ipcRenderer.invoke('getCurrentUser'),

  uploadProfilePic: () =>
    ipcRenderer.invoke('uploadProfilePic'),

  saveSchedule: (day: string, items: any[]) =>
    ipcRenderer.invoke('saveSchedule', { day, items }),

  getSchedule: (day: string) =>
    ipcRenderer.invoke('getSchedule', { day }),

  autoLogin: (userId: number) =>
    ipcRenderer.invoke('autoLogin', userId),

  logout: () =>
    ipcRenderer.invoke('logout'),
});
