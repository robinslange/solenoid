import type { Auth } from './auth'
import { GENESIS, entryHash, importSigningKey, signHash, type Kind, type Sealed } from './chain'
import { fail, ok, type Fail, type Result } from './errors'
import { fromMicro, toMicroUnits } from './amounts'
import { ancestors, childOn, lastSegment, parentOf, within } from './scope'
import { nextReset, perChild, windowStart, type Per } from './windows'
import { CODE_TTL_MS, DAY_MS, HOUR_MS, MAX_ATTACH_SENDS_PER_DAY, MAX_FAILS_PER_DAY, MAX_FAILS_PER_HOUR, MAX_LIVE_CODES, MAX_SENDS_PER_HOUR, hashCode, newCode, type Purpose } from './codes'

export const FREE_SPENDS = 100_000

export type Receipt = Sealed & { id: string; replay: boolean }
export type Remaining = Record<string, { scope: string; left: number; resets: string | null }>
export type Warning = { scope: string; unit: string; used: number; limit: number }
export type SpendOk = { receipt: Receipt; remaining: Remaining; on_outage: 'open' | 'closed'; warnings: Warning[] }
export type PutReq = { limits: Record<string, number | null>; per: Per; onOutage: 'open' | 'closed'; warnAt: number | null; rotateKeys: boolean; rotateAdmin: boolean }
export type LimitView = { scope: string; unit: string; limit: number; per: Per; on_outage: 'open' | 'closed'; warn_at: number | null; used: number | null; left: number | null; resets: string | null }
export type View = { scope: string; epoch: number; limits: LimitView[]; children: string[]; entries: Receipt[]; next: number | null }

export type Sql = { exec(query: string, ...params: unknown[]): { toArray(): Record<string, any>[] }; transactionSync<T>(fn: () => T): T }
export type TenantEnv = { SIGNING_KEY: string; SIGNING_KID: string; MASTER: string }
export type TenantApi = Pick<Tenant, 'init' | 'spend' | 'settle' | 'put' | 'get' | 'attachStart' | 'attachVerify' | 'recoverStart' | 'recoverFinish' | 'billing' | 'checkoutSaved' | 'billingStart' | 'duplicateSettled' | 'billingEnd' | 'meterDue' | 'meterCommit'>
export type MeterDue = { customer: string; identifier: string; value: number; to: number }
export type Billing = { plan: string; customer: string | null; subscription: string | null; checkout: string | null }
const CHECKOUT_REUSE_MS = 5 * 60_000
const CHECKOUT_KEYS = ['checkout_session', 'checkout_url', 'checkout_expires']

type LimitRow = { scope: string; unit: string; amount: number; per: Per; on_outage: 'open' | 'closed'; warn_at: number | null }
type EntryRow = { seq: number; kind: Kind; scope: string; body: string; at: string; kid: string; idem: string | null; body_hash: string | null; prev: string; hash: string; sig: string }
type Check = { limitScope: string; unit: string; counterScope: string; per: Per; amount: number; onOutage: 'open' | 'closed'; warnAt: number | null; windowStart: number; used: number }

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS limits (scope TEXT NOT NULL, unit TEXT NOT NULL, amount INTEGER NOT NULL, per TEXT, on_outage TEXT NOT NULL, warn_at REAL, PRIMARY KEY (scope, unit)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS counters (limit_scope TEXT NOT NULL, unit TEXT NOT NULL, scope TEXT NOT NULL, window_start INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (limit_scope, unit, scope)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, scope TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL, kid TEXT NOT NULL, idem TEXT, body_hash TEXT, prev TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS entries_idem ON entries (idem) WHERE idem IS NOT NULL',
  'CREATE TABLE IF NOT EXISTS scopes (parent TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (parent, name)) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS epochs (scope TEXT PRIMARY KEY, epoch INTEGER NOT NULL) WITHOUT ROWID',
  'CREATE TABLE IF NOT EXISTS codes (purpose TEXT NOT NULL, email TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS code_events (kind TEXT NOT NULL, purpose TEXT NOT NULL, email TEXT NOT NULL, at INTEGER NOT NULL)',
]

const PAGE = 50
const UNDER = `(? = '' OR scope = ? OR substr(scope, 1, ?) = ?)`
const under = (scope: string) => [scope, scope, scope.length + 1, `${scope}/`]

const iso = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString())
const own = (o: Record<string, number>, unit: string): number => (Object.hasOwn(o, unit) ? o[unit] : 0)

const toReceipt = (r: EntryRow, replay: boolean): Receipt => ({
  id: `rcp_${r.seq}`, seq: r.seq, kind: r.kind, scope: r.scope, body: JSON.parse(r.body), at: r.at, kid: r.kid, prev: r.prev, hash: r.hash, sig: r.sig, replay,
})

export class Tenant {
  #sql: Sql
  #env: TenantEnv
  #now: () => number
  #head: { seq: number; hash: string }
  #lock: Promise<unknown> = Promise.resolve()
  #signingKey: Promise<CryptoKey> | undefined

  constructor(sql: Sql, env: TenantEnv, now: () => number) {
    this.#sql = sql
    this.#env = env
    this.#now = now
    for (const statement of SCHEMA) this.#sql.exec(statement)
    this.#head = this.#rows<{ seq: number; hash: string }>('SELECT seq, hash FROM entries ORDER BY seq DESC LIMIT 1')[0] ?? { seq: 0, hash: GENESIS }
  }

  async init(tenant: string, plan: 'free' | 'pro' | 'internal'): Promise<boolean> {
    if (this.#meta('tenant')) return false
    this.#setMeta('tenant', tenant)
    this.#setMeta('gen', '1')
    this.#setMeta('plan', plan)
    return true
  }

  spend(auth: Auth, scope: string, amounts: Record<string, number>, idem: string, bodyHash: string): Promise<Result<SpendOk>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'spend')
      if (denied) return denied
      const now = this.#now()
      const prior = this.#rows<EntryRow>('SELECT * FROM entries WHERE idem = ?', idem)[0]
      if (prior) {
        if (prior.scope !== scope || prior.body_hash !== bodyHash) return fail(409, 'idempotency_conflict')
        return ok(this.#reply(prior, Object.keys(amounts), now, true))
      }
      this.#rollMonth(now)
      const planDenied = this.#checkPlan(now)
      if (planDenied) return planDenied
      const checks = this.#applicable(scope, Object.keys(amounts), now)
      for (const c of checks) {
        if (c.used + amounts[c.unit] > c.amount) {
          return fail(402, 'limit_exceeded', { scope: c.limitScope, unit: c.unit, limit: fromMicro(c.amount), used: fromMicro(c.used), requested: fromMicro(amounts[c.unit]), resets: iso(nextReset(c.per, now)) })
        }
      }
      const body = Object.fromEntries(Object.entries(amounts).map(([u, v]) => [u, fromMicro(v)]))
      const row = await this.#seal('spend', scope, body, now, idem, bodyHash)
      this.#sql.transactionSync(() => {
        for (const c of checks) this.#setCounter(c, c.used + amounts[c.unit])
        this.#touchScopes(scope)
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok(this.#reply(row, Object.keys(amounts), now, false))
    })
  }

  settle(auth: Auth, scope: string, idem: string, actual: Record<string, number>, bodyHash: string): Promise<Result<SpendOk>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'spend')
      if (denied) return denied
      const now = this.#now()
      const held = this.#rows<EntryRow>('SELECT * FROM entries WHERE idem = ?', idem)[0]
      if (!held || held.kind !== 'spend') return fail(404, 'unknown_spend')
      if (held.scope !== scope) return fail(409, 'idempotency_conflict')
      const heldUnits = JSON.parse(held.body) as Record<string, number>
      const units = Object.keys(heldUnits)
      const settleKey = `${idem}#settle`
      const done = this.#rows<EntryRow>('SELECT * FROM entries WHERE idem = ?', settleKey)[0]
      if (done) {
        if (done.scope !== scope || done.body_hash !== bodyHash) return fail(409, 'idempotency_conflict')
        return ok(this.#reply(done, units, now, true))
      }
      for (const unit of units) if (!Object.hasOwn(actual, unit)) return fail(400, 'invalid_unit', { unit })
      for (const unit of Object.keys(actual)) if (!Object.hasOwn(heldUnits, unit)) return fail(400, 'invalid_unit', { unit })
      const delta = Object.fromEntries(units.map((unit) => [unit, (actual[unit] ?? 0) - toMicroUnits(heldUnits[unit] ?? 0)]))
      this.#rollMonth(now)
      const heldAt = Date.parse(held.at)
      const checks = this.#applicable(scope, units, now).filter((c) => c.windowStart === windowStart(c.per, heldAt))
      const body = { ref: held.seq, held: heldUnits, actual: Object.fromEntries(Object.entries(actual).map(([u, v]) => [u, fromMicro(v)])) }
      const row = await this.#seal('settle', scope, body, now, settleKey, bodyHash)
      this.#sql.transactionSync(() => {
        for (const c of checks) this.#setCounter(c, c.used + delta[c.unit])
        this.#bumpNonspend()
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok(this.#reply(row, units, now, false))
    })
  }

  put(auth: Auth, scope: string, req: PutReq): Promise<Result<View & { gen: number }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, scope, 'admin')
      if (denied) return denied
      if (req.rotateAdmin && scope !== '') return fail(400, 'invalid_limit', { reason: 'rotate_admin is only allowed on the root scope' })
      if (Object.hasOwn(req.limits, 'spends')) return fail(403, 'plan_owned')
      const now = this.#now()
      this.#rollMonth(now)
      const fills = Object.entries(req.limits).filter(([, v]) => v !== null).map(([unit]) => ({ unit, ...this.#backfill(scope, unit, req.per, now) }))
      const body = {
        limits: Object.fromEntries(Object.entries(req.limits).map(([k, v]) => [k, v === null ? null : fromMicro(v)])),
        per: req.per, on_outage: req.onOutage, warn_at: req.warnAt ?? undefined,
        rotate_keys: req.rotateKeys || undefined, rotate_admin: req.rotateAdmin || undefined,
      }
      const row = await this.#seal(req.rotateKeys || req.rotateAdmin ? 'rotate' : 'limit', scope, body, now, null, null)
      this.#sql.transactionSync(() => {
        for (const [unit, v] of Object.entries(req.limits)) {
          this.#sql.exec('DELETE FROM counters WHERE limit_scope = ? AND unit = ?', scope, unit)
          if (v === null) this.#sql.exec('DELETE FROM limits WHERE scope = ? AND unit = ?', scope, unit)
          else this.#sql.exec(
            'INSERT INTO limits (scope, unit, amount, per, on_outage, warn_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (scope, unit) DO UPDATE SET amount = excluded.amount, per = excluded.per, on_outage = excluded.on_outage, warn_at = excluded.warn_at',
            scope, unit, v, req.per, req.onOutage, req.warnAt,
          )
        }
        for (const f of fills) for (const [counterScope, used] of f.sums) {
          this.#sql.exec('INSERT INTO counters (limit_scope, unit, scope, window_start, used) VALUES (?, ?, ?, ?, ?)', scope, f.unit, counterScope, f.windowStart, used)
        }
        if (req.rotateKeys) this.#sql.exec('INSERT INTO epochs (scope, epoch) VALUES (?, 1) ON CONFLICT (scope) DO UPDATE SET epoch = epoch + 1', scope)
        if (req.rotateAdmin) this.#setMeta('gen', String(Number(this.#meta('gen')) + 1))
        this.#bumpNonspend()
        this.#touchScopes(scope)
        this.#writeEntry(row)
      })
      this.#head = { seq: row.seq, hash: row.hash }
      return ok({ ...this.#view(scope, now, undefined), gen: Number(this.#meta('gen')) })
    })
  }

  async get(auth: Auth, scope: string, before?: number): Promise<Result<View>> {
    const denied = this.#authorize(auth, scope, 'read')
    if (denied) return denied
    return ok(this.#view(scope, this.#now(), before))
  }

  attachStart(auth: Auth, email: string): Promise<Result<{ code: string }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, '', 'admin')
      if (denied) return denied
      const now = this.#now()
      const throttled = this.#countSend('attach', email, now)
      if (throttled) return throttled
      return ok({ code: await this.#storeCode('attach', email, now) })
    })
  }

  attachVerify(auth: Auth, email: string, code: string, rotate: boolean): Promise<Result<{ email: string; previous: string | null; gen: number }>> {
    return this.#serial(async () => {
      const denied = this.#authorize(auth, '', 'admin')
      if (denied) return denied
      const now = this.#now()
      if (!(await this.#redeem('attach', email, code, now))) return fail(400, 'invalid_code')
      const prior = this.#meta('recovery_email')
      if (rotate) {
        this.#rollMonth(now)
        const row = await this.#seal('rotate', '', { rotate_admin: true, attach: true }, now, null, null)
        this.#sql.transactionSync(() => {
          this.#setMeta('recovery_email', email)
          this.#setMeta('gen', String(Number(this.#meta('gen')) + 1))
          this.#bumpNonspend()
          this.#writeEntry(row)
        })
        this.#head = { seq: row.seq, hash: row.hash }
      } else {
        this.#setMeta('recovery_email', email)
      }
      return ok({ email, previous: prior && prior !== email ? prior : null, gen: Number(this.#meta('gen')) })
    })
  }

  recoverStart(email: string): Promise<Result<{ code: string | null }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant')) return ok({ code: null })
      const now = this.#now()
      const throttled = this.#countSend('recover', email, now)
      if (throttled) return throttled
      if (this.#meta('recovery_email') !== email) {
        await hashCode(this.#env.MASTER, 'recover', email, newCode())
        return ok({ code: null })
      }
      return ok({ code: await this.#storeCode('recover', email, now) })
    })
  }

  recoverFinish(email: string, code: string, rotate: boolean): Promise<Result<{ gen: number }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant') || this.#meta('recovery_email') !== email) {
        await hashCode(this.#env.MASTER, 'recover', email, code)
        return fail(400, 'invalid_code')
      }
      const now = this.#now()
      if (!(await this.#redeem('recover', email, code, now))) return fail(400, 'invalid_code')
      if (rotate) {
        this.#rollMonth(now)
        const row = await this.#seal('rotate', '', { rotate_admin: true, recovery: true }, now, null, null)
        this.#sql.transactionSync(() => {
          this.#setMeta('gen', String(Number(this.#meta('gen')) + 1))
          this.#bumpNonspend()
          this.#writeEntry(row)
        })
        this.#head = { seq: row.seq, hash: row.hash }
      }
      return ok({ gen: Number(this.#meta('gen')) })
    })
  }

  async billing(auth: Auth): Promise<Result<Billing>> {
    const denied = this.#authorize(auth, '', 'admin')
    if (denied) return denied
    const open = Number(this.#meta('checkout_expires')) - this.#now() > CHECKOUT_REUSE_MS
    return ok({ plan: this.#meta('plan')!, customer: this.#meta('stripe_customer') ?? null, subscription: this.#meta('stripe_subscription') ?? null, checkout: open ? this.#meta('checkout_url')! : null })
  }

  checkoutSaved(session: string, url: string, expires: number): Promise<Result<null>> {
    return this.#serial(async () => {
      this.#sql.transactionSync(() => {
        this.#setMeta('checkout_session', session)
        this.#setMeta('checkout_url', url)
        this.#setMeta('checkout_expires', String(expires))
      })
      return ok(null)
    })
  }

  billingStart(customer: string, subscription: string, session: string): Promise<Result<{ started: boolean; duplicate: boolean }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant')) return ok({ started: false, duplicate: false })
      if (this.#meta('checkout_session') === session) for (const k of CHECKOUT_KEYS) this.#deleteMeta(k)
      if (this.#meta('stripe_subscription') === subscription || this.#meta(`duplicate:${subscription}`)) return ok({ started: false, duplicate: false })
      if (this.#meta('plan') === 'pro') return ok({ started: false, duplicate: true })
      if (this.#meta(`ended:${subscription}`)) return ok({ started: false, duplicate: false })
      this.#sql.transactionSync(() => {
        this.#setMeta('plan', 'pro')
        this.#setMeta('stripe_customer', customer)
        this.#setMeta('stripe_subscription', subscription)
        this.#setMeta('meter_seq', String(this.#head.seq))
        this.#deleteMeta('meter_to')
        this.#setMeta('next_meter', String(this.#now() + DAY_MS))
      })
      return ok({ started: true, duplicate: false })
    })
  }

  duplicateSettled(subscription: string): Promise<Result<null>> {
    return this.#serial(async () => {
      this.#setMeta(`duplicate:${subscription}`, 'cancelled')
      return ok(null)
    })
  }

  billingEnd(subscription: string): Promise<Result<{ ended: boolean }>> {
    return this.#serial(async () => {
      if (!this.#meta('tenant')) return ok({ ended: false })
      this.#setMeta(`ended:${subscription}`, '1')
      if (this.#meta('plan') !== 'pro' || this.#meta('stripe_subscription') !== subscription) return ok({ ended: false })
      this.#sql.transactionSync(() => {
        this.#setMeta('plan', 'free')
        this.#deleteMeta('next_meter')
        this.#deleteMeta('meter_to')
      })
      return ok({ ended: true })
    })
  }

  meterDue(): Promise<Result<MeterDue | null>> {
    return this.#serial(async () => {
      if (this.#meta('plan') !== 'pro') return ok(null)
      const from = Number(this.#meta('meter_seq'))
      const to = Number(this.#meta('meter_to') ?? this.#head.seq)
      this.#setMeta('meter_to', String(to))
      const value = this.#count("SELECT count(*) AS n FROM entries WHERE kind = 'spend' AND seq > ? AND seq <= ?", from, to)
      return ok({ customer: this.#meta('stripe_customer')!, identifier: `${this.#meta('tenant')}:${from}-${to}`, value, to })
    })
  }

  meterCommit(to: number): Promise<Result<null>> {
    return this.#serial(async () => {
      if (to > Number(this.#meta('meter_seq'))) this.#setMeta('meter_seq', String(to))
      if (this.#meta('meter_to') === String(to)) this.#deleteMeta('meter_to')
      return ok(null)
    })
  }

  meterIsDue(): boolean {
    return Number(this.#meta('next_meter')) <= this.#now()
  }

  scheduleMeter(sent: boolean): void {
    if (this.#meta('plan') !== 'pro') return this.#deleteMeta('next_meter')
    this.#setMeta('next_meter', String(this.#now() + (sent ? DAY_MS : HOUR_MS)))
  }

  #backfill(scope: string, unit: string, per: Per, now: number): { windowStart: number; sums: Map<string, number> } {
    const ws = windowStart(per, now)
    const wsIso = new Date(ws).toISOString()
    const rows = this.#rows<{ kind: Kind; scope: string; body: string }>(
      `SELECT s.kind AS kind, s.scope AS scope, s.body AS body FROM entries s
       LEFT JOIN entries h ON h.seq = json_extract(s.body, '$.ref')
       WHERE s.kind IN ('spend', 'settle')
       AND ((s.kind = 'spend' AND s.at >= ?) OR (s.kind = 'settle' AND h.at >= ?))
       AND (? = '' OR s.scope = ? OR substr(s.scope, 1, ?) = ?)`,
      wsIso, wsIso, ...under(scope),
    )
    const sums = new Map<string, number>()
    for (const r of rows) {
      const b = JSON.parse(r.body)
      const vMicro = r.kind === 'spend' ? toMicroUnits(own(b, unit)) : toMicroUnits(own(b.actual, unit)) - toMicroUnits(own(b.held, unit))
      const counterScope = perChild(per) ? childOn(scope, r.scope) : scope
      if (vMicro === 0 || counterScope === null) continue
      sums.set(counterScope, (sums.get(counterScope) ?? 0) + vMicro)
    }
    return { windowStart: ws, sums }
  }

  #view(scope: string, now: number, before: number | undefined): View {
    const applied: LimitView[] = this.#applicable(scope, null, now).map((c) => ({
      scope: c.limitScope, unit: c.unit, limit: fromMicro(c.amount), per: c.per, on_outage: c.onOutage, warn_at: c.warnAt,
      used: fromMicro(c.used), left: fromMicro(c.amount - c.used), resets: iso(nextReset(c.per, now)),
    }))
    const own: LimitView[] = this.#rows<LimitRow>("SELECT * FROM limits WHERE scope = ? AND per IN ('child', 'child-day')", scope).map((l) => ({
      scope: l.scope, unit: l.unit, limit: fromMicro(l.amount), per: l.per, on_outage: l.on_outage, warn_at: l.warn_at, used: null, left: null, resets: null,
    }))
    const children = this.#rows<{ name: string }>('SELECT name FROM scopes WHERE parent = ? ORDER BY name', scope).map((r) => r.name)
    const rows = this.#rows<EntryRow>(
      `SELECT * FROM entries WHERE seq < ? AND ${UNDER} ORDER BY seq DESC LIMIT ?`, before ?? Number.MAX_SAFE_INTEGER, ...under(scope), PAGE + 1,
    )
    const page = rows.slice(0, PAGE)
    return { scope, epoch: this.#epochOf(scope), limits: [...applied, ...own], children, entries: page.map((r) => toReceipt(r, false)), next: rows.length > PAGE ? page[PAGE - 1].seq : null }
  }

  #rows<T>(query: string, ...params: unknown[]): T[] {
    return this.#sql.exec(query, ...params).toArray() as T[]
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lock.then(fn, fn)
    this.#lock = run.catch(() => undefined)
    return run
  }

  #meta(k: string): string | undefined {
    return this.#rows<{ v: string }>('SELECT v FROM meta WHERE k = ?', k)[0]?.v
  }

  #count(query: string, ...params: unknown[]): number {
    return this.#rows<{ n: number }>(query, ...params)[0].n
  }

  #prune(now: number): void {
    this.#sql.exec('DELETE FROM code_events WHERE at <= ?', now - DAY_MS)
    this.#sql.exec('DELETE FROM codes WHERE expires <= ?', now)
  }

  nextDue(): number | null {
    const due = ['next_prune', 'next_meter'].map((k) => this.#meta(k)).filter((v) => v !== undefined).map(Number)
    return due.length ? Math.min(...due) : null
  }

  pruneIfDue(): void {
    const now = this.#now()
    if (!(Number(this.#meta('next_prune')) <= now)) return
    this.#prune(now)
    this.#reschedulePrune()
  }

  schedulePrune(): boolean {
    if (this.#meta('next_prune') !== undefined) return false
    this.#reschedulePrune()
    return this.#meta('next_prune') !== undefined
  }

  #reschedulePrune(): void {
    const next = this.#rows<{ t: number | null }>('SELECT min(t) AS t FROM (SELECT min(expires) AS t FROM codes UNION ALL SELECT min(at) + ? AS t FROM code_events)', DAY_MS)[0].t
    if (next === null) this.#deleteMeta('next_prune')
    else this.#setMeta('next_prune', String(next))
  }

  #codeRowWritten(now: number): void {
    if (this.#meta('next_prune') === undefined) this.#setMeta('next_prune', String(now + DAY_MS))
  }

  #deleteMeta(k: string): void {
    this.#sql.exec('DELETE FROM meta WHERE k = ?', k)
  }

  #countSend(purpose: Purpose, email: string, now: number): Fail | null {
    this.#prune(now)
    if (this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'send' AND email = ? AND at > ?", email, now - HOUR_MS) >= MAX_SENDS_PER_HOUR) return fail(429, 'rate_limited')
    if (purpose === 'attach' && this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'send' AND purpose = 'attach' AND at > ?", now - DAY_MS) >= MAX_ATTACH_SENDS_PER_DAY) return fail(429, 'rate_limited')
    this.#sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('send', ?, ?, ?)", purpose, email, now)
    this.#codeRowWritten(now)
    return null
  }

  async #storeCode(purpose: Purpose, email: string, now: number): Promise<string> {
    const code = newCode()
    this.#sql.exec('INSERT INTO codes (purpose, email, hash, expires) VALUES (?, ?, ?, ?)', purpose, email, await hashCode(this.#env.MASTER, purpose, email, code), now + CODE_TTL_MS)
    this.#codeRowWritten(now)
    this.#sql.exec(
      'DELETE FROM codes WHERE purpose = ? AND email = ? AND rowid NOT IN (SELECT rowid FROM codes WHERE purpose = ? AND email = ? ORDER BY rowid DESC LIMIT ?)',
      purpose, email, purpose, email, MAX_LIVE_CODES,
    )
    return code
  }

  async #redeem(purpose: Purpose, email: string, code: string, now: number): Promise<boolean> {
    this.#prune(now)
    const fails = (since: number) => this.#count("SELECT count(*) AS n FROM code_events WHERE kind = 'fail' AND purpose = ? AND email = ? AND at > ?", purpose, email, since)
    const weight = Math.max(1, this.#count('SELECT count(*) AS n FROM codes WHERE purpose = ? AND email = ?', purpose, email))
    if (fails(now - HOUR_MS) + weight > MAX_FAILS_PER_HOUR || fails(now - DAY_MS) + weight > MAX_FAILS_PER_DAY) return false
    const hash = await hashCode(this.#env.MASTER, purpose, email, code)
    const hit = this.#rows<{ id: number }>('SELECT rowid AS id FROM codes WHERE purpose = ? AND email = ? AND hash = ? AND expires > ?', purpose, email, hash, now)[0]
    if (hit) {
      this.#sql.exec('DELETE FROM codes WHERE rowid = ?', hit.id)
      return true
    }
    for (let i = 0; i < weight; i++) this.#sql.exec("INSERT INTO code_events (kind, purpose, email, at) VALUES ('fail', ?, ?, ?)", purpose, email, now)
    this.#codeRowWritten(now)
    return false
  }

  #setMeta(k: string, v: string): void {
    this.#sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, v)
  }

  #epochOf(scope: string): number {
    return this.#rows<{ epoch: number }>('SELECT epoch FROM epochs WHERE scope = ?', scope)[0]?.epoch ?? 0
  }

  #authorize(auth: Auth, scope: string, need: 'spend' | 'read' | 'admin'): Fail | null {
    if (!this.#meta('tenant')) return fail(401, 'invalid_key')
    if (auth.kind === 'internal') return null
    if (String(auth.gen) !== this.#meta('gen')) return fail(401, 'invalid_key')
    if (auth.kind === 'admin') return null
    if (need === 'admin') return fail(403, 'admin_required')
    if (auth.epoch !== this.#epochOf(auth.keyScope)) return fail(401, 'invalid_key')
    if (!within(scope, auth.keyScope)) return fail(403, 'out_of_scope', { scope, key_scope: auth.keyScope })
    return null
  }

  #rollMonth(now: number): void {
    const month = new Date(now).toISOString().slice(0, 7)
    if (this.#meta('month') === month) return
    this.#setMeta('month', month)
    this.#setMeta('seq_month_start', String(this.#head.seq))
    this.#setMeta('nonspend_month', '0')
  }

  #bumpNonspend(): void {
    this.#setMeta('nonspend_month', String(Number(this.#meta('nonspend_month')) + 1))
  }

  #checkPlan(now: number): Fail | null {
    if (this.#meta('plan') !== 'free') return null
    const used = this.#head.seq - Number(this.#meta('seq_month_start')) - Number(this.#meta('nonspend_month'))
    if (used < FREE_SPENDS) return null
    return fail(402, 'limit_exceeded', { scope: '', unit: 'spends', limit: FREE_SPENDS, used, requested: 1, resets: iso(nextReset('month', now)) })
  }

  #applicable(scope: string, units: string[] | null, now: number): Check[] {
    const anc = ancestors(scope)
    const rows = this.#rows<LimitRow>(`SELECT * FROM limits WHERE scope IN (${anc.map(() => '?').join(',')})`, ...anc)
    const out: Check[] = []
    for (const lim of rows) {
      if (units && !units.includes(lim.unit)) continue
      const counterScope = perChild(lim.per) ? childOn(lim.scope, scope) : lim.scope
      if (counterScope === null) continue
      const ws = windowStart(lim.per, now)
      const c = this.#rows<{ window_start: number; used: number }>(
        'SELECT window_start, used FROM counters WHERE limit_scope = ? AND unit = ? AND scope = ?', lim.scope, lim.unit, counterScope,
      )[0]
      out.push({ limitScope: lim.scope, unit: lim.unit, counterScope, per: lim.per, amount: lim.amount, onOutage: lim.on_outage, warnAt: lim.warn_at, windowStart: ws, used: c && c.window_start === ws ? c.used : 0 })
    }
    return out
  }

  #setCounter(c: Check, used: number): void {
    this.#sql.exec(
      'INSERT INTO counters (limit_scope, unit, scope, window_start, used) VALUES (?, ?, ?, ?, ?) ON CONFLICT (limit_scope, unit, scope) DO UPDATE SET window_start = excluded.window_start, used = excluded.used',
      c.limitScope, c.unit, c.counterScope, c.windowStart, used,
    )
  }

  #reply(row: EntryRow, units: string[], now: number, replay: boolean): SpendOk {
    const checks = this.#applicable(row.scope, units, now)
    const best = new Map<string, Check & { left: number }>()
    for (const c of checks) {
      const left = c.amount - c.used
      if (!best.has(c.unit) || left < best.get(c.unit)!.left) best.set(c.unit, { ...c, left })
    }
    return {
      receipt: toReceipt(row, replay),
      remaining: Object.fromEntries([...best.values()].map((b) => [b.unit, { scope: b.limitScope, left: fromMicro(b.left), resets: iso(nextReset(b.per, now)) }])),
      on_outage: checks.length > 0 && checks.every((c) => c.onOutage === 'open') ? 'open' : 'closed',
      warnings: checks.filter((c) => c.warnAt !== null && c.used >= c.warnAt * c.amount - 1e-6).map((c) => ({ scope: c.limitScope, unit: c.unit, used: fromMicro(c.used), limit: fromMicro(c.amount) })),
    }
  }

  async #seal(kind: Kind, scope: string, body: Record<string, any>, now: number, idem: string | null, bodyHash: string | null): Promise<EntryRow> {
    const e = { seq: this.#head.seq + 1, kind, scope, body, at: new Date(now).toISOString(), kid: this.#env.SIGNING_KID }
    const hash = await entryHash(this.#head.hash, e)
    this.#signingKey ??= importSigningKey(this.#env.SIGNING_KEY)
    const sig = await signHash(await this.#signingKey, hash)
    return { ...e, body: JSON.stringify(body), idem, body_hash: bodyHash, prev: this.#head.hash, hash, sig }
  }

  #writeEntry(r: EntryRow): void {
    this.#sql.exec(
      'INSERT INTO entries (seq, kind, scope, body, at, kid, idem, body_hash, prev, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.seq, r.kind, r.scope, r.body, r.at, r.kid, r.idem, r.body_hash, r.prev, r.hash, r.sig,
    )
  }

  #touchScopes(scope: string): void {
    for (const s of ancestors(scope)) if (s !== '') this.#sql.exec('INSERT OR IGNORE INTO scopes (parent, name) VALUES (?, ?)', parentOf(s), lastSegment(s))
  }
}
