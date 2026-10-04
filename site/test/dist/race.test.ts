import { expect, it } from 'vitest'
import race from '../../src/data/race.json'
import { attr, elementById, walk } from '../../scripts/lib/html.mjs'
import { readDist } from './dist'

it('renders every line of the race into the page, so it reads with no JavaScript', () => {
  const section = elementById(readDist('index.html'), 'race')
  expect(section).not.toBeNull()
  const items = [...walk(section)].filter((n) => n.nodeName === 'li' && attr(n, 'data-at') !== undefined)
  expect(items.map((n) => Number(attr(n, 'data-at')))).toEqual(race.lines.map((l) => l.at_ms))
  expect(items.map((n) => n.childNodes.map((c: { value?: string }) => c.value ?? '').join(''))).toEqual(race.lines.map((l) => l.text))
})
