export type Per = 'hour' | 'day' | 'week' | 'month' | 'child' | 'child-day' | null
export type Amounts = Record<string, number>
export type Mode = 'open' | 'closed'
export type Receipt = {
  id: string; seq: number; kind: 'spend' | 'settle' | 'limit' | 'rotate'; scope: string; body: Record<string, unknown>
  at: string; kid: string; prev: string; hash: string; sig: string; replay: boolean
}
export type Left = { scope: string; left: number; resets: string | null }
export type Warning = { scope: string; unit: string; used: number; limit: number }
export type LimitView = { scope: string; unit: string; limit: number; per: Per; on_outage: Mode; warn_at: number | null; used: number | null; left: number | null; resets: string | null }
export type View = { scope: string; epoch: number; limits: LimitView[]; children: string[]; entries: Receipt[]; next: number | null }
export type SpendResponse = { receipt: Receipt; remaining: Record<string, Left>; on_outage: Mode; warnings: Warning[] }
export interface OutageStore { get(scope: string): Mode | undefined | Promise<Mode | undefined>; set(scope: string, v: Mode): void | Promise<void> }
export type Price = { input: number; output: number; max_output?: number }
export type Prices = Record<string, Price>
