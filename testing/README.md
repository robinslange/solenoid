# @solenoid.systems/testing

Solenoid puts limits on the actions your AI agent takes and checks them before each action. `testServer()` runs Solenoid inside your test process, so your tests hit the same limit checks your agent does and no request leaves the process. It is the hosted API's own request handler and ledger code, over in-memory `node:sqlite`.

It needs Node 22.5 or later, and Node 22.5 to 22.12 and 23.0 to 23.3 also need the `--experimental-sqlite` flag ([Node SQLite docs](https://nodejs.org/api/sqlite.html)). Under a test runner, pass the flag through the environment, for example `NODE_OPTIONS=--experimental-sqlite npx vitest`.

```sh
npm i -D @solenoid.systems/testing @solenoid.systems/sdk
```

```ts
import { solenoid } from '@solenoid.systems/sdk'
import { testServer } from '@solenoid.systems/testing'

const server = await testServer()
const { admin_key } = await server.signup()
const admin = solenoid({ key: admin_key, api: server.api, fetch: server.fetch })
```

`await testServer()` returns `fetch`, `api`, `signup()`, `setNow(ms)`, `outage(on)`, `outbox()` and `mailDown(on)`. [The Testing section of the SDK docs](https://solenoid.systems/docs#testing) describes each one.

## License

FSL-1.1-ALv2, because it contains the Solenoid server's code. You may use it for any purpose except a Competing Use: making it available to others in a commercial product or service that substitutes for this package, substitutes for any other product or service the licensor offers using it that exists when the package is made available, or offers the same or substantially similar functionality. Each version becomes Apache 2.0 on the second anniversary of its release. The SDK, CLI and MCP are MIT. The source is at https://github.com/robinslange/solenoid, and `LICENSING.md` there maps every directory to its license.
