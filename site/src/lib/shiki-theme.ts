import { colors } from './design-tokens'

export const solenoidTheme = {
  name: 'solenoid',
  type: 'dark' as const,
  colors: { 'editor.background': '#0a0a0b', 'editor.foreground': colors.text },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#71717a' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: colors.accent } },
    { scope: ['keyword', 'storage', 'keyword.control', 'keyword.operator'], settings: { foreground: '#a1a1aa' } },
    { scope: ['constant.numeric', 'constant.language', 'variable', 'entity.name.function', 'support.function'], settings: { foreground: colors.text } },
  ],
}
