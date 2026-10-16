import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Planify — Vite configuration.
 *
 * The dev server binds to 0.0.0.0 so it is reachable through the Arena live
 * preview proxy, and `/api` is proxied to the local Node server that keeps
 * every secret (LLM keys, Google Calendar tokens) off the client.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.API_PORT || 8787);

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
        manifest: {
          name: 'Planify — Liquid Glass Calendar',
          short_name: 'Planify',
          description:
            'A premium calendar with AI scheduling, Google sign-in and secure cross-device sync.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#0A0A0C',
          theme_color: '#0A0A0C',
          categories: ['productivity'],
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'icons/maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Network-first for the app shell so a deploy is picked up promptly,
          // but everything is cached for offline reads.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          navigateFallback: '/index.html',
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: false,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2020',
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Keep vendor code out of the app chunk so a UI change doesn't
            // invalidate the caches users already have.
            if (id.includes('node_modules')) {
              if (
                id.includes('@supabase') ||
                id.includes('realtime-js') ||
                id.includes('postgrest-js') ||
                id.includes('auth-js') ||
                id.includes('functions-js') ||
                id.includes('storage-js') ||
                id.includes('supabase-js') ||
                id.includes('@phoenix') ||
                id.includes('ws')
              ) {
                return 'supabase';
              }
              if (id.includes('react-dom') || id.includes('scheduler')) return 'react-dom';
              if (id.includes('/react/') || id.includes('react-is')) return 'react';
              if (id.includes('date-fns')) return 'date';
              return 'vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
