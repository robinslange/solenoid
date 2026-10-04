import { DurableObject } from 'cloudflare:workers'
import { Tenant } from './core'
import { billingConfig, reportUsage, stripeClient } from './stripe'

export type { PutReq, SpendOk, View } from './core'

export class TenantDO extends DurableObject<Cloudflare.Env> {
  now: () => number = () => Date.now()
  alarmAt: (due: number) => number = (due) => due
  stripeFetch: typeof fetch = (input, init) => fetch(input, init)
  #tenant: Tenant

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    const sql = { exec: (q: string, ...p: unknown[]) => ctx.storage.sql.exec(q, ...(p as SqlStorageValue[])), transactionSync: <T>(fn: () => T) => ctx.storage.transactionSync(fn) }
    this.#tenant = new Tenant(sql, env, () => this.now())
    void ctx.blockConcurrencyWhile(async () => {
      if (this.#tenant.schedulePrune() || (await ctx.storage.getAlarm()) === null) await this.#arm()
    })
  }

  init(...a: Parameters<Tenant['init']>) { return this.#tenant.init(...a) }
  spend(...a: Parameters<Tenant['spend']>) { return this.#tenant.spend(...a) }
  settle(...a: Parameters<Tenant['settle']>) { return this.#tenant.settle(...a) }
  put(...a: Parameters<Tenant['put']>) { return this.#tenant.put(...a) }
  get(...a: Parameters<Tenant['get']>) { return this.#tenant.get(...a) }
  attachStart(...a: Parameters<Tenant['attachStart']>) { return this.#armed(this.#tenant.attachStart(...a)) }
  attachVerify(...a: Parameters<Tenant['attachVerify']>) { return this.#armed(this.#tenant.attachVerify(...a)) }
  recoverStart(...a: Parameters<Tenant['recoverStart']>) { return this.#armed(this.#tenant.recoverStart(...a)) }
  recoverFinish(...a: Parameters<Tenant['recoverFinish']>) { return this.#armed(this.#tenant.recoverFinish(...a)) }
  billing(...a: Parameters<Tenant['billing']>) { return this.#tenant.billing(...a) }
  checkoutSaved(...a: Parameters<Tenant['checkoutSaved']>) { return this.#tenant.checkoutSaved(...a) }
  billingStart(...a: Parameters<Tenant['billingStart']>) { return this.#armed(this.#tenant.billingStart(...a)) }
  duplicateSettled(...a: Parameters<Tenant['duplicateSettled']>) { return this.#tenant.duplicateSettled(...a) }
  billingEnd(...a: Parameters<Tenant['billingEnd']>) { return this.#armed(this.#tenant.billingEnd(...a)) }
  meterDue(...a: Parameters<Tenant['meterDue']>) { return this.#tenant.meterDue(...a) }
  meterCommit(...a: Parameters<Tenant['meterCommit']>) { return this.#tenant.meterCommit(...a) }

  async alarm(): Promise<void> {
    this.#tenant.pruneIfDue()
    if (this.#tenant.meterIsDue()) {
      const cfg = billingConfig(this.env)
      let sent = false
      try {
        if (cfg) {
          await reportUsage(this.#tenant, stripeClient(cfg, this.stripeFetch), this.now())
          sent = true
        }
      } catch (e) {
        console.error(e)
      }
      this.#tenant.scheduleMeter(sent)
    }
    await this.#arm()
  }

  async #armed<T>(p: Promise<T>): Promise<T> {
    const out = await p
    await this.#arm()
    return out
  }

  async #arm(): Promise<void> {
    const due = this.#tenant.nextDue()
    if (due !== null) await this.ctx.storage.setAlarm(this.alarmAt(due))
  }
}
