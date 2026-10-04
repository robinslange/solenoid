import { describe, expect, it } from 'vitest'
import { changedMail, codeMail, confirmMail, duplicateMail, resendMailer } from '../src/mail'

describe('resendMailer', () => {
  it('posts one message to Resend with the key and the sender', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response('{"id":"x"}', { status: 200 }) }) as unknown as typeof fetch
    await resendMailer('re_key', 'Solenoid <auth@solenoid.systems>', f)({ to: 'a@b.cd', subject: 's', text: 't' })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://api.resend.com/emails')
    expect(seen[0].init.method).toBe('POST')
    expect(seen[0].init.headers).toEqual({ authorization: 'Bearer re_key', 'content-type': 'application/json' })
    expect(JSON.parse(seen[0].init.body as string)).toEqual({ from: 'Solenoid <auth@solenoid.systems>', to: ['a@b.cd'], subject: 's', text: 't' })
  })
  it('throws when Resend refuses or no key is set', async () => {
    const refuse = (async () => new Response('no', { status: 422 })) as unknown as typeof fetch
    await expect(resendMailer('re_key', 'x', refuse)({ to: 'a@b.cd', subject: 's', text: 't' })).rejects.toThrow('HTTP 422')
    await expect(resendMailer(undefined, 'x', refuse)({ to: 'a@b.cd', subject: 's', text: 't' })).rejects.toThrow('RESEND_API_KEY')
  })
})

describe('message bodies', () => {
  it('put the code in the subject and the body, and name the account', () => {
    const m = codeMail('a@b.cd', '042917', 'abcdefghijkl', 'recover')
    expect(m.to).toBe('a@b.cd')
    expect(m.subject).toContain('042917')
    expect(m.text).toContain('042917')
    expect(m.text).toContain('abcdefghijkl')
    expect(codeMail('a@b.cd', '042917', 'abcdefghijkl', 'attach').text).not.toBe(m.text)
    expect(confirmMail('a@b.cd', 'abcdefghijkl').text).toContain('abcdefghijkl')
    const attach = codeMail('a@b.cd', '042917', 'abcdefghijkl', 'attach')
    expect(attach.text).toContain('042917')
    expect(attach.text).toContain('abcdefghijkl')
  })

  it('render every message as a subject and plain-text paragraphs, none empty and no two sentences run together', () => {
    const all = [
      codeMail('a@b.cd', '042917', 'abcdefghijkl', 'attach'),
      codeMail('a@b.cd', '042917', 'abcdefghijkl', 'recover'),
      confirmMail('a@b.cd', 'abcdefghijkl'),
      changedMail('a@b.cd', 'abcdefghijkl'),
    ]
    for (const m of all) {
      expect(m.to).toBe('a@b.cd')
      expect(m.subject.trim()).not.toBe('')
      expect(m.text.split('\n\n').every((p) => p.trim() !== '')).toBe(true)
      expect(m.text).not.toMatch(/[.!?][A-Z]/)
    }
    expect(changedMail('a@b.cd', 'abcdefghijkl').text).toContain('abcdefghijkl')
  })

  it('address the duplicate notice to security@ in the same shape, naming the account, the subscription and the session', () => {
    for (const cancelled of [true, false]) {
      const m = duplicateMail('abcdefghijkl', 'sub_2', 'cs_2', cancelled)
      expect(m.to).toBe('security@solenoid.systems')
      expect(m.subject).toContain('abcdefghijkl')
      expect(m.text.split('\n\n')).toHaveLength(2)
      expect(m.text.split('\n\n').every((p) => p.trim() !== '')).toBe(true)
      expect(m.text).not.toMatch(/[.!?][A-Z]/)
      for (const id of ['abcdefghijkl', 'sub_2', 'cs_2']) expect(m.text).toContain(id)
    }
  })

  it('tell a cancelled duplicate from one that had already ended, in the subject and every paragraph', () => {
    const cancelled = duplicateMail('abcdefghijkl', 'sub_2', 'cs_2', true)
    const ended = duplicateMail('abcdefghijkl', 'sub_2', 'cs_2', false)
    expect(ended.subject).not.toBe(cancelled.subject)
    const [c, e] = [cancelled.text.split('\n\n'), ended.text.split('\n\n')]
    for (let i = 0; i < 2; i++) expect(e[i]).not.toBe(c[i])
  })

  it('name the recovery command next to the account ID, and reattach and rotate in one step after a change', () => {
    expect(confirmMail('a@b.cd', 'abcdefghijkl').text).toContain('solenoid recover a@b.cd --tenant abcdefghijkl')
    const changed = changedMail('a@b.cd', 'abcdefghijkl').text
    expect(changed).toContain('`solenoid email a@b.cd`, then `solenoid email a@b.cd <code> --rotate`')
    expect(changed).not.toContain('rotate --admin')
    expect(changed.split('\n\n').at(-1)).toBe(
      "If `solenoid email a@b.cd` fails with invalid_key, the admin key was already replaced. If you didn't replace it, this address can no longer recover the account, and `solenoid init --force` starts a new account, overwriting the saved admin key.",
    )
  })

  it('tell the two code emails apart in the subject', () => {
    const attach = codeMail('a@b.cd', '042917', 'abcdefghijkl', 'attach')
    const recover = codeMail('a@b.cd', '042917', 'abcdefghijkl', 'recover')
    expect(attach.subject).toContain('042917')
    expect(attach.subject).not.toBe(recover.subject)
  })
})
