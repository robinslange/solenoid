import { SolenoidError, signup, solenoid } from '@solenoid.systems/sdk'
import { expect, it } from 'vitest'
import { api } from './harness'

it('answers email_failed when the local Worker has no Resend key', async () => {
  const { admin_key } = await signup(api)
  await expect(solenoid({ key: admin_key, api }).sendEmailCode('a@b.cd')).rejects.toSatisfy((e: unknown) => e instanceof SolenoidError && e.code === 'email_failed')
})
