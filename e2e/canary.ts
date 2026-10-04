import { fileURLToPath } from 'node:url'
import { solenoid } from '@solenoid.systems/sdk'

export async function canary(o: { key: string; api?: string; region: string; fetch?: typeof fetch }): Promise<{ seq: number; ms: number }> {
  const sol = solenoid({ key: o.key, api: o.api, fetch: o.fetch, timeoutMs: 10_000 })
  const t0 = performance.now()
  const r = await sol.spend(`canary/${o.region}`, { checks: 1 })
  if (!r) throw new Error('the spend returned null, so it went unrecorded')
  const ms = Math.round(performance.now() - t0)
  if (!(await sol.verify(r))) throw new Error(`receipt ${r.id} does not verify against the published keys`)
  return { seq: r.seq, ms }
}

export async function alert(o: { resendKey: string; to: string; region: string; error: string; fetch?: typeof fetch }): Promise<void> {
  const res = await (o.fetch ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${o.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Solenoid canary <auth@solenoid.systems>', to: [o.to], subject: `Solenoid canary failed in ${o.region}`, text: o.error }),
  })
  if (!res.ok) throw new Error(`Resend refused the alert: HTTP ${res.status}`)
}

export async function main(o: { fetch?: typeof fetch } = {}): Promise<void> {
  const region = process.env.CANARY_REGION ?? 'unknown'
  try {
    const key = process.env.SOLENOID_CANARY_KEY
    if (!key) throw new Error('SOLENOID_CANARY_KEY is not set')
    const r = await canary({ key, api: process.env.SOLENOID_API, region, fetch: o.fetch })
    console.log(`ok ${region} seq ${r.seq} ${r.ms}ms`)
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.error(`canary failed in ${region}: ${error}`)
    const { CANARY_ALERT_RESEND_KEY: resendKey, CANARY_ALERT_TO: to } = process.env
    if (resendKey && to) {
      try {
        await alert({ resendKey, to, region, error, fetch: o.fetch })
      } catch (alertError) {
        const alertMsg = alertError instanceof Error ? `${alertError.name}: ${alertError.message}` : String(alertError)
        console.error(`canary alert failed in ${region}: ${alertMsg}`)
      }
    }
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
