import { readdirSync } from 'node:fs'

export const listFiles = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => `${d.parentPath}/${d.name}`.slice(dir.length + 1).split('\\').join('/'))
    .sort()
