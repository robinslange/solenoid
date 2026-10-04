import { signup } from '@solenoid.systems/sdk'
import { describe, it } from 'vitest'
import { scenarios, type Target } from '../../contract/scenarios'
import { api } from './harness'

const target: Target = { fetch: globalThis.fetch.bind(globalThis), api, signup: () => signup(api) }

describe('contract scenarios against the local Worker', () => {
  for (const s of scenarios) it.skipIf(s.needsClock || s.needsOutbox)(s.name, () => s.run(target))
})
