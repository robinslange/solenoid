import { describe, expect, it } from 'vitest'
import saved from '../../src/data/receipt.json'
import { attr, elementById, root, textOf, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

const html = () => readDist('index.html')
const section = (id: string) => {
  const n = elementById(html(), id)
  expect(n, `#${id}`).not.toBeNull()
  return n!
}
const byClass = (node: unknown, cls: string) => [...walk(node)].filter((n) => (attr(n, 'class') ?? '').split(/\s+/).includes(cls))
const hrefs = (node: unknown) => [...walk(node)].filter((n) => n.nodeName === 'a').map((n) => attr(n, 'href'))

describe('the landing page', () => {
  it('orders its sections as the spec does', () => {
    const ids = [...walk(root(html()))].map((n) => attr(n, 'id')).filter((id) => ['hero', 'race', 'one-call', 'receipt', 'limits', 'outage', 'pricing-strip', 'why', 'start'].includes(id))
    expect(ids).toEqual(['hero', 'race', 'one-call', 'receipt', 'limits', 'outage', 'pricing-strip', 'why', 'start'])
  })

  it('shows the same init command, run in the project root, in the hero and the bottom call to action', () => {
    for (const id of ['start-hero', 'start-bottom']) {
      const [command] = byClass(section(id), 'start-command')
      expect(textOf(command)).toBe('npx @solenoid.systems/cli init support-bot')
    }
  })

  it('gives the agent a prompt that names llms.txt, .env and SOLENOID_KEY, and never asks it to run init', () => {
    for (const id of ['start-hero', 'start-bottom']) {
      const prompt = textOf(byClass(section(id), 'agent-prompt')[0])
      for (const s of ['https://solenoid.systems/llms.txt', '.env', 'SOLENOID_KEY']) expect(prompt).toContain(s)
      expect(prompt).not.toContain('npx @solenoid.systems/cli init')
    }
  })

  it('pays off the hook with a per-customer limit in the prompt and the third step, and a stop command after the steps', () => {
    for (const id of ['start-hero', 'start-bottom']) {
      expect(textOf(byClass(section(id), 'agent-prompt')[0])).toContain('--per child')
      expect(textOf(byClass(section(id), 'limit-command')[0])).toBe('npx @solenoid.systems/cli limit support-bot emails=3 --per child')
    }
    for (const id of ['hero', 'start']) expect(textOf(byClass(section(id), 'stop-command')[0])).toBe('npx @solenoid.systems/cli limit support-bot emails=0')
  })

  it('puts a Start link to the bottom call to action in the header', () => {
    expect(hrefs([...walk(root(html()))].find((n) => n.nodeName === 'header'))).toContain('/#start')
  })

  it('links the proof test and the recorder at the launch tag', () => {
    expect(hrefs(section('race'))).toEqual(expect.arrayContaining([
      'https://github.com/robinslange/solenoid/blob/launch/e2e/test/concurrency.test.ts',
      'https://github.com/robinslange/solenoid/blob/launch/e2e/record-race.ts',
    ]))
  })

  it('shows the saved production receipt and the offline check', () => {
    const text = textOf(section('receipt'))
    for (const s of [saved.receipt.hash, saved.receipt.sig, 'verifyChain([receipt], keys)', '/.well-known/solenoid.json']) expect(text).toContain(s)
  })

  it('offers a TypeScript tab and a CLI tab, and nothing else', () => {
    expect(byClass(section('one-call'), 'tab-label').map(textOf)).toEqual(['TypeScript', 'CLI'])
  })

  it('names model spend only to send it to the gateway, links the at-most-once test, pricing and the founder note', () => {
    expect(textOf(section('limits'))).toContain('keep your gateway for that')
    expect(hrefs(section('limits'))).toContain('https://github.com/robinslange/solenoid/blob/launch/e2e/test/concurrency.test.ts')
    expect(hrefs(section('pricing-strip'))).toContain('/pricing')
    expect(hrefs(section('why'))).toContain('/why')
  })
})
