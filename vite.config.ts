
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 載入環境變數（包含 Vercel 注入的變數）
  // 在 Vercel 中，process.cwd() 通常是專案根目錄
  // Fix: Use type cast for process to resolve 'cwd' property error in certain TypeScript environments
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // 強制將環境變數注入到前端
      // 優先使用 loadEnv 載入的變數，若無則嘗試使用系統層級的 process.env
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
      'process.env.APPS_SCRIPT_URL': JSON.stringify(env.APPS_SCRIPT_URL || process.env.APPS_SCRIPT_URL),
    },
    server: {
      port: 3000
    },
    build: {
      outDir: 'dist',
    }
  };
});
