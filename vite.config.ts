import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    // dist 里有宝塔生成的 .user.ini，Vite 默认清空目录会因不可变属性报 EPERM。
    // 改为由 scripts/clean-dist.mjs 清理，并保留 .user.ini。
    emptyOutDir: false
  },
  server: {
    port: 5000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
})
