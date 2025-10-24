import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import viteCompression from 'vite-plugin-compression'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isAnalyze = mode === 'analyze'
  const isProd = mode === 'production' || isAnalyze

  return {
    plugins: [
      react(),
      // Generate pre-compressed assets for optimal delivery on static hosts/CDNs
      viteCompression({ algorithm: 'brotliCompress' }),
      viteCompression({ algorithm: 'gzip' }),
      // Bundle analyzer when running in analyze mode
      ...(isAnalyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              open: false,
              gzipSize: true,
              brotliSize: true,
            }),
          ]
        : []),
    ],
    resolve: {
      alias: isProd
        ? [
            { find: 'react', replacement: 'preact/compat' },
            { find: 'react-dom/test-utils', replacement: 'preact/test-utils' },
            { find: 'react-dom', replacement: 'preact/compat' },
            { find: 'react/jsx-runtime', replacement: 'preact/jsx-runtime' },
            { find: 'react-dom/client', replacement: 'preact/compat' },
          ]
        : [],
    },
    build: {
      // Use terser for slightly smaller bundles vs esbuild
      minify: 'terser',
      terserOptions: {
        compress: {
          passes: 2,
          drop_console: true,
          pure_funcs: ['console.assert'],
        },
        mangle: true,
        format: { comments: false },
      },
      cssMinify: 'lightningcss',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('preact')) return 'vendor-react'
              return 'vendor'
            }
          },
        },
      },
    },
  }
})
