import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 3010 },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({ srcDirectory: 'src' }),
    tailwindcss(),
    viteReact(),
    nitro({ preset: 'node-server' }),
  ],
})
