export function isMobileDevice(): boolean {
  return (
    navigator.maxTouchPoints > 0 &&
    window.matchMedia('(max-width: 768px)').matches
  )
}

export function hexToPixi(hex: string): number {
  return parseInt(hex.slice(1), 16)
}
