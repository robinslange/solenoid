import { describe, expect, it, vi } from 'vitest'

describe('testServer() on a Node without node:sqlite', () => {
  it('says which Node versions ship it, and keeps the import error as the cause', async () => {
    vi.doMock('node:sqlite', () => { throw new Error('No such built-in module: node:sqlite') })
    const { testServer } = await import('../src/index')
    const e = (await testServer().catch((x: unknown) => x)) as Error
    expect(e.message).toBe(`testServer() needs node:sqlite, which Node ships from 22.5 (behind --experimental-sqlite on 22.5 to 22.12 and 23.0 to 23.3). This is Node ${process.version}.`)
    expect(e.cause).toBeInstanceOf(Error)
  })
})
