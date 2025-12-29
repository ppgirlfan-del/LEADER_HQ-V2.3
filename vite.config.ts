
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // 載入環境變數（包含 Vercel 注入的變數）
  // Fix: Cast process to any to resolve the 'cwd' property not found error
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // 強制將環境變數注入到前端，這能讓 process.env.XXX 在瀏覽器中正常運作
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.APPS_SCRIPT_URL': JSON.stringify(env.APPS_SCRIPT_URL),
    },
    build: {
      outDir: 'dist',
    }
  };
});
