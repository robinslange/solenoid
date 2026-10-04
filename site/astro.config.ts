import sitemap from '@astrojs/sitemap'
import tailwind from '@astrojs/tailwind'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'
import { solenoidTheme } from './src/lib/shiki-theme'

export default defineConfig({
  site: 'https://solenoid.systems',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [tailwind({ applyBaseStyles: false }), sitemap()],
  markdown: { shikiConfig: { theme: solenoidTheme } },
  vite: { resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } } },
})
