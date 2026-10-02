/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { appBase } from './src/desktop/basePath';

function appBuild(): string {
  const override = process.env.VITE_BUILD_LABEL?.trim();
  if (override) return override;
  const sha = process.env.GITHUB_SHA?.slice(0, 7);
  if (sha) return sha;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(() => {
  const desktop = appBase() === './';
  const devHost = process.env.TAURI_DEV_HOST;
  const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true';
  const plugins: PluginOption[] = [];
  if (!desktop) {
    plugins.push(VitePWA({
      // A waiting worker stays installed until the Reload toast calls skipWaiting.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '3Dviewer',
        short_name: '3Dviewer',
        description: 'Real-time viewer for Gaussian splats, meshes, and point clouds.',
        theme_color: '#0c0f14',
        background_color: '#0c0f14',
        display: 'standalone',
        start_url: '/3Dviewer/',
        scope: '/3Dviewer/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // index.html is network-first below, not precached, so a deploy is visible on reload.
        globPatterns: ['**/*.{js,css,svg,png,ply,splat,obj,glb,woff2}'],
        navigateFallback: undefined,
        clientsClaim: true,
        // public/sw-update.js: take over immediately when the open page cannot
        // show the Reload toast (the previous autoUpdate client).
        importScripts: ['sw-update.js'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }));
  }
  return {
    base: appBase(),
    clearScreen: !desktop,
    define: {
      __APP_BUILD__: JSON.stringify(appBuild()),
    },
    plugins,
    server: {
      port: 5173,
      strictPort: desktop,
      host: desktop ? devHost || false : true,
      hmr: devHost ? { protocol: 'ws', host: devHost, port: 1421 } : undefined,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    build: {
      target: desktop ? (process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13') : 'es2022',
      chunkSizeWarningLimit: 4000,
      ...(tauriDebug ? { minify: false as const, sourcemap: true } : {}),
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
