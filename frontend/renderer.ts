export {};

declare global {
  interface Window {
    striveAPI: {
      login: (email: string, password: string) => Promise<{ success: boolean; id?: number; message?: string }>;
      register: (email: string, password: string) => Promise<{ success: boolean; id?: number; message?: string }>;
      resetPassword: (email: string, password: string) => Promise<{ success: boolean; message?: string }>;
      updateProfile: (data: any) => Promise<{ success: boolean; message?: string }>;
      getCurrentUser: () => Promise<any>;
      uploadProfilePic: () => Promise<{ success: boolean; dataUrl?: string; message?: string }>;
      saveSchedule: (day: string, items: any[]) => Promise<{ success: boolean; message?: string }>;
      getSchedule: (day: string) => Promise<any[]>;
      autoLogin: (userId: number) => Promise<{ success: boolean }>;
      googleLogin: (idToken: string) => Promise<{ success: boolean; id?: number; message?: string; isNewUser?: boolean }>;
      startGoogleAuth: () => Promise<{ success: boolean; id?: number; message?: string; isNewUser?: boolean }>;
      logout: () => Promise<{ success: boolean }>;
    };
    showToast: (message: string, type?: string) => void;
  }
}

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
);

// frontend/renderer.ts

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Renderer process loaded');

  // Call the bridge function defined in preload.ts
  const response = await window.electronAPI.getUsers();

  if (response.success) {
    console.log('Data fetched from Neon DB via Netlify:', response.data);
    
    // Example: Display output in an HTML element
    const appElement = document.getElementById('app');
    if (appElement) {
      appElement.innerText = JSON.stringify(response.data, null, 2);
    }
  } else {
    console.error('Failed to load data:', response.error);
  }
});