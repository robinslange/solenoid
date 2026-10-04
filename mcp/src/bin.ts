import { start } from './main'

start(process.argv.slice(2), process.env, process.stdin, (s) => process.stdout.write(s)).catch((e: Error) => {
  process.stderr.write(`solenoid-mcp: ${e.message}\n`)
  process.exit(1)
})
