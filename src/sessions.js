/**
 * 工作进程内的会话层：按连接参数建立会话，执行失败时判定连接失效并自动重建一次。
 *
 * 连接参数随每次请求传入，本层不读取配置存储。
 * 事务按调用方与连接隔离，用一条独占连接承载 begin 之后的全部语句；
 * 面板发起的请求不带调用方，不进入助手的事务。
 */

import { createSession } from './drivers.js'
import { splitStatements } from './script.js'

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  '57P01',
  '57P02',
  '57P03',
  '08001',
  '08003',
  '08006',
])

const CONNECTION_MESSAGE = /connection lost|connection terminated|connection is closed|server closed the connection|terminating connection|client has encountered a connection error|socket hang up|the database connection is not open/i

const TX_IDLE_MS = 10 * 60 * 1000

/** 只有连接级故障才重建会话并重试；语法错误、权限错误直接上报。 */
function isConnectionError(error) {
  const code = String(error?.code ?? '')
  if (CONNECTION_CODES.has(code)) return true
  return CONNECTION_MESSAGE.test(String(error?.message ?? ''))
}

function messageOf(error) {
  return String(error?.message ?? error)
}

function signatureOf(connection) {
  return JSON.stringify([
    connection.driver,
    connection.host,
    connection.port,
    connection.user,
    connection.password,
    connection.database,
    connection.file,
  ])
}

function requireConnection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('缺少连接参数')
  return value
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function clampCount(value, fallback, min, max) {
  const given = Number(value)
  if (!Number.isInteger(given)) return fallback
  if (given < min) return min
  if (max !== undefined && given > max) return max
  return given
}

/** SQLite 的 PRAGMA 不能传参，表名按标识符字符集校验后加引号。 */
function quoteSqliteIdentifier(name) {
  const ident = textOf(name)
  if (!/^[A-Za-z0-9_$\u4e00-\u9fa5]+$/.test(ident)) throw new Error(`表名不合法：${String(name)}`)
  return `"${ident}"`
}

/** 事务归属：同一调用方在同一连接上的多步操作共用一个事务。 */
function transactionKey(agentId, connectionId) {
  return `${agentId}\u0000${connectionId}`
}

export function createSessionManager() {
  /** @type {Map<string, { signature: string, session: object, state: string, lastError: string | null }>} */
  const entries = new Map()
  /** @type {Map<string, { key: string, connectionId: string, runner: object, startedAt: number, statements: number, timer: ReturnType<typeof setTimeout> | undefined }>} */
  const transactions = new Map()
  /** @type {Map<string, string>} 事务被自动结束的原因，用于解释下一次操作的失败。 */
  const notices = new Map()

  function transactionView(tx) {
    return {
      active: true,
      connectionId: tx.connectionId,
      statements: tx.statements,
      durationMs: Date.now() - tx.startedAt,
    }
  }

  function arm(tx) {
    clearTimeout(tx.timer)
    tx.timer = setTimeout(() => {
      void abortTransaction(tx.key, `事务超过 ${TX_IDLE_MS / 60000} 分钟没有操作，已自动回滚`)
    }, TX_IDLE_MS)
    tx.timer.unref?.()
  }

  /** 结束一个事务并释放独占连接；数据库端的未提交改动随回滚丢弃。 */
  async function abortTransaction(key, reason) {
    const tx = transactions.get(key)
    if (!tx) return
    transactions.delete(key)
    clearTimeout(tx.timer)
    let discard = false
    try {
      await tx.runner.rollback()
    } catch {
      discard = true
    }
    try {
      await tx.runner.release(discard)
    } catch {
      // 连接已断开时释放失败不影响事务收尾。
    }
    notices.set(key, reason)
  }

  async function drop(id) {
    for (const [key, tx] of [...transactions]) {
      if (tx.connectionId !== id) continue
      transactions.delete(key)
      clearTimeout(tx.timer)
      try {
        await tx.runner.release(true)
      } catch {
        // 独占连接可能已经失效，释放错误不影响后续清理。
      }
    }
    const entry = entries.get(id)
    if (!entry) return
    entries.delete(id)
    try {
      await entry.session.close()
    } catch {
      // 会话可能已经失效，关闭错误不影响后续重建。
    }
  }

  async function open(connection) {
    const signature = signatureOf(connection)
    const current = entries.get(connection.id)
    if (current && current.signature === signature) return current
    if (current) await drop(connection.id)
    const session = await createSession(connection)
    const entry = { signature, session, state: 'ready', lastError: null }
    entries.set(connection.id, entry)
    return entry
  }

  /** 事务内执行：失败不重建连接，连接级故障会终止事务。 */
  async function runInTransaction(tx, sql, params) {
    arm(tx)
    try {
      const result = await tx.runner.exec(sql, params)
      tx.statements += 1
      const entry = entries.get(tx.connectionId)
      if (entry) {
        entry.state = 'ready'
        entry.lastError = null
      }
      return { ...result, reconnected: false, state: 'ready', inTransaction: true }
    } catch (error) {
      const entry = entries.get(tx.connectionId)
      if (entry) {
        entry.state = 'error'
        entry.lastError = messageOf(error)
      }
      if (isConnectionError(error)) {
        await abortTransaction(tx.key, '事务连接已断开，事务已回滚')
        throw new Error(`事务连接已断开，事务已回滚：${messageOf(error)}`)
      }
      throw error
    }
  }

  async function exec(connection, sql, params = [], agentId = '') {
    if (typeof sql !== 'string' || sql.trim() === '') throw new Error('SQL 不能为空')
    const entry = await open(connection)
    const tx = transactions.get(transactionKey(agentId, connection.id))
    if (tx) return runInTransaction(tx, sql, params)
    try {
      const result = await entry.session.exec(sql, params)
      entry.state = 'ready'
      entry.lastError = null
      return { ...result, reconnected: false, state: 'ready', inTransaction: false }
    } catch (error) {
      if (!isConnectionError(error)) {
        entry.state = 'error'
        entry.lastError = messageOf(error)
        throw error
      }
      entry.state = 'reconnecting'
      entry.lastError = messageOf(error)
      await drop(connection.id)
      const reopened = await open(connection)
      try {
        const result = await reopened.session.exec(sql, params)
        reopened.state = 'ready'
        reopened.lastError = null
        return { ...result, reconnected: true, state: 'ready', inTransaction: false }
      } catch (retryError) {
        reopened.state = 'error'
        reopened.lastError = messageOf(retryError)
        throw retryError
      }
    }
  }

  async function begin(connection, agentId = '') {
    const key = transactionKey(agentId, connection.id)
    if (transactions.has(key)) throw new Error('该连接已有进行中的事务，请先 commit 或 rollback')
    notices.delete(key)
    const entry = await open(connection)
    let runner
    try {
      runner = await entry.session.acquire()
    } catch (error) {
      entry.state = 'error'
      entry.lastError = messageOf(error)
      throw error
    }
    try {
      await runner.begin()
    } catch (error) {
      try {
        await runner.release(true)
      } catch {
        // 取连接失败时独占连接也已不可用，释放错误无需上报。
      }
      entry.state = 'error'
      entry.lastError = messageOf(error)
      throw error
    }
    const tx = { key, connectionId: connection.id, runner, startedAt: Date.now(), statements: 0, timer: undefined }
    transactions.set(key, tx)
    arm(tx)
    entry.state = 'ready'
    entry.lastError = null
    return { transaction: transactionView(tx) }
  }

  async function finish(connection, agentId, how) {
    const key = transactionKey(agentId, connection.id)
    const tx = transactions.get(key)
    if (!tx) {
      const notice = notices.get(key)
      notices.delete(key)
      throw new Error(notice ? `当前没有活动事务（${notice}）` : '当前没有活动事务，请先 begin')
    }
    transactions.delete(key)
    clearTimeout(tx.timer)
    let outcome
    let failure
    try {
      outcome = await tx.runner[how]()
    } catch (error) {
      failure = error
    }
    try {
      await tx.runner.release(failure !== undefined)
    } catch {
      // 连接已断开时释放失败不影响事务收尾。
    }
    const entry = entries.get(connection.id)
    if (entry) {
      entry.state = failure === undefined ? 'ready' : 'error'
      entry.lastError = failure === undefined ? null : messageOf(failure)
    }
    if (failure !== undefined) throw failure
    return {
      transaction: {
        active: false,
        statements: tx.statements,
        durationMs: Date.now() - tx.startedAt,
      },
      outcome: typeof outcome?.command === 'string' ? outcome.command : '',
    }
  }

  async function runScript(connection, sql, agentId = '') {
    if (typeof sql !== 'string' || sql.trim() === '') throw new Error('脚本不能为空')
    const statements = splitStatements(sql)
    if (statements.length === 0) throw new Error('脚本里没有可执行的语句')
    const started = Date.now()
    const results = []
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      try {
        const result = await exec(connection, statement, [], agentId)
        results.push({
          index: index + 1,
          sql: statement,
          columns: result.columns,
          rowCount: result.rowCount,
          durationMs: result.durationMs,
          inTransaction: result.inTransaction === true,
        })
      } catch (error) {
        results.push({ index: index + 1, sql: statement, error: messageOf(error) })
        break
      }
    }
    const failed = results.find((item) => item.error !== undefined)
    return {
      statements: results,
      total: statements.length,
      executed: results.length,
      failedAt: failed?.index ?? null,
      durationMs: Date.now() - started,
      inTransaction: transactions.has(transactionKey(agentId, connection.id)),
    }
  }

  async function status(connection, agentId = '') {
    const active = transactions.get(transactionKey(agentId, connection.id))
    const transaction = active ? transactionView(active) : null
    const entry = entries.get(connection.id)
    if (!entry) return { id: connection.id, state: 'idle', lastError: null, transaction }
    try {
      await entry.session.ping()
      return { id: connection.id, state: 'ready', lastError: null, transaction }
    } catch (error) {
      entry.lastError = messageOf(error)
      await drop(connection.id)
      try {
        const reopened = await open(connection)
        await reopened.session.ping()
        return { id: connection.id, state: 'ready', lastError: null, reconnected: true, transaction }
      } catch (retryError) {
        await drop(connection.id)
        return { id: connection.id, state: 'error', lastError: messageOf(retryError), transaction }
      }
    }
  }

  /** 列表类查询的结果映射成对象数组，供表清单与表结构组装。 */
  function rowsAsObjects(result) {
    return result.rows.map((row) => {
      const object = {}
      result.columns.forEach((column, index) => {
        object[column] = row[index]
      })
      return object
    })
  }

  async function tables(connection, options) {
    const limit = clampCount(options.limit, 100, 1, 1000)
    const offset = clampCount(options.offset, 0, 0)
    const schema = textOf(options.schema)

    if (connection.driver === 'sqlite') {
      const result = await exec(
        connection,
        "SELECT name AS table_name, type AS table_type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      const all = rowsAsObjects(result).map((row) => ({ name: row.table_name, schema: 'main', type: row.table_type }))
      return { total: all.length, offset, limit, tables: all.slice(offset, offset + limit) }
    }

    if (connection.driver === 'postgres') {
      const result = await exec(
        connection,
        "SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"
          + (schema ? ' AND table_schema = $1' : '')
          + ' ORDER BY table_schema, table_name',
        schema ? [schema] : [],
      )
      const all = rowsAsObjects(result).map((row) => ({
        name: row.table_name,
        schema: row.table_schema,
        type: row.table_type,
      }))
      return { total: all.length, offset, limit, tables: all.slice(offset, offset + limit) }
    }

    const scoped = connection.database
      ? 'TABLE_SCHEMA = ?'
      : "TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')"
    const conditions = [scoped]
    const params = connection.database ? [connection.database] : []
    if (schema) {
      conditions.push('TABLE_SCHEMA = ?')
      params.push(schema)
    }
    const result = await exec(
      connection,
      `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES WHERE ${conditions.join(' AND ')} ORDER BY TABLE_SCHEMA, TABLE_NAME`,
      params,
    )
    const all = rowsAsObjects(result).map((row) => ({
      name: row.TABLE_NAME,
      schema: row.TABLE_SCHEMA,
      type: row.TABLE_TYPE,
      rows: Number(row.TABLE_ROWS ?? 0),
    }))
    return { total: all.length, offset, limit, tables: all.slice(offset, offset + limit) }
  }

  async function primaryKeysOfPostgres(connection, table, schema) {
    const result = await exec(
      connection,
      'SELECT kcu.column_name FROM information_schema.table_constraints tc'
        + ' JOIN information_schema.key_column_usage kcu'
        + ' ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema'
        + " WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1"
        + ' AND ($2::text IS NULL OR tc.table_schema = $2)',
      [table, schema || null],
    )
    return new Set(rowsAsObjects(result).map((row) => row.column_name))
  }

  async function describe(connection, options) {
    const table = textOf(options.table)
    if (table === '') throw new Error('describe 需要 table')
    const schema = textOf(options.schema)

    if (connection.driver === 'sqlite') {
      const result = await exec(connection, `PRAGMA table_info(${quoteSqliteIdentifier(table)})`)
      const columns = rowsAsObjects(result).map((row) => ({
        name: row.name,
        type: row.type ?? '',
        nullable: Number(row.notnull) === 0,
        primaryKey: Number(row.pk) > 0,
        default: row.dflt_value ?? null,
        extra: '',
      }))
      return { table, schema: 'main', columns }
    }

    if (connection.driver === 'postgres') {
      const result = await exec(
        connection,
        'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns'
          + ' WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)'
          + ' ORDER BY ordinal_position',
        [table, schema || null],
      )
      const keys = await primaryKeysOfPostgres(connection, table, schema)
      const columns = rowsAsObjects(result).map((row) => ({
        name: row.column_name,
        type: row.data_type,
        nullable: String(row.is_nullable).toUpperCase() === 'YES',
        primaryKey: keys.has(row.column_name),
        default: row.column_default ?? null,
        extra: '',
      }))
      return { table, schema: schema || null, columns }
    }

    const result = await exec(
      connection,
      'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS'
        + " WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE()) AND TABLE_NAME = ?"
        + ' ORDER BY ORDINAL_POSITION',
      [schema, table],
    )
    const columns = rowsAsObjects(result).map((row) => ({
      name: row.COLUMN_NAME,
      type: row.DATA_TYPE,
      nullable: String(row.IS_NULLABLE).toUpperCase() === 'YES',
      primaryKey: String(row.COLUMN_KEY).toUpperCase() === 'PRI',
      default: row.COLUMN_DEFAULT ?? null,
      extra: row.EXTRA ?? '',
    }))
    return { table, schema: schema || null, columns }
  }

  async function test(connection) {
    const started = Date.now()
    let session
    try {
      session = await createSession(connection)
      await session.ping()
      return { ok: true, latencyMs: Date.now() - started }
    } finally {
      if (session) {
        try {
          await session.close()
        } catch {
          // 试连用的会话已结束，关闭错误无需上报。
        }
      }
    }
  }

  async function disposeAll() {
    for (const key of [...transactions.keys()]) {
      await abortTransaction(key, '工作进程已关闭，事务已回滚')
    }
    for (const id of [...entries.keys()]) await drop(id)
  }

  return {
    async dispatch(method, params) {
      const agentId = typeof params.agent === 'string' ? params.agent : ''
      if (method === 'exec') return exec(requireConnection(params.connection), params.sql, [], agentId)
      if (method === 'script') return runScript(requireConnection(params.connection), params.sql, agentId)
      if (method === 'begin') return begin(requireConnection(params.connection), agentId)
      if (method === 'commit') return finish(requireConnection(params.connection), agentId, 'commit')
      if (method === 'rollback') return finish(requireConnection(params.connection), agentId, 'rollback')
      if (method === 'status') return status(requireConnection(params.connection), agentId)
      if (method === 'test') return test(requireConnection(params.connection))
      if (method === 'tables') return tables(requireConnection(params.connection), params)
      if (method === 'describe') return describe(requireConnection(params.connection), params)
      if (method === 'drop') {
        await drop(String(params.id ?? ''))
        return { ok: true }
      }
      if (method === 'disposeAll') {
        await disposeAll()
        return { ok: true }
      }
      throw new Error(`未知方法：${method}`)
    },
    disposeAll,
  }
}
