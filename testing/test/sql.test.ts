import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { sqlOver } from '../src/sql'

it('commits a transaction that returns, and rolls back and rethrows one that throws', () => {
  const sql = sqlOver(new DatabaseSync(':memory:'))
  sql.exec('CREATE TABLE t (v INTEGER)')
  const boom = new Error('boom')
  expect(() => sql.transactionSync(() => { sql.exec('INSERT INTO t VALUES (1)'); throw boom })).toThrow(boom)
  expect(sql.exec('SELECT count(*) AS n FROM t').toArray()).toEqual([{ n: 0 }])
  expect(sql.transactionSync(() => { sql.exec('INSERT INTO t VALUES (?)', 2); return 'done' })).toBe('done')
  expect(sql.exec('SELECT v FROM t').toArray()).toEqual([{ v: 2 }])
})
