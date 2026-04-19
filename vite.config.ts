import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electronRenderer from 'vite-plugin-electron-renderer'
import pkg from './package.json'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      react(),
      tailwindcss(),
      electron([
        // Main process
        {
          entry: 'electron/main/main.ts',
          vite: {
            build: {
              rollupOptions: {
                output: {
                  format: 'esm',
                  entryFileNames: 'main.mjs',
                },
                external: [
                  '@nut-tree-fork/nut-js',
                  'uiohook-napi',
                  'node-record-lpcm16',
                  'fluent-ffmpeg',
                  '@ffmpeg-installer/ffmpeg',
                  'ws',
                  'bufferutil',
                  'utf-8-validate',
                ],
              },
            },
          },
        },
        // Preload script (CJS for sandbox)
        {
          onstart(args) {
            args.reload()
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              sourcemap: isDev,
              emptyOutDir: false,
              rollupOptions: {
                input: path.join(__dirname, 'electron/preload/preload.ts'),
                output: {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                  inlineDynamicImports: true,
                },
                external: [
                  '@nut-tree-fork/nut-js',
                  'uiohook-napi',
                  'fluent-ffmpeg',
                  '@ffmpeg-installer/ffmpeg',
                ],
              },
            },
          },
        },
        // Hook worker (utility process, ESM)
        {
          vite: {
            build: {
              outDir: 'dist-electron',
              sourcemap: isDev,
              emptyOutDir: false,
              rollupOptions: {
                input: path.join(__dirname, 'electron/utility/hook-worker.ts'),
                output: {
                  format: 'esm',
                  entryFileNames: 'hook-worker.mjs',
                },
                external: ['uiohook-napi'],
              },
            },
          },
        },
      ]),
      electronRenderer(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@electron': path.resolve(__dirname, './electron'),
      },
    },
  }
})
