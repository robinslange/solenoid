import { join } from 'node:path'
import { checkApi, checkScope, Outage, recover, requestRecovery, signup, solenoid, SolenoidError, SolenoidUnavailable, type View } from '@solenoid.systems/sdk'
import { fileStore } from '@solenoid.systems/sdk/node'
import { openUrl } from './browser'
import { appendEnvKey, readEnvKey } from './envfile'
import { apiBase, credsPath, hasCreds, readCreds, writeCreds } from './config'

const scopeArg = (s: string | undefined) => checkScope(s === undefined || s === '/' ? '' : s.replace(/^\/+|\/+$/g, ''))
const badApi = (e: Error) => e.message.startsWith('solenoid: the API must be')
const QUALIFIED = 'with no user, password, query or fragment and on a port that fetch allows'

function client(timeoutMs?: number) {
  const c = readCreds()
  try {
    return solenoid({ key: c.admin_key, api: c.api, timeoutMs, store: fileStore() })
  } catch (e) {
    if (!badApi(e as Error)) throw e
    throw new Error(`the api saved in ${credsPath()} is not an http or https URL ${QUALIFIED}. run \`solenoid login <admin-key>\` with SOLENOID_API set to your account's API, such as https://api.solenoid.systems, to save it again.`)
  }
}

export const tenantOf = (key: string | undefined) => /^sk\.(?:admin|spend)\.([a-z2-7]{12})\./.exec(key ?? '')?.[1]

function savedTenant() {
  try {
    return tenantOf(readCreds().admin_key)
  } catch {}
}

const onlyCopy = (api: string, e: unknown) =>
  `the new admin key printed on stdout is the only copy. copy it somewhere safe now. every previous key, admin and spend, already fails. once ${credsPath()} is writable, run \`SOLENOID_API=${api} solenoid login <admin-key>\` with it, then re-derive each spend key with \`solenoid key <scope>\` and redeploy them. saving failed with: ${(e as Error).message}`

function recoveryTenant(flags: Record<string, string | boolean | undefined>): string {
  const t = (flags.tenant as string | undefined)
    ?? tenantOf(process.env.SOLENOID_KEY)
    ?? tenantOf(readEnvKey(join(process.cwd(), '.env')))
    ?? savedTenant()
  if (!t) throw new Error('recover needs the account ID: pass --tenant <id>. it is the third field of any key (sk.spend.<id>.…), and the email that confirmed your recovery address names it.')
  if (!/^[a-z2-7]{12}$/.test(t)) throw new Error(`"${t}" is not an account ID. --tenant takes the 12 characters of lowercase a-z and 2-7 in the third field of any key (sk.spend.<id>.…).`)
  return t
}

const codeSent = (email: string) => `a 6-digit code is on its way to ${email}. it works once, within 15 minutes: run \`solenoid email ${email} <code>\` to confirm it.`

function sendFailed(e: Error & { code?: string }, email: string): string {
  if (e.code === 'invalid_email') return `the account is ready, but ${email} is not an address solenoid can send to (invalid_email). check it for typos, then run \`solenoid email <address>\`.`
  const next = e instanceof Outage || e.code === 'email_failed' ? `run \`solenoid email ${email}\` to try again.` : 'run `solenoid email <address>` to attach a recovery email.'
  return `the account is ready, but the code could not be sent (${e.code ?? e.message}). ${next}`
}

const RATE_LIMITED = new Map<string | undefined, string>([
  ['init', 'signups from one network are limited per day. wait up to a day, then try again.'],
  ['email', 'an address gets at most 5 codes an hour, and an account at most 10 attach codes a day. wait an hour, or a day if this account has sent 10 today, then try again.'],
  ['recover', 'recovery requests from one network are limited per day. wait up to a day, then try again.'],
])

const num = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN)

function pairs(args: string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const a of args) {
    const pair = /^([^=]+)=([^=]+)$/.exec(a)
    if (!pair) throw new Error(`expected unit=value, got "${a}"`)
    const [, unit, v] = pair
    out[unit] = v === 'off' ? null : num(v)
    if (out[unit] !== null && !Number.isFinite(out[unit])) throw new Error(`not a decimal number: "${a}"`)
  }
  return out
}

function amounts(args: string[]): Record<string, number> {
  const p = pairs(args)
  for (const [unit, v] of Object.entries(p)) if (v === null) throw new Error(`spend does not take "off"; give a number for "${unit}"`)
  return p as Record<string, number>
}

export function limitBody(pos: string[], flags: Record<string, string | boolean | undefined>): Record<string, number | string | null> {
  const per = flags.per as string | undefined
  const onOutage = flags['on-outage'] as string | undefined
  const warnAt = flags['warn-at'] !== undefined ? num(flags['warn-at'] as string) : undefined
  if (warnAt !== undefined && !Number.isFinite(warnAt)) throw new Error(`"--warn-at" takes a decimal fraction greater than 0 and up to 1, such as 0.8; "${flags['warn-at']}" is not a decimal number.`)
  return {
    ...pairs(pos),
    ...(per ? { per } : {}),
    ...(onOutage ? { on_outage: onOutage } : {}),
    ...(warnAt !== undefined ? { warn_at: warnAt } : {}),
  }
}

function show(v: View): string {
  const lines = v.limits.map((l) => {
    const usage = l.used === null ? 'tracked separately per child' : `used ${l.used}  left ${l.left}`
    return `${l.unit.padEnd(12)} ${String(l.limit).padEnd(8)} ${(l.per ?? 'lifetime').padEnd(9)} ${usage}  (${l.scope || '/'}, ${l.on_outage}${l.warn_at ? `, warn at ${l.warn_at}` : ''})`
  })
  return [v.scope || '/', ...(lines.length ? lines : ['(no limits)']), ...(v.children.length ? [`children: ${v.children.join(' ')}`] : [])].join('\n')
}

function explain(code: string, detail: Record<string, unknown>, cmd: string | undefined): string | undefined {
  switch (code) {
    case 'limit_exceeded': {
      const resets = detail.resets as string | null
      const window = resets ? `it resets at ${resets}` : 'it has no window, so only raising it or removing it helps'
      return `the limit on "${detail.scope}" for "${detail.unit}" is reached (used ${detail.used} of ${detail.limit}); ${window}. raise it with \`solenoid limit ${detail.scope} ${detail.unit}=<n>\`, or remove it with \`solenoid limit ${detail.scope} ${detail.unit}=off\`.`
    }
    case 'invalid_key':
      return 'this admin key (it starts sk.admin.) is invalid or was rotated elsewhere; run `solenoid login <admin-key>` with the current one. `solenoid key <scope>` cannot fix this, because deriving a key also needs a working admin key. a deployed spend key (starts sk.spend.) failing the same way has two possible causes. if its own scope was rotated, the admin key still works: derive a fresh one with `solenoid key <scope>` and redeploy it. if the admin key itself was rotated, every spend key now fails: log in with the current admin key first (`solenoid login <admin-key>`), then re-derive and redeploy. if the admin key is lost, `solenoid recover <email>` gets it back when the account has a recovery email.'
    case 'out_of_scope':
      return `the key only covers "${detail.key_scope}" and scopes under it, not "${detail.scope}". use a key derived for "${detail.scope}" or an ancestor of it.`
    case 'admin_required':
      return 'this needs the admin key. run `solenoid login <admin-key>` first.'
    case 'idempotency_conflict':
      return 'a different spend already used this request id with a different scope or amounts. check whether the earlier one went through with `solenoid log <scope>`, then retry with a fresh request.'
    case 'invalid_limit': {
      const field = detail.field as string | undefined
      if (field === undefined) return 'give at least one <unit>=<n|off> pair, or a rotate flag.'
      if (field === 'per') return '"--per" must be one of hour, day, week, month, child, child-day.'
      if (field === 'on_outage') return '"--on-outage" must be open or closed.'
      if (field === 'warn_at') return '"--warn-at" must be a fraction greater than 0 and up to 1.'
      return `the value for "${field}" must be a number, or "off" to remove it.`
    }
    case 'invalid_unit':
      return `"${detail.unit}" is not a valid unit name. a unit is lowercase, starts with a letter, and matches [a-z][a-z0-9_]{0,31} ("spends" is reserved).`
    case 'invalid_amount':
      return 'an amount must be a positive number (a settle may use zero). check the amount you gave.'
    case 'invalid_code':
      return 'the code is wrong, used, expired, or replaced by a newer one. if you mistyped it, try it again. ask for a new one, by running the same command without the code, only if it expired or was used: ' +
        'a wrong try counts once for each live code, so every extra code makes the next check count more. after several wrong tries, code checks for this address pause: ' +
        'wait up to 15 minutes for older codes to expire, or for the hour or day to pass, then try again. asking for a code uses one of the address\'s 5 requests an hour.'
    case 'invalid_email':
      return 'that is not an address solenoid can send to. check it for typos.'
    case 'rate_limited':
      return RATE_LIMITED.get(cmd)
    case 'email_failed':
      return 'solenoid could not send the email, so no recovery email was attached. try again in a minute; each try counts toward the address\'s 5 codes an hour.'
    case 'billing_unavailable':
      return 'billing is not open yet, so Pro cannot be bought today. run `solenoid upgrade` again later; solenoid.systems/pricing says when Pro opens. the free plan keeps working: 100,000 spends each UTC calendar month.'
    default:
      return undefined
  }
}

const outageNextStep = (s: string) =>
  `retry once solenoid is reachable. to let spends at "${s}" through a later outage, every limit that applies there, including those on parent scopes, must fail open. ` +
  `once solenoid is reachable (solenoid limit needs it too), run \`solenoid ls ${s}\`, and for each limit it lists run ` +
  '`solenoid limit <its scope> <unit>=<its limit> --per <its per> --warn-at <its warn-at> --on-outage open`, leaving out --per for a lifetime limit ' +
  'and --warn-at for a limit with none, because the command replaces the whole limit. the next spend that reaches solenoid then records the new mode in your outage cache.'

export function formatError(e: Error & { code?: string; detail?: Record<string, unknown>; scope?: string }, cmd?: string): string {
  if (badApi(e)) return `solenoid: SOLENOID_API must be an http or https URL, such as https://api.solenoid.systems, ${QUALIFIED}. fix it, or unset it to use that address.`
  const base = /^solenoid[:\s]/.test(e.message) ? e.message : `solenoid: ${e.message}`
  if (!e.code && /^solenoid is unreachable/.test(e.message)) {
    const scope = e.scope === undefined ? '<scope>' : e.scope || '/'
    return `${base}. ${outageNextStep(scope)}`
  }
  if (!e.code && /^solenoid: invalid scope /.test(base)) {
    return `${base}. a scope is up to 8 segments separated by "/", each 1 to 64 characters of lowercase a-z, 0-9, . _ -, and not made only of dots.`
  }
  const next = e.code ? explain(e.code, e.detail ?? {}, cmd) : undefined
  return next ? `${base}. ${next}` : base
}

export function argError(e: Error & { code?: string }): Error {
  const flag = /'(-[^' ]*)/.exec(e.message)?.[1]
  if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return new Error(`unknown option "${flag}"; run \`solenoid help\` to see the options`)
  if (/ambiguous/.test(e.message)) return new Error(`"${flag}" needs a value, and a value that starts with "-" must be written as ${flag}=<value>; run \`solenoid help\` to see the options`)
  return new Error(`"${flag}" ${/argument missing/.test(e.message) ? 'needs a value' : 'takes no value'}; run \`solenoid help\` to see the options`)
}

const HELP = [
  'solenoid keeps an agent inside a spend limit: a spend that would go over is refused before the action runs, and every recorded spend returns a signed receipt.',
  '',
  'start with: solenoid init <scope>',
  '',
  'commands:',
  '  init [scope] [--email address] [--force]                            create an account; with --email, start attaching a recovery email',
  '  email <address> [code] [--rotate]                                   attach a recovery email: the first run sends a code, the second confirms it; --rotate on the second also replaces the admin key and revokes every spend key',
  '  recover <email> [code] [--tenant id] [--rotate] [--force]           get the admin key back by email; --rotate also revokes the old admin key and every spend key',
  '  login <admin-key>                                                   use an existing account\'s admin key on this machine',
  '  key <scope>                                                         print a spend key for <scope>',
  '  limit <scope> <unit>=<n|off>... [--per p] [--on-outage m] [--warn-at f]',
  '                                                                       set or remove a limit (per: hour, day, week, month, child, child-day; on-outage: open, closed; warn-at: a fraction such as 0.8)',
  '  spend <scope> <unit>=<n>...                                         record a spend and check it against every limit at and above <scope>',
  '  ls [scope]                                                          show the limits and children at <scope>',
  '  log [scope] [--before n]                                            show recent entries at <scope>',
  '  rotate <scope> --yes                                                revoke every key derived for <scope>',
  '  rotate --admin --yes                                                revoke the admin key and every spend key',
  '  upgrade                                                             opens Stripe Checkout to move this account to Pro, or prints the billing portal link when already on Pro',
].join('\n')

export async function dispatch(cmd: string, pos: string[], flags: Record<string, string | boolean | undefined>): Promise<string> {
  switch (cmd) {
    case 'help': return HELP
    case 'init': {
      const scope = pos[0] === undefined ? undefined : scopeArg(pos[0])
      if (hasCreds() && !flags.force) throw new Error('already initialised; --force creates another account and overwrites the saved admin key for this one, so you lose local access to it unless you saved it elsewhere')
      const api = checkApi(apiBase())
      const { tenant, admin_key } = await signup(api)
      writeCreds({ api, admin_key })
      const out = [`account: ${tenant}`, `admin key: ${admin_key}`, `it is saved at ${credsPath()}. keep a copy somewhere safe: it can mint and revoke every other key.`]
      const email = (flags.email as string | undefined)?.trim().toLowerCase()
      if (email !== undefined) {
        out.push(await solenoid({ key: admin_key, api }).sendEmailCode(email).then(() => codeSent(email), (e: Error) => sendFailed(e, email)))
      } else {
        out.push('attach a recovery email so you can get the admin key back if it is lost: `solenoid email <address>`.')
      }
      if (scope !== undefined) {
        const key = await solenoid({ key: admin_key, api }).deriveKey(scope, 0)
        out.push(appendEnvKey(join(process.cwd(), '.env'), key) === 'added' ? `spend key for "${scope}" written to .env` : `.env already has SOLENOID_KEY; it is left as is, and this key is not written there. replace it yourself if you want this scope's spend key instead: ${key}`)
      }
      return out.join('\n')
    }
    case 'email': {
      const email = pos[0]?.trim().toLowerCase()
      if (!email) throw new Error('email needs an address: run `solenoid email <address>` to get a code, then `solenoid email <address> <code>` to confirm it')
      if (pos[1] === undefined) {
        if (flags.rotate) throw new Error(`--rotate goes on the second run, the one that confirms the code. nothing was sent. run \`solenoid email ${email}\` to get a code, then \`solenoid email ${email} <code> --rotate\`.`)
        await client().sendEmailCode(email)
        return codeSent(email)
      }
      const attached = (r: { email: string; tenant: string }) => `${r.email} can now recover the admin key of account ${r.tenant}. keep the confirmation email: it names the account ID, which recovery asks for.`
      if (!flags.rotate) return attached(await client().verifyEmail(email, pos[1]))
      const c = readCreds()
      const r = await client().verifyEmail(email, pos[1], { rotate: true }).catch((e) => {
        if (!(e instanceof Outage)) throw e
        throw new Error([
          'the request failed before solenoid confirmed it, so it may have gone through. wait a minute, then run `solenoid ls`.',
          `if \`solenoid ls\` works, nothing changed, but the code may be used up. get a new code with \`solenoid email ${email}\`, then run \`solenoid email ${email} <code> --rotate\` again.`,
          `if it fails with invalid_key, the admin key was replaced, by this change or by someone else first. run \`solenoid recover ${email}\`.`,
          `if a code arrives, ${email} is the recovery email. \`solenoid recover ${email} <code>\` prints and saves the current admin key. then re-derive each spend key with \`solenoid key <scope>\` and redeploy them.`,
          `if no code arrives within a few minutes, and ${email} has had fewer than 5 codes this hour, ${email} is not the recovery email. someone else replaced the key, and ${email} can't recover the account. \`solenoid init --force\` starts a new account and overwrites the saved admin key.`,
          'if solenoid still can\'t be reached, wait, then run `solenoid ls` again.',
        ].join('\n'))
      })
      process.stdout.write(`new admin key: ${r.admin_key}\n`)
      try {
        writeCreds({ ...c, admin_key: r.admin_key! })
      } catch (e) {
        throw new Error(onlyCopy(c.api, e))
      }
      return [
        attached(r),
        `the new admin key is saved at ${credsPath()}, and this CLI uses it from here on. back it up somewhere safe.`,
        'every previous key (admin and spend) now fails. re-derive each spend key with `solenoid key <scope>` and redeploy them.',
      ].join('\n')
    }
    case 'recover': {
      const email = pos[0]?.trim().toLowerCase()
      if (!email) throw new Error('recover needs the recovery email: run `solenoid recover <email>` to get a code, then `solenoid recover <email> <code>`')
      const tenant = recoveryTenant(flags)
      const api = checkApi(apiBase())
      const tenantFlag = flags.tenant ? ` --tenant ${tenant}` : ''
      if (pos[1] === undefined) {
        await requestRecovery(tenant, email, { api })
        return `if ${email} is the recovery email of account ${tenant}, a 6-digit code is on its way. it works once, within 15 minutes: run \`solenoid recover ${email} <code>${tenantFlag}\`. add --rotate to that command if the old admin key may have leaked; it revokes that key and every spend key. if no code arrives within a few minutes, ${email} may not be this account's recovery email, or it has had 5 code requests this hour.`
      }
      if (!flags.force && hasCreds()) {
        const saved = savedTenant()
        if (!saved) throw new Error(`${credsPath()} holds no admin key solenoid can read. the code is still good: re-run with --force to replace the file, or delete it and re-run.`)
        if (saved !== tenant) throw new Error(`the saved admin key belongs to account ${saved}. the code is still good: re-run with --force to replace it with account ${tenant}'s key.`)
      }
      const r = await recover(tenant, email, pos[1], { api, rotate: flags.rotate === true })
      process.stdout.write(`${flags.rotate ? 'new admin key' : 'admin key'}: ${r.admin_key}\n`)
      try {
        writeCreds({ api, admin_key: r.admin_key })
      } catch (e) {
        throw new Error(flags.rotate
          ? onlyCopy(api, e)
          : `the admin key printed on stdout works, and so does every deployed spend key. saving it failed, so copy it somewhere safe now. once ${credsPath()} is writable, run \`SOLENOID_API=${api} solenoid login <admin-key>\` with it. saving failed with: ${(e as Error).message}`)
      }
      return flags.rotate
        ? `it is saved at ${credsPath()}. every previous key, admin and spend, now fails: re-derive each spend key with \`solenoid key <scope>\` and redeploy them.`
        : `it is saved at ${credsPath()}. deployed spend keys keep working.`
    }
    case 'login': {
      if (!pos[0]?.startsWith('sk.admin.')) throw new Error('login needs an admin key (sk.admin.…)')
      const api = checkApi(apiBase())
      await solenoid({ key: pos[0], api }).get('')
      writeCreds({ api, admin_key: pos[0] })
      return 'logged in'
    }
    case 'key': return client().deriveKey(scopeArg(pos[0]))
    case 'limit': return show(await client().limit(scopeArg(pos[0]), limitBody(pos.slice(1), flags)))
    case 'spend': {
      const scope = scopeArg(pos[0])
      const spendAmounts = amounts(pos.slice(1))
      try {
        const r = await client().spend(scope, spendAmounts)
        return r ? `${r.id} seq ${r.seq}` : `solenoid could not be reached, and your outage cache says the limits on "${scope || '/'}" fail open, so the spend went ahead without a record.`
      } catch (e) {
        if (e instanceof SolenoidUnavailable) {
          throw new Error(`the spend was refused because solenoid could not be reached, and your outage cache does not say the limits on "${scope || '/'}" fail open. ${outageNextStep(scope || '/')}`)
        }
        throw e
      }
    }
    case 'ls': return show(await client().get(scopeArg(pos[0])))
    case 'log': {
      const v = await client().get(scopeArg(pos[0]), { before: flags.before ? Number(flags.before) : undefined })
      const rows = v.entries.map((e) => `${String(e.seq).padStart(6)}  ${e.at}  ${e.kind.padEnd(6)} ${(e.scope || '/').padEnd(30)} ${JSON.stringify(e.body)}`)
      return [...rows, ...(v.next ? [`more: solenoid log ${pos[0] ?? ''} --before ${v.next}`] : [])].join('\n')
    }
    case 'rotate': {
      const scope = scopeArg(pos[0])
      if (!flags.yes) {
        if (flags.admin) {
          throw new Error('rotating the admin key revokes every key: this admin key, and every spend key derived from it, across every scope. re-run with --yes to confirm; this command then prints and saves the new admin key for you (no separate `solenoid login` needed), but every spend key must still be re-derived with `solenoid key <scope>` and redeployed.')
        }
        throw new Error(`this revokes every key derived for "${scope}": every deployed copy will fail with invalid_key. keys derived separately for scopes under "${scope}" keep working. re-run with --yes to confirm; this command then prints a fresh key for "${scope}" to redeploy, so no separate \`solenoid key\` run is needed.`)
      }
      if (flags.admin) {
        const c = readCreds()
        const newAdminKey = await client(10_000).rotateAdmin().catch((e) => {
          if (!(e instanceof Outage)) throw e
          throw new Error('the rotation request failed before solenoid confirmed it, so it may have gone through. wait a minute, since the request may still be on its way, then check with `solenoid ls`. if it works, nothing changed: run `solenoid rotate --admin --yes` again. if it fails with invalid_key, the rotation went through. its new admin key was lost. if the account has a recovery email, `solenoid recover <email>` returns the current key. otherwise start a new account with `solenoid init --force`, which overwrites the saved admin key.')
        })
        process.stdout.write(`new admin key: ${newAdminKey}\n`)
        try {
          writeCreds({ ...c, admin_key: newAdminKey })
        } catch (e) {
          throw new Error(onlyCopy(c.api, e))
        }
        return [
          `it is saved at ${credsPath()}, and this CLI uses it from here on. back it up somewhere safe.`,
          'every previous key (admin and spend) now fails. re-derive each spend key with `solenoid key <scope>` and redeploy them.',
        ].join('\n')
      }
      const v = await client().rotate(scope)
      const key = await client().deriveKey(scope, v.epoch)
      return `every key derived for "${scope}" before now is revoked. new key: ${key}. redeploy it wherever the old one was used; no further \`solenoid key\` run is needed.`
    }
    case 'upgrade': {
      const tenant = tenantOf(readCreds().admin_key)
      let url: string
      try {
        ({ url } = await client(10_000).checkout())
      } catch (e) {
        if (e instanceof SolenoidError && e.code === 'already_pro') {
          return `account ${tenant} is already on Pro. manage or cancel the plan in the Stripe billing portal: ${e.detail.portal_url}`
        }
        if (e instanceof Outage) throw new Error('checkout could not start because solenoid or Stripe did not answer. nothing was charged. run `solenoid upgrade` again in a minute.')
        throw e
      }
      return [
        (await openUrl(url)) ? 'opening Stripe Checkout in your browser. if it does not open, go to:' : 'open this page in a browser to pay:',
        url,
        `this command exits now, so pay in your own time. once the payment goes through, account ${tenant} moves to Pro, and a 6-digit code goes to the email used at checkout. if no code arrives, run \`solenoid email <address>\` with that address to send a new one, then \`solenoid email <address> <code>\` with that address and the code to make it your recovery email.`,
      ].join('\n')
    }
    default: throw new Error(`unknown command "${cmd}"; run \`solenoid help\` to see the commands`)
  }
}
