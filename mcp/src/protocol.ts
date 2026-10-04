import { SolenoidError } from '@solenoid.systems/sdk'

export type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; call(args: Record<string, unknown>): Promise<string> }
const LEGACY = ['2025-11-25', '2025-06-18']
export const SUPPORTED = ['2026-07-28', ...LEGACY]
const VERSION_META = 'io.modelcontextprotocol/protocolVersion'
const SERVER_INFO_META = 'io.modelcontextprotocol/serverInfo'
const CACHE = { ttlMs: 0, cacheScope: 'private' }

type Msg = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: Record<string, any> }

export function describe(e: unknown): string {
  if (e instanceof SolenoidError) return Object.keys(e.detail).length ? `${e.message} ${JSON.stringify(e.detail)}` : e.message
  return e instanceof Error ? e.message : String(e)
}

export function server(tools: Tool[], info: { name: string; version: string }) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  let legacySession = false
  return async function handle(line: string): Promise<string | null> {
    let m: Msg
    try { m = JSON.parse(line) } catch { return JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) }
    const id = typeof m?.id === 'string' || Number.isSafeInteger(m?.id) ? m.id : null
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0' || typeof m.method !== 'string' || (m.id !== undefined && id === null)) {
      return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'invalid request' } })
    }
    if (m.id === undefined) return null
    const rawReply = (result: Record<string, unknown>) => JSON.stringify({ jsonrpc: '2.0', id: m.id, result })
    const error = (code: number, message: string, data?: unknown) => JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code, message, data } })
    const version = m.params?._meta?.[VERSION_META]
    if (version !== undefined && !SUPPORTED.includes(version)) return error(-32022, 'unsupported protocol version', { supported: SUPPORTED, requested: version })
    const modern = version !== undefined ? !LEGACY.includes(version) : !legacySession
    const reply = (result: Record<string, unknown>) => rawReply(modern ? { ...result, _meta: { ...(result._meta as Record<string, unknown> | undefined), [SERVER_INFO_META]: info } } : result)
    switch (m.method) {
      case 'initialize': {
        legacySession = true
        const asked = m.params?.protocolVersion
        return rawReply({ protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0], capabilities: { tools: {} }, serverInfo: info })
      }
      case 'server/discover':
        return reply({ resultType: 'complete', supportedVersions: SUPPORTED, capabilities: { tools: {} }, ...CACHE })
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ resultType: 'complete', tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), ...CACHE })
      case 'tools/call': {
        const tool = byName.get(m.params?.name)
        if (!tool) return error(-32602, `unknown tool: ${m.params?.name}`)
        try {
          return reply({ resultType: 'complete', content: [{ type: 'text', text: await tool.call(m.params?.arguments ?? {}) }] })
        } catch (e) {
          return reply({ resultType: 'complete', content: [{ type: 'text', text: describe(e) }], isError: true })
        }
      }
      default:
        return error(-32601, `method not found: ${m.method}`)
    }
  }
}

export async function serveStdio(handle: (line: string) => Promise<string | null>, input: NodeJS.ReadableStream, write: (s: string) => void): Promise<void> {
  const serve = async (line: string) => {
    if (!line.trim()) return
    const out = await handle(line.endsWith('\r') ? line.slice(0, -1) : line)
    if (out !== null) write(`${out}\n`)
  }
  let rest = ''
  input.setEncoding('utf8')
  for await (const chunk of input) {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop()!
    for (const line of lines) await serve(line)
  }
  await serve(rest)
}
