export const colors = {
  background: '#101012',
  text: '#E4E4E7',
  accent: '#FF3F00',
} as const

export type Color = keyof typeof colors
