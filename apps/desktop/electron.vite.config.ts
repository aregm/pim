import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@pim/vault', '@pim/contracts'] })] },
  // The renderer is sandboxed, and a sandboxed preload must be CommonJS (ESM is not supported there).
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rolldownOptions: { output: { format: 'cjs' } } },
  },
  renderer: { plugins: [react()] },
})
