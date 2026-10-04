import { describe, expect, it } from 'vitest'
import { formatError } from '../src/commands'

const OUTAGE_NEXT = (s: string) =>
  `retry once solenoid is reachable. to let spends at "${s}" through a later outage, every limit that applies there, including those on parent scopes, must fail open. ` +
  `once solenoid is reachable (solenoid limit needs it too), run \`solenoid ls ${s}\`, and for each limit it lists run ` +
  '`solenoid limit <its scope> <unit>=<its limit> --per <its per> --warn-at <its warn-at> --on-outage open`, leaving out --per for a lifetime limit ' +
  'and --warn-at for a limit with none, because the command replaces the whole limit. the next spend that reaches solenoid then records the new mode in your outage cache.'

describe('formatError', () => {
  it('prefixes a plain CLI error once', () => {
    expect(formatError(new Error('already initialised; use --force to create another account')))
      .toBe('solenoid: already initialised; use --force to create another account')
  })

  it('does not double the prefix on a message that already starts with "solenoid:"', () => {
    expect(formatError(new TypeError('solenoid: invalid scope "acme/.."')))
      .toBe(
        'solenoid: invalid scope "acme/..". a scope is up to 8 segments separated by "/", each 1 to 64 characters ' +
        'of lowercase a-z, 0-9, . _ -, and not made only of dots.',
      )
  })

  it('does not double the prefix on a message that already starts with "solenoid "', () => {
    const msg = 'solenoid was unreachable; this scope fails closed, so the spend was refused. retry once solenoid is reachable, ' +
      'or make the relevant limit fail open (on_outage is set per limit, not per scope): solenoid limit acme <unit>=<n> --on-outage open'
    expect(formatError(new Error(msg))).toBe(msg)
  })

  it('adds a next step and the resets time to a limit_exceeded error', () => {
    const e = Object.assign(new Error('solenoid: limit_exceeded (402)'), {
      code: 'limit_exceeded',
      detail: { scope: 'acme', unit: 'emails', used: 2, limit: 2, resets: '2026-09-25T00:00:00.000Z' },
    })
    expect(formatError(e)).toBe(
      'solenoid: limit_exceeded (402). the limit on "acme" for "emails" is reached (used 2 of 2); it resets at 2026-09-25T00:00:00.000Z. ' +
      'raise it with `solenoid limit acme emails=<n>`, or remove it with `solenoid limit acme emails=off`.',
    )
  })

  it('says a limit with no resets has no window', () => {
    const e = Object.assign(new Error('solenoid: limit_exceeded (402)'), {
      code: 'limit_exceeded',
      detail: { scope: 'acme/oneoff', unit: 'sends', used: 1, limit: 1, resets: null },
    })
    expect(formatError(e)).toBe(
      'solenoid: limit_exceeded (402). the limit on "acme/oneoff" for "sends" is reached (used 1 of 1); ' +
      'it has no window, so only raising it or removing it helps. ' +
      'raise it with `solenoid limit acme/oneoff sends=<n>`, or remove it with `solenoid limit acme/oneoff sends=off`.',
    )
  })

  it('tells admin and spend keys apart for invalid_key, and splits the spend-key case into its two distinct causes', () => {
    const e = Object.assign(new Error('solenoid: invalid_key (401)'), { code: 'invalid_key' })
    expect(formatError(e)).toBe(
      'solenoid: invalid_key (401). this admin key (it starts sk.admin.) is invalid or was rotated elsewhere; ' +
      'run `solenoid login <admin-key>` with the current one. `solenoid key <scope>` cannot fix this, because deriving a key ' +
      'also needs a working admin key. a deployed spend key (starts sk.spend.) failing the same way has two possible causes. ' +
      'if its own scope was rotated, the admin key still works: derive a fresh one with `solenoid key <scope>` and redeploy it. ' +
      'if the admin key itself was rotated, every spend key now fails: log in with the current admin key first ' +
      '(`solenoid login <admin-key>`), then re-derive and redeploy. if the admin key is lost, `solenoid recover <email>` gets it back when the account has a recovery email.',
    )
  })

  it('names the scopes for out_of_scope', () => {
    const e = Object.assign(new Error('solenoid: out_of_scope (403)'), {
      code: 'out_of_scope',
      detail: { scope: 'acme/bot', key_scope: 'other' },
    })
    expect(formatError(e)).toBe(
      'solenoid: out_of_scope (403). the key only covers "other" and scopes under it, not "acme/bot". ' +
      'use a key derived for "acme/bot" or an ancestor of it.',
    )
  })

  it('gives a next step for idempotency_conflict', () => {
    const e = Object.assign(new Error('solenoid: idempotency_conflict (409)'), { code: 'idempotency_conflict', detail: {} })
    expect(formatError(e)).toBe(
      'solenoid: idempotency_conflict (409). a different spend already used this request id with a different scope or amounts. ' +
      'check whether the earlier one went through with `solenoid log <scope>`, then retry with a fresh request.',
    )
  })

  it('names the bad unit for invalid_unit', () => {
    const e = Object.assign(new Error('solenoid: invalid_unit (400)'), { code: 'invalid_unit', detail: { unit: 'Spend$' } })
    expect(formatError(e)).toBe(
      'solenoid: invalid_unit (400). "Spend$" is not a valid unit name. a unit is lowercase, starts with a letter, ' +
      'and matches [a-z][a-z0-9_]{0,31} ("spends" is reserved).',
    )
  })

  it('gives the valid form for invalid_amount, with no unit to name', () => {
    const e = Object.assign(new Error('solenoid: invalid_amount (400)'), { code: 'invalid_amount', detail: {} })
    expect(formatError(e)).toBe('solenoid: invalid_amount (400). an amount must be a positive number (a settle may use zero). check the amount you gave.')
  })

  it('names the bad field for invalid_limit, one message per field', () => {
    const per = Object.assign(new Error('solenoid: invalid_limit (400)'), { code: 'invalid_limit', detail: { field: 'per' } })
    const onOutage = Object.assign(new Error('solenoid: invalid_limit (400)'), { code: 'invalid_limit', detail: { field: 'on_outage' } })
    const warnAt = Object.assign(new Error('solenoid: invalid_limit (400)'), { code: 'invalid_limit', detail: { field: 'warn_at' } })
    const unitValue = Object.assign(new Error('solenoid: invalid_limit (400)'), { code: 'invalid_limit', detail: { field: 'emails' } })
    const bare = Object.assign(new Error('solenoid: invalid_limit (400)'), { code: 'invalid_limit', detail: {} })
    expect(formatError(per)).toBe('solenoid: invalid_limit (400). "--per" must be one of hour, day, week, month, child, child-day.')
    expect(formatError(onOutage)).toBe('solenoid: invalid_limit (400). "--on-outage" must be open or closed.')
    expect(formatError(warnAt)).toBe('solenoid: invalid_limit (400). "--warn-at" must be a fraction greater than 0 and up to 1.')
    expect(formatError(unitValue)).toBe('solenoid: invalid_limit (400). the value for "emails" must be a number, or "off" to remove it.')
    expect(formatError(bare)).toBe('solenoid: invalid_limit (400). give at least one <unit>=<n|off> pair, or a rotate flag.')
  })

  it('adds a runnable command, with the real scope, to the raw SolenoidUnavailable message from a non-spend command', () => {
    const e = Object.assign(new Error('solenoid is unreachable and the limits on "acme" fail closed'), { scope: 'acme' })
    expect(formatError(e)).toBe(`solenoid is unreachable and the limits on "acme" fail closed. ${OUTAGE_NEXT('acme')}`)
  })

  it('uses a <scope> placeholder when an unreachable error names no scope', () => {
    expect(formatError(new Error('solenoid is unreachable and the limits on "" fail closed'))).toBe(
      `solenoid is unreachable and the limits on "" fail closed. ${OUTAGE_NEXT('<scope>')}`,
    )
    expect(formatError(Object.assign(new Error('solenoid is unreachable and the limits on "" fail closed'), { scope: '' }))).toBe(
      `solenoid is unreachable and the limits on "" fail closed. ${OUTAGE_NEXT('/')}`,
    )
  })

  it('adds the outage and scope-grammar next steps only when the message starts with them', () => {
    expect(formatError(new Error('proxy: solenoid is unreachable'))).toBe('solenoid: proxy: solenoid is unreachable')
    expect(formatError(new Error('proxy said solenoid: invalid scope "x"'))).toBe('solenoid: proxy said solenoid: invalid scope "x"')
  })

  it('adds no next step to a coded error whose message looks like an outage or a bad scope', () => {
    const outage = Object.assign(new Error('solenoid is unreachable'), { code: 'some_new_code', scope: 'acme' })
    const scope = Object.assign(new Error('solenoid: invalid scope "x"'), { code: 'invalid_scope' })
    expect(formatError(outage)).toBe('solenoid is unreachable')
    expect(formatError(scope)).toBe('solenoid: invalid scope "x"')
  })

  it('leaves an unmapped code as the base message', () => {
    const e = Object.assign(new Error('solenoid: some_new_code (500)'), { code: 'some_new_code' })
    expect(formatError(e)).toBe('solenoid: some_new_code (500)')
  })

  it.each([
    ['invalid_code', 400, 'the code is wrong, used, expired, or replaced by a newer one. if you mistyped it, try it again. ask for a new one, by running the same command without the code, only if it expired or was used: ' +
      'a wrong try counts once for each live code, so every extra code makes the next check count more. after several wrong tries, code checks for this address pause: ' +
      'wait up to 15 minutes for older codes to expire, or for the hour or day to pass, then try again. asking for a code uses one of the address\'s 5 requests an hour.'],
    ['invalid_email', 400, 'that is not an address solenoid can send to. check it for typos.'],
    ['email_failed', 502, 'solenoid could not send the email, so no recovery email was attached. try again in a minute; each try counts toward the address\'s 5 codes an hour.'],
  ])('adds the next step to %s', (code, status, next) => {
    const e = Object.assign(new Error(`solenoid: ${code} (${status})`), { code })
    expect(formatError(e)).toBe(`solenoid: ${code} (${status}). ${next}`)
  })

  it.each([
    ['init', 'signups from one network are limited per day. wait up to a day, then try again.'],
    ['email', 'an address gets at most 5 codes an hour, and an account at most 10 attach codes a day. wait an hour, or a day if this account has sent 10 today, then try again.'],
    ['recover', 'recovery requests from one network are limited per day. wait up to a day, then try again.'],
  ])('names the limit %s can hit for rate_limited', (cmd, next) => {
    const e = Object.assign(new Error('solenoid: rate_limited (429)'), { code: 'rate_limited' })
    expect(formatError(e, cmd)).toBe(`solenoid: rate_limited (429). ${next}`)
  })

  it('adds no rate_limited next step for a command that cannot hit one', () => {
    const e = Object.assign(new Error('solenoid: rate_limited (429)'), { code: 'rate_limited' })
    expect(formatError(e, 'ls')).toBe('solenoid: rate_limited (429)')
    expect(formatError(e)).toBe('solenoid: rate_limited (429)')
  })
})
