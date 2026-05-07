import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/step4',
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    open: '/',
  },
})
