export class SolenoidError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail: Record<string, unknown> = {}) { super(`solenoid: ${code} (${status})`) }
}
export class LimitExceeded extends SolenoidError {
  get scope(): string { return this.detail.scope as string }
  get unit(): string { return this.detail.unit as string }
  get resets(): string | null { return (this.detail.resets as string | null) ?? null }
}
export class SolenoidUnavailable extends Error {
  constructor(readonly scope: string, cause: unknown) { super(`solenoid is unreachable and the limits on "${scope}" fail closed`, { cause }) }
}
export class Outage extends Error {}
export function toError(status: number, data: Record<string, unknown>): SolenoidError {
  const { error, ...detail } = data
  const code = typeof error === 'string' ? error : 'unknown'
  return status === 402 ? new LimitExceeded(status, code, detail) : new SolenoidError(status, code, detail)
}
