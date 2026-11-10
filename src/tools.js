/**
 * 模型可调用的 database 工具：按 action 查看连接、执行 SQL 与脚本、控制事务。
 *
 * 连接取自面板里已保存的配置，工具参数里不出现密码；连接的新增与删除仍由用户在面板里完成。
 * 事务按连接与调用方隔离，面板里的查询不进入助手的事务。
 */

import { isAbsolute, resolve } from 'node:path'
import { safeValue, writeCsv } from './export.js'
import { readScriptFile } from './script.js'

const ACTIONS = ['connections', 'status', 'tables', 'describe', 'query', 'script', 'begin', 'commit', 'rollback']

const ACTION_GUIDE = [
  'connections：列出面板里已保存的连接，返回名称、类型与目标。',
  'status：探测某个连接是否可用，并返回该连接上未结束的事务。',
  'tables：列出某个连接下的表与视图，可传 schema、limit、offset。',
  'describe：查看一张表的列定义，可传 schema。',
  'query：执行一条 SQL，返回列与行；写操作返回影响行数。',
  'script：逐条执行多语句脚本，遇错停止；脚本用 sql 文本或 file 路径传入。',
  'begin：在该连接上开启事务，之后再执行的 query 与 script 都落在事务内。',
  'commit：提交当前事务。',
  'rollback：回滚当前事务。',
].join('\n')

const MAX_TEXT_ROWS = 40
const MAX_CELL_CHARS = 60
const MAX_SQL_CHARS = 80

function clipCell(value) {
  if (value === null) return 'NULL'
  const text = String(value).replaceAll('\n', ' ').replaceAll('|', '\\|')
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text
}

function cellText(value) {
  const safe = safeValue(value)
  return safe === null ? '' : String(safe)
}

function clipSql(statement) {
  const single = statement.replace(/\s+/g, ' ').trim()
  return single.length > MAX_SQL_CHARS ? `${single.slice(0, MAX_SQL_CHARS)}…` : single
}

function targetOf(connection) {
  if (connection.driver === 'sqlite') return connection.file || '（未填文件）'
  const database = connection.database ? `/${connection.database}` : ''
  return `${connection.host}:${connection.port}${database}`
}

function renderExecution(name, result) {
  const notes = [`连接 ${name}，耗时 ${result.durationMs} ms`]
  if (result.reconnected) notes.push('连接曾断开，已自动重连并重试')
  if (result.inTransaction) notes.push('当前在事务中')
  if (result.columns.length === 0) {
    return `${notes.join('；')}，影响 ${result.rowCount} 行。`
  }
  const header = `| ${result.columns.join(' | ')} |`
  const divider = `| ${result.columns.map(() => '---').join(' | ')} |`
  const body = result.rows
    .slice(0, MAX_TEXT_ROWS)
    .map((row) => `| ${row.map((cell) => clipCell(cell)).join(' | ')} |`)
  const omitted = result.rows.length > MAX_TEXT_ROWS
    ? `\n…共 ${result.rowCount} 行，只显示前 ${MAX_TEXT_ROWS} 行。`
    : ''
  const exported = result.exportPath ? `\n完整结果已保存：${result.exportPath}` : ''
  return `${notes.join('；')}，返回 ${result.rowCount} 行：\n${[header, divider, ...body].join('\n')}${omitted}${exported}`
}

function renderScript(name, result) {
  const lines = result.statements.map((item) => {
    if (item.error !== undefined) return `${item.index}. 失败：${item.error}\n   ${clipSql(item.sql)}`
    const outcome = item.columns.length > 0 ? `返回 ${item.rowCount} 行` : `影响 ${item.rowCount} 行`
    return `${item.index}. ${outcome}，${item.durationMs} ms`
  })
  const head = result.failedAt === null
    ? `连接 ${name}，脚本共 ${result.total} 条语句全部执行，耗时 ${result.durationMs} ms`
    : `连接 ${name}，脚本共 ${result.total} 条语句，执行到第 ${result.failedAt} 条失败，耗时 ${result.durationMs} ms`
  const pending = result.inTransaction ? '\n事务仍在进行中，由 commit 或 rollback 收尾。' : ''
  return `${head}：\n${lines.join('\n')}${pending}`
}

async function listConnections(store, action) {
  const view = await store.describe()
  const connections = view.connections.map((connection) => ({
    id: connection.id,
    name: connection.name,
    driver: connection.driver,
    target: targetOf(connection),
  }))
  if (connections.length === 0) {
    return { ok: true, action, data: { connections }, text: '面板里还没有连接，请先在 SQL 工作台里新建。' }
  }
  const lines = connections.map((connection) => `${connection.name}（${connection.driver}）→ ${connection.target}`)
  return {
    ok: true,
    action,
    data: { connections },
    text: `面板里共 ${connections.length} 个连接：\n${lines.join('\n')}`,
  }
}

async function connectionNames(store) {
  const view = await store.describe()
  if (view.connections.length === 0) return '（无）'
  return view.connections.map((connection) => connection.name).join('、')
}

/** 脚本文件路径：相对路径按会话工作目录解析，取不到时按 Host 当前目录。 */
async function resolveScriptPath(ctx, exec, file) {
  const target = String(file ?? '').trim()
  if (target === '') throw new Error('缺少脚本文件路径')
  if (isAbsolute(target)) return target
  let directory
  try {
    directory = await ctx.get('workingDirectory')?.ensure(exec?.agent, exec?.signal)
  } catch {
    directory = undefined
  }
  return directory ? resolve(directory, target) : resolve(target)
}

async function runScript(input, exec, ctx, manager, connection, agentId) {
  const file = typeof input.file === 'string' ? input.file.trim() : ''
  let text = typeof input.sql === 'string' ? input.sql : ''
  if (file !== '') {
    if (text.trim() !== '') throw new Error('script 的 sql 与 file 只能选一个')
    text = await readScriptFile(await resolveScriptPath(ctx, exec, file))
  }
  if (text.trim() === '') throw new Error('script 需要 sql 或 file')
  const result = await manager.script(connection.id, text, agentId)
  return {
    ok: result.failedAt === null,
    action: 'script',
    data: result,
    text: renderScript(connection.name, result),
  }
}

async function runAction(action, input, exec, ctx, store, manager) {
  if (action === 'connections') return listConnections(store, action)

  const target = typeof input.connection === 'string' ? input.connection.trim() : ''
  if (target === '') return { ok: false, action, text: `${action} 需要 connection，取值为连接名称或 id。` }
  const connection = await store.findNamed(target)
  if (!connection) {
    return { ok: false, action, text: `找不到连接「${target}」。可用连接：${await connectionNames(store)}` }
  }
  const agentId = typeof exec?.agent?.id === 'string' ? exec.agent.id : ''

  if (action === 'status') {
    const status = await manager.status(connection.id, agentId)
    const label = status?.state === 'ready' ? '已连接' : status?.state === 'error' ? '连接异常' : '未连接'
    const detail = status?.lastError ? `（${status.lastError}）` : ''
    const active = status?.transaction?.active
      ? `；有进行中的事务（已执行 ${status.transaction.statements} 条语句，已开启 ${Math.round(status.transaction.durationMs / 1000)} 秒）`
      : ''
    return { ok: true, action, data: status, text: `连接 ${connection.name}：${label}${detail}${active}` }
  }

  if (action === 'tables') {
    const view = await manager.tables(connection.id, {
      schema: input.schema,
      limit: input.limit,
      offset: input.offset,
    })
    if (view.tables.length === 0) {
      return { ok: true, action, data: view, text: `连接 ${connection.name} 下没有表。` }
    }
    const lines = view.tables.map((table) => {
      const prefix = table.schema ? `${table.schema}.` : ''
      const rows = typeof table.rows === 'number' ? ` 约 ${table.rows} 行` : ''
      return `${prefix}${table.name} [${table.type}]${rows}`
    })
    const shown = view.tables.length < view.total ? `，本次返回 ${view.tables.length} 个` : ''
    return {
      ok: true,
      action,
      data: view,
      text: `连接 ${connection.name} 共 ${view.total} 个表${shown}：\n${lines.join('\n')}`,
    }
  }

  if (action === 'describe') {
    const table = typeof input.table === 'string' ? input.table.trim() : ''
    if (table === '') return { ok: false, action, text: 'describe 需要 table。' }
    const view = await manager.describe(connection.id, { table, schema: input.schema })
    if (view.columns.length === 0) {
      return { ok: false, action, text: `表「${table}」不存在或没有可见列。` }
    }
    const lines = view.columns.map((column) => {
      const flags = [column.nullable ? '可空' : '非空', column.primaryKey ? '主键' : ''].filter(Boolean).join('，')
      const fallback = column.default === null ? '' : ` 默认 ${String(column.default)}`
      const extra = column.extra ? ` ${column.extra}` : ''
      return `${column.name} ${column.type}（${flags}）${fallback}${extra}`
    })
    const prefix = view.schema ? `${view.schema}.` : ''
    return {
      ok: true,
      action,
      data: view,
      text: `表 ${prefix}${table} 共 ${view.columns.length} 列：\n${lines.join('\n')}`,
    }
  }

  if (action === 'script') return runScript(input, exec, ctx, manager, connection, agentId)

  if (action === 'begin') {
    const result = await manager.begin(connection.id, agentId)
    return {
      ok: true,
      action,
      data: result,
      text: `事务已开始：连接 ${connection.name}。之后对同一连接执行 query 或 script 都落在该事务内，用 commit 提交、rollback 回滚。`,
    }
  }

  if (action === 'commit') {
    const result = await manager.commit(connection.id, agentId)
    const text = result.outcome === 'ROLLBACK'
      ? `事务已结束：连接 ${connection.name} 上的事务处于失败状态，数据库实际执行的是回滚，共 ${result.transaction.statements} 条语句，耗时 ${result.transaction.durationMs} ms。`
      : `事务已提交：连接 ${connection.name}，共 ${result.transaction.statements} 条语句，耗时 ${result.transaction.durationMs} ms。`
    return { ok: true, action, data: result, text }
  }

  if (action === 'rollback') {
    const result = await manager.rollback(connection.id, agentId)
    return {
      ok: true,
      action,
      data: result,
      text: `事务已回滚：连接 ${connection.name}，共执行过 ${result.transaction.statements} 条语句，改动已全部撤销，耗时 ${result.transaction.durationMs} ms。`,
    }
  }

  const sql = typeof input.sql === 'string' ? input.sql : ''
  if (sql.trim() === '') return { ok: false, action, text: 'query 需要 sql。' }
  const result = await manager.exec(connection.id, sql, agentId)
  const truncated = result.rows.length > MAX_TEXT_ROWS
  const clipped = result.rows.some((row) => row.some((cell) => cellText(cell).length > MAX_CELL_CHARS))
  let exportPath = null
  if (result.columns.length > 0 && (truncated || clipped)) {
    try {
      exportPath = await writeCsv({ connectionName: connection.name, columns: result.columns, rows: result.rows })
    } catch {
      exportPath = null
    }
  }
  const data = {
    columns: result.columns,
    rows: result.rows.slice(0, MAX_TEXT_ROWS).map((row) => row.map(safeValue)),
    rowCount: result.rowCount,
    truncated,
    exportPath,
    durationMs: result.durationMs,
    reconnected: result.reconnected === true,
    inTransaction: result.inTransaction === true,
  }
  return { ok: true, action, data, text: renderExecution(connection.name, { ...result, exportPath }) }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<import('./config.js').createConfigStore>} store
 * @param {ReturnType<import('./manager.js').createManager>} manager
 * @returns {() => void} 注销函数
 */
export function registerDatabaseTool(ctx, store, manager) {
  return ctx.tools.register({
    name: 'database',
    description: '操作 SQL 客户端面板里已配置的数据库连接（MySQL、PostgreSQL、SQLite），按 action 逐次调用。'
      + ACTION_GUIDE
      + 'connection 传连接名称或 id；连接由用户在面板里维护，工具不改配置，也不需要密码。'
      + '事务按连接与调用方隔离：begin 之后同一连接的 query 与 script 落在同一事务内，由 commit 或 rollback 收尾；'
      + '面板里的查询不受事务影响；事务超过 10 分钟没有操作会被自动回滚。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: '要执行的动作。',
        },
        connection: {
          type: 'string',
          description: '连接名称或 id。connections 之外都必填。',
        },
        sql: {
          type: 'string',
          description: 'query 要执行的 SQL；script 的脚本文本，与 file 二选一。脚本按分号切分，遇错停止。',
        },
        file: {
          type: 'string',
          description: 'script 的 .sql 文件路径；相对路径按会话工作目录解析，最大 1 MB。',
        },
        table: {
          type: 'string',
          description: 'describe 时的表名。',
        },
        schema: {
          type: 'string',
          description: 'tables、describe 可选的模式名，PostgreSQL 常用。',
        },
        limit: {
          type: 'number',
          description: 'tables 返回条数上限，默认 100。',
        },
        offset: {
          type: 'number',
          description: 'tables 跳过的条数，默认 0。',
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', description: '本次调用是否成功' },
          action: { type: 'string', description: '本次动作' },
          text: { type: 'string', description: '给模型读的正文' },
          data: { description: '结构化结果' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '(无输出)') }],
    },
    async execute(args, exec) {
      const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
      const action = typeof input.action === 'string' ? input.action.trim() : ''
      if (!ACTIONS.includes(action)) {
        return { ok: false, action, text: `action 必须是 ${ACTIONS.join('、')} 之一，收到「${action || '空'}」。` }
      }
      try {
        return await runAction(action, input, exec, ctx, store, manager)
      } catch (error) {
        return { ok: false, action, text: `调用失败：${String(error?.message ?? error)}` }
      }
    },
  })
}
