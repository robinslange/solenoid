export const enc = new TextEncoder()
export const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

const HEX_PAIRS = /^(?:[0-9a-f]{2})*$/
export function fromHex(h: string): Uint8Array<ArrayBuffer> {
  if (!HEX_PAIRS.test(h)) throw new Error('invalid hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}
