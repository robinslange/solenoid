import type { TestProject } from 'vitest/node'
import { startWranglerDev, type Dev } from './wrangler-dev.ts'

declare module 'vitest' {
  interface ProvidedContext { api: string; master: string }
}

let dev: Dev | undefined

export async function setup(project: TestProject) {
  dev = await startWranglerDev()
  project.provide('api', dev.api)
  project.provide('master', dev.master)
}

export async function teardown() {
  await dev?.stop()
  dev = undefined
}
