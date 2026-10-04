import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'
import { colors } from './src/lib/design-tokens'

export default {
  content: ['./src/**/*.{astro,html,js,ts,md}'],
  theme: {
    extend: {
      colors: { background: colors.background, text: colors.text, accent: colors.accent },
      fontFamily: { sans: ['Archivo', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
      typography: { invert: { css: { '--tw-prose-body': colors.text, '--tw-prose-headings': colors.accent, fontFamily: 'Archivo, sans-serif' } } },
      keyframes: { 'cursor-blink': { '0%, 49%': { opacity: '1' }, '50%, 100%': { opacity: '0' } } },
      animation: { 'cursor-blink': 'cursor-blink 1s step-end infinite' },
    },
  },
  plugins: [typography],
} satisfies Config
