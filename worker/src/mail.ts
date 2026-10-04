import type { Purpose } from './codes'

export type Mail = { to: string; subject: string; text: string }
export type Mailer = (m: Mail) => Promise<void>

export function resendMailer(apiKey: string | undefined, from: string, f: typeof fetch = fetch): Mailer {
  return async (m) => {
    if (!apiKey) throw new Error('RESEND_API_KEY is not set')
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) throw new Error(`Resend refused the message: HTTP ${res.status}`)
  }
}

const CODE_FOR: Record<Purpose, (tenant: string, code: string) => { subject: string; lines: string[] }> = {
  attach: (tenant, code) => ({
    subject: `Your Solenoid code to set your recovery email: ${code}`,
    lines: [
      `Your code to make this address the recovery email of Solenoid account ${tenant} is ${code}.`,
      'It works once, within 15 minutes. Once you enter it, a confirmation email follows.',
      "If you didn't ask for it, ignore this email. Nothing changes unless someone enters the code.",
    ],
  }),
  recover: (tenant, code) => ({
    subject: `Your Solenoid code to recover your admin key: ${code}`,
    lines: [
      `Your code to recover the admin key of Solenoid account ${tenant} is ${code}.`,
      'It works once, within 15 minutes. Entering it gives you the admin key back. With `--rotate`, you get a new admin key instead, and every old admin and spend key stops working.',
      "If you didn't ask for it, someone knows this address and the account ID. Ignore this email. Nothing changes unless someone enters the code.",
    ],
  }),
}

export const codeMail = (to: string, code: string, tenant: string, purpose: Purpose): Mail => {
  const { subject, lines } = CODE_FOR[purpose](tenant, code)
  return { to, subject, text: lines.join('\n\n') }
}

export const confirmMail = (to: string, tenant: string): Mail => ({
  to,
  subject: 'Your Solenoid recovery email is set',
  text: [
    `This address can now recover the admin key of Solenoid account ${tenant}.`,
    `Keep this email. If you lose the admin key, start recovery with \`solenoid recover ${to} --tenant ${tenant}\`.`,
  ].join('\n\n'),
})

export const changedMail = (to: string, tenant: string): Mail => ({
  to,
  subject: 'Your Solenoid recovery email was changed',
  text: [
    `This address is no longer the recovery email of Solenoid account ${tenant}. Someone with the account's admin key set a different one.`,
    `Wasn't you? The admin key may have leaked. While your admin key still works, run \`solenoid email ${to}\`, then \`solenoid email ${to} <code> --rotate\` with the code it sends.`,
    'The second command sets this address again and replaces the admin key in one step, so whoever changed the address cannot change it back. It prints the new admin key, and every old admin and spend key stops working. Derive each spend key again with `solenoid key <scope>` and redeploy it.',
    `If \`solenoid email ${to}\` fails with invalid_key, the admin key was already replaced. If you didn't replace it, this address can no longer recover the account, and \`solenoid init --force\` starts a new account, overwriting the saved admin key.`,
  ].join('\n\n'),
})

export const SECURITY_ADDRESS = 'security@solenoid.systems'

export const duplicateMail = (tenant: string, subscription: string, session: string, cancelled: boolean): Mail => ({
  to: SECURITY_ADDRESS,
  subject: cancelled
    ? `Solenoid cancelled a duplicate subscription for account ${tenant}`
    : `Solenoid found a duplicate subscription for account ${tenant} that had already ended`,
  text: (cancelled
    ? [
        `Account ${tenant} was already on Pro when Checkout session ${session} completed, so the Worker cancelled the new subscription ${subscription}.`,
        `If that session was paid, refund it by hand in the Stripe dashboard: open subscription ${subscription}, then its first invoice's payment.`,
      ]
    : [
        `Account ${tenant} was already on Pro when Checkout session ${session} completed. Its new subscription ${subscription} had already ended, so the Worker cancelled nothing.`,
        `A refund may still be due. Check it in the Stripe dashboard: open subscription ${subscription}, then its first invoice's payment.`,
      ]).join('\n\n'),
})
