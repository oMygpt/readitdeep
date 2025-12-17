import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        // 增加超时时间以支持 LLM 智能分析 (默认 30s 太短)
        timeout: 120000,  // 120 seconds
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: false,
      },
    },
  },
})
