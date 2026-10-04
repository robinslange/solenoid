export type Auth = { kind: 'admin' | 'spend' | 'internal'; gen: number; epoch: number; keyScope: string }
export const INTERNAL: Auth = { kind: 'internal', gen: 0, epoch: 0, keyScope: '' }
