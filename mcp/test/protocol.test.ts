import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { SolenoidError } from '@solenoid.systems/sdk'
import { SUPPORTED, describe as describeError, server, serveStdio, type Tool } from '../src/protocol'

const echo: Tool = { name: 'echo', description: 'd', inputSchema: { type: 'object' }, call: async (a) => JSON.stringify(a) }
const boom: Tool = { name: 'boom', description: 'd', inputSchema: { type: 'object' }, call: async () => { throw new SolenoidError(402, 'limit_exceeded', { scope: 'a' }) } }
const h = server([echo, boom], { name: 'solenoid', version: '2.0.0' })
const rpc = async (msg: unknown) => JSON.parse((await h(JSON.stringify(msg)))!)
const meta = (v: string) => ({ _meta: { 'io.modelcontextprotocol/protocolVersion': v, 'io.modelcontextprotocol/clientCapabilities': {} } })
const serverInfo = { 'io.modelcontextprotocol/serverInfo': { name: 'solenoid', version: '2.0.0' } }
function freshServer() {
  const s = server([echo, boom], { name: 'solenoid', version: '2.0.0' })
  return { rpc: async (msg: unknown) => JSON.parse((await s(JSON.stringify(msg)))!) }
}

describe('server', () => {
  it('negotiates a legacy protocol version in initialize', async () => {
    const { rpc } = freshServer()
    const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'solenoid', version: '2.0.0' } } })
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion).toBe('2025-11-25')
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2026-07-28' } })).result.protocolVersion).toBe('2025-11-25')
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize' })).result.protocolVersion).toBe('2025-11-25')
    for (const batching of ['2025-03-26', '2024-11-05']) {
      expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: batching } })).result.protocolVersion).toBe('2025-11-25')
    }
  })
  it('lists the newest revision first, then the legacy ones without batching', () => {
    expect(SUPPORTED).toEqual(['2026-07-28', '2025-11-25', '2025-06-18'])
  })
  it('answers server/discover with the versions, capabilities and identity', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: meta('2026-07-28') })).toEqual({
      jsonrpc: '2.0',
      id: 'd',
      result: {
        resultType: 'complete',
        supportedVersions: SUPPORTED,
        capabilities: { tools: {} },
        ttlMs: 0,
        cacheScope: 'private',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'solenoid', version: '2.0.0' } },
      },
    })
  })
  it('refuses a request whose _meta names a version it does not speak', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list', params: meta('1900-01-01') })).toEqual({
      jsonrpc: '2.0',
      id: 11,
      error: { code: -32022, message: 'unsupported protocol version', data: { supported: SUPPORTED, requested: '1900-01-01' } },
    })
    expect(await rpc({ jsonrpc: '2.0', id: 12, method: 'server/discover', params: meta('2027-01-01') })).toMatchObject({ id: 12, error: { code: -32022, data: { requested: '2027-01-01' } } })
    expect((await rpc({ jsonrpc: '2.0', id: 13, method: 'tools/list', params: meta('2026-07-28') })).result.tools).toHaveLength(2)
  })
  it('answers ping, lists tools without their handlers, and calls one', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 3, result: { _meta: serverInfo } })
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).result).toEqual({
      resultType: 'complete',
      tools: [
        { name: 'echo', description: 'd', inputSchema: { type: 'object' } },
        { name: 'boom', description: 'd', inputSchema: { type: 'object' } },
      ],
      ttlMs: 0,
      cacheScope: 'private',
      _meta: serverInfo,
    })
    expect((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 }, ...meta('2026-07-28') } })).result).toEqual({ resultType: 'complete', content: [{ type: 'text', text: '{"a":1}' }], _meta: serverInfo })
    expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo' } })).result.content[0].text).toBe('{}')
  })
  it('reports a tool failure as an error result, not a protocol error', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'boom', arguments: {} } })
    expect(r.result).toEqual({ resultType: 'complete', content: [{ type: 'text', text: 'solenoid: limit_exceeded (402) {"scope":"a"}' }], isError: true, _meta: serverInfo })
  })
  it('carries serverInfo on an explicitly modern or legacy request, but not on the legacy initialize handshake', async () => {
    const { rpc: freshRpc } = freshServer()
    expect((await freshRpc({ jsonrpc: '2.0', id: 20, method: 'tools/list', params: meta('2026-07-28') })).result._meta).toEqual(serverInfo)
    expect((await freshRpc({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'echo', ...meta('2026-07-28') } })).result._meta).toEqual(serverInfo)
    expect((await freshRpc({ jsonrpc: '2.0', id: 22, method: 'tools/list', params: meta('2025-11-25') })).result._meta).toBeUndefined()
    expect((await freshRpc({ jsonrpc: '2.0', id: 23, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).result._meta).toBeUndefined()
  })
  it('treats a version-less request as modern before any initialize call on the session', async () => {
    const { rpc: freshRpc } = freshServer()
    expect((await freshRpc({ jsonrpc: '2.0', id: 1, method: 'server/discover' })).result._meta).toEqual(serverInfo)
    expect((await freshRpc({ jsonrpc: '2.0', id: 2, method: 'ping' })).result._meta).toEqual(serverInfo)
  })
  it('marks the session legacy once it calls initialize, so its later version-less requests get no serverInfo', async () => {
    const { rpc: freshRpc } = freshServer()
    await freshRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    expect((await freshRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result._meta).toBeUndefined()
    expect((await freshRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo' } })).result._meta).toBeUndefined()
  })
  it('still carries serverInfo after initialize when a later request names an explicit modern version', async () => {
    const { rpc: freshRpc } = freshServer()
    await freshRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    expect((await freshRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: meta('2026-07-28') })).result._meta).toEqual(serverInfo)
  })
  it('keeps going through bad input', async () => {
    expect(await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope' } })).toEqual({ jsonrpc: '2.0', id: 8, error: { code: -32602, message: 'unknown tool: nope' } })
    expect(await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call' })).toMatchObject({ id: 8, error: { code: -32602 } })
    expect(await rpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' })).toEqual({ jsonrpc: '2.0', id: 9, error: { code: -32601, message: 'method not found: resources/list' } })
    expect(JSON.parse((await h('{not json'))!)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
    expect(await rpc({ id: 10, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 10, error: { code: -32600, message: 'invalid request' } })
    expect(await rpc({ jsonrpc: '1.0', id: 10, method: 'ping' })).toMatchObject({ id: 10, error: { code: -32600 } })
    expect(await rpc({ jsonrpc: '2.0', id: 10, method: 7 })).toMatchObject({ id: 10, error: { code: -32600 } })
    expect(await rpc({ jsonrpc: '2.0', id: 10 })).toMatchObject({ id: 10, error: { code: -32600 } })
    expect(await rpc(null)).toMatchObject({ id: null, error: { code: -32600 } })
    for (const id of [null, {}, true, 1.5, [1]]) {
      expect(await rpc({ jsonrpc: '2.0', id, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } })
    }
    for (const id of ['9007199254740993', '1e21']) {
      expect(JSON.parse((await h(`{"jsonrpc":"2.0","id":${id},"method":"ping"}`))!)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } })
    }
    expect(await rpc({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER, result: { _meta: serverInfo } })
    expect(await rpc({ jsonrpc: '2.0', id: 'a', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'a', result: { _meta: serverInfo } })
    expect(await rpc({ jsonrpc: '2.0', id: 0, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 0, result: { _meta: serverInfo } })
    expect(await rpc({ jsonrpc: '2.0', id: 1.5 })).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await rpc('ping')).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await rpc({ jsonrpc: '2.0', method: 7 })).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await h(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).toBeNull()
    expect(await h(JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'nope' } }))).toBeNull()
  })
})

describe('describe', () => {
  it('names the code and the detail of a SolenoidError', () => {
    expect(describeError(new SolenoidError(403, 'out_of_scope', { scope: 'b' }))).toBe('solenoid: out_of_scope (403) {"scope":"b"}')
    expect(describeError(new SolenoidError(401, 'invalid_key'))).toBe('solenoid: invalid_key (401)')
    expect(describeError(new Error('x'))).toBe('x')
    expect(describeError('y')).toBe('y')
  })
})

describe('serveStdio', () => {
  it('answers one line per request, skips blank lines and notifications, and writes only JSON', async () => {
    const input = new PassThrough()
    const out: string[] = []
    const done = serveStdio(h, input, (s) => out.push(s))
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n\n   \n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
    input.end()
    await done
    expect(out).toEqual([
      '{"jsonrpc":"2.0","id":1,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n',
    ])
  })
  it('frames on \\n only, so a raw U+2028 or U+2029 inside a string stays in its message', async () => {
    const input = new PassThrough()
    const out: string[] = []
    const done = serveStdio(h, input, (s) => out.push(s))
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"s":"a\u2028b\u2029c"}}}\n')
    input.end()
    await done
    expect(out).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"resultType":"complete","content":[{"type":"text","text":"{\\"s\\":\\"a\u2028b\u2029c\\"}"}],"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n'])
  })
  it('strips one trailing \\r, joins a line split across chunks, even inside a character, and answers a last line with no newline', async () => {
    const input = new PassThrough()
    const out: string[] = []
    const done = serveStdio(h, input, (s) => out.push(s))
    const split = Buffer.from('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"s":"\u2028"}}}\r\n')
    const cut = split.indexOf(Buffer.from('\u2028')) + 1
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\r\n\r\n')
    input.write(split.subarray(0, cut))
    input.write(split.subarray(cut))
    input.write('{"jsonrpc":"2.0","id":3,')
    input.write('"method":"ping"}')
    input.end()
    await done
    expect(out).toEqual([
      '{"jsonrpc":"2.0","id":1,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n',
      '{"jsonrpc":"2.0","id":2,"result":{"resultType":"complete","content":[{"type":"text","text":"{\\"s\\":\\"\u2028\\"}"}],"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n',
      '{"jsonrpc":"2.0","id":3,"result":{"_meta":{"io.modelcontextprotocol/serverInfo":{"name":"solenoid","version":"2.0.0"}}}}\n',
    ])
  })
})
