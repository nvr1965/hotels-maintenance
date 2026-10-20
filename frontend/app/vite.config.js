import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/react/', 
  // Флаги языков — отдельными файлами (грузятся по требованию), а не внутри основного скрипта
  build: { outDir: '../../react', emptyOutDir: true, assetsInlineLimit: (file) => (file.includes('flag-icons') ? false : undefined) },
  server: {
    host: '0.0.0.0', port: 5173,
    proxy: { '/backend/api': { target: 'http://192.168.50.8', changeOrigin: true } }
  }
}))