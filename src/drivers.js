/**
 * 驱动适配层：把 MySQL、PostgreSQL、SQLite 收敛成统一的会话接口。
 *
 * 会话执行结果是 `{ columns, rows, rowCount, durationMs }`；执行失败原样抛出驱动错误，
 * 由连接管理器判定是否属于连接失效。
 * acquire() 取到的独占连接承载事务，事务语句与后续语句都在同一条物理连接上执行。
 */

/** MySQL、PostgreSQL 连接池把空闲连接的意外断开当作进程级事件，必须接住。 */
function ignoreFailure() {}

function toTable(rows, columns) {
  const list = Array.isArray(rows) ? rows : []
  if (columns.length === 0) {
    return {
      rows: list.map((row) => {
        if (row && typeof row === 'object' && !Array.isArray(row)) return Object.values(row)
        return [row]
      }),
    }
  }
  return {
    rows: list.map((row) => {
      if (row && typeof row === 'object') return columns.map((column) => row[column] ?? null)
      return [row]
    }),
  }
}

async function createMysqlSession(connection) {
  const module = await import('mysql2/promise')
  const mysql = module.default ?? module
  const pool = mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database || undefined,
    connectionLimit: 4,
    waitForConnections: true,
    connectTimeout: 10000,
  })
  pool.on('error', ignoreFailure)

  async function query(target, sql, params = []) {
    const started = Date.now()
    const [rows, fields] = await target.query(sql, params)
    const durationMs = Date.now() - started
    if (Array.isArray(rows)) {
      const columns = Array.isArray(fields) && fields.length > 0 && fields[0]?.name !== undefined
        ? fields.map((field) => String(field.name))
        : Object.keys(rows[0] ?? {})
      return { columns, rows: toTable(rows, columns).rows, rowCount: rows.length, durationMs }
    }
    return { columns: [], rows: [], rowCount: Number(rows?.affectedRows ?? 0), durationMs }
  }

  return {
    async exec(sql, params = []) {
      return query(pool, sql, params)
    },
    async acquire() {
      const client = await pool.getConnection()
      return {
        exec: (sql, params = []) => query(client, sql, params),
        async begin() {
          await client.query('START TRANSACTION')
        },
        async commit() {
          await client.query('COMMIT')
        },
        async rollback() {
          await client.query('ROLLBACK')
        },
        async release(discard = false) {
          if (discard) client.destroy()
          else client.release()
        },
      }
    },
    async ping() {
      await pool.query('SELECT 1')
    },
    async close() {
      await pool.end()
    },
  }
}

async function createPostgresSession(connection) {
  const module = await import('pg')
  const pg = module.default ?? module
  const pool = new pg.Pool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database || undefined,
    max: 4,
    connectionTimeoutMillis: 10000,
  })
  pool.on('error', ignoreFailure)

  async function query(target, sql, params = []) {
    const started = Date.now()
    const raw = await target.query(sql, params)
    const durationMs = Date.now() - started
    const result = Array.isArray(raw) ? raw[raw.length - 1] : raw
    const columns = Array.isArray(result.fields) ? result.fields.map((field) => String(field.name)) : []
    const rows = Array.isArray(result.rows) ? result.rows : []
    return {
      columns,
      rows: toTable(rows, columns).rows,
      rowCount: Number(result.rowCount ?? rows.length),
      durationMs,
    }
  }

  return {
    async exec(sql, params = []) {
      return query(pool, sql, params)
    },
    async acquire() {
      const client = await pool.connect()
      return {
        exec: (sql, params = []) => query(client, sql, params),
        async begin() {
          await client.query('BEGIN')
        },
        async commit() {
          const result = await client.query('COMMIT')
          return { command: String(result?.command ?? '') }
        },
        async rollback() {
          await client.query('ROLLBACK')
        },
        async release(discard = false) {
          client.release(discard ? new Error('事务连接已丢弃') : undefined)
        },
      }
    },
    async ping() {
      await pool.query('SELECT 1')
    },
    async close() {
      await pool.end()
    },
  }
}

/** 语句是否返回结果集；node:sqlite 需要据此选择 all() 或 run()。 */
function returnsRows(sql) {
  return /^\s*(select|with|pragma|explain|values|table)\b/i.test(sql)
}

function isMissingRowsError(error) {
  return /does not return data|no result|not return rows/i.test(String(error?.message ?? ''))
}

async function createSqliteSession(connection) {
  let module
  try {
    module = await import('node:sqlite')
  } catch {
    throw new Error('当前 Host 运行时不含 node:sqlite，SQLite 连接不可用')
  }
  if (!connection.file) throw new Error('SQLite 连接缺少数据库文件路径')
  const db = new module.DatabaseSync(connection.file)

  function execute(target, sql, params = []) {
    const started = Date.now()
    const statement = target.prepare(sql)
    if (returnsRows(sql)) {
      let rows
      try {
        rows = statement.all(...params)
      } catch (error) {
        if (!isMissingRowsError(error)) throw error
        const info = statement.run(...params)
        return { columns: [], rows: [], rowCount: Number(info?.changes ?? 0), durationMs: Date.now() - started }
      }
      const columns = Object.keys(rows[0] ?? {})
      return { columns, rows: toTable(rows, columns).rows, rowCount: rows.length, durationMs: Date.now() - started }
    }
    const info = statement.run(...params)
    return { columns: [], rows: [], rowCount: Number(info?.changes ?? 0), durationMs: Date.now() - started }
  }

  return {
    async exec(sql, params = []) {
      return execute(db, sql, params)
    },
    async acquire() {
      const dedicated = new module.DatabaseSync(connection.file)
      return {
        exec: (sql, params = []) => execute(dedicated, sql, params),
        async begin() {
          dedicated.prepare('BEGIN').run()
        },
        async commit() {
          dedicated.prepare('COMMIT').run()
        },
        async rollback() {
          dedicated.prepare('ROLLBACK').run()
        },
        async release() {
          dedicated.close()
        },
      }
    },
    async ping() {
      db.prepare('SELECT 1').get()
    },
    async close() {
      db.close()
    },
  }
}

/**
 * 按驱动建立一个会话。
 *
 * @param {{ driver: string, host: string, port: number, user: string, password: string, database: string, file: string }} connection
 */
export function createSession(connection) {
  if (connection.driver === 'sqlite') return createSqliteSession(connection)
  if (connection.driver === 'postgres') return createPostgresSession(connection)
  return createMysqlSession(connection)
}
