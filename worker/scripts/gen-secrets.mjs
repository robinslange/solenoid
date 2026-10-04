const master = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const { kty, crv, x, d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
console.log(JSON.stringify({ MASTER: master, SIGNING_KEY: JSON.stringify({ kty, crv, x, d }) }))
