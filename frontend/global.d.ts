export {};

declare global {
  interface Window {
    striveAPI: {
      getUsers: () => Promise<{ success: boolean; data?: any; error?: string }>;
    };
  }
}