delete process.env.SOLENOID_KEY
delete process.env.SOLENOID_API

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname !== '127.0.0.1') return Promise.reject(new TypeError(`test setup refuses a real fetch to ${url.origin}; only the local shim on 127.0.0.1 is reachable`))
  return realFetch(input, init)
}
