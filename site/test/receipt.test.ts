import { verifyChain, type Receipt } from '@solenoid.systems/sdk'
import { expect, it } from 'vitest'
import keys from '../src/data/keys.json'
import saved from '../src/data/receipt.json'

const receipt = saved.receipt as Receipt
const chain = saved.chain as Receipt[]

it('verifies offline with the saved keys, alone and as its account chain', async () => {
  expect(await verifyChain([receipt], keys)).toBe(true)
  expect(await verifyChain(chain, keys)).toBe(true)
  expect(chain).toContainEqual(receipt)
})

it('is a production receipt signed with k1, and fails once any field changes', async () => {
  expect(receipt.kid).toBe('k1')
  expect(Object.keys(keys)).toContain('k1')
  expect(await verifyChain([{ ...receipt, body: { ...receipt.body, emails: 2 } }], keys)).toBe(false)
  expect(await verifyChain([{ ...receipt, at: '2020-01-01T00:00:00.000Z' }], keys)).toBe(false)
})
