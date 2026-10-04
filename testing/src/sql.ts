import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { Sql } from '../../worker/src/core'

export function sqlOver(db: DatabaseSync): Sql {
  return {
    exec(query, ...params) {
      const rows = db.prepare(query).all(...(params as SQLInputValue[]))
      return { toArray: () => rows }
    },
    transactionSync(fn) {
      db.exec('BEGIN')
      try {
        const out = fn()
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
  }
}
