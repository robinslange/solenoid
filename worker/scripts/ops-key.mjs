const master = process.env.MASTER
if (!master) { console.error('MASTER=<secret> node scripts/ops-key.mjs'); process.exit(1) }
const enc = new TextEncoder()
const k = await crypto.subtle.importKey('raw', enc.encode(master), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode('admin:solenoidops2:1')))
console.log(`sk.admin.solenoidops2.1.${[...sig].map((b) => b.toString(16).padStart(2, '0')).join('')}`)
