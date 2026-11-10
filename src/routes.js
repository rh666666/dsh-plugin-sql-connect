/**
 * 工作台的 HTTP 端点：POST /_sql-connect/api，请求体是 `{ action, ...参数 }`。
 *
 * 只接受同源请求；单次响应最多回传 500 行，超出部分写入 CSV 并回传路径。
 */

import { safeValue, writeCsv } from './export.js'

const API_PATH = '/_sql-connect/api'
const MAX_BODY_BYTES = 256 * 1024
const MAX_ROWS = 500

function messageOf(error) {
  return String(error?.message ?? error)
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let failed = false
    req.on('data', (chunk) => {
      if (failed) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        failed = true
        reject(new Error('请求体过大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

async function queryResult(result, connectionName) {
  const truncated = result.rows.length > MAX_ROWS
  const rows = result.rows.slice(0, MAX_ROWS).map((row) => row.map(safeValue))
  let exportPath = null
  if (truncated && result.columns.length > 0) {
    try {
      exportPath = await writeCsv({ connectionName, columns: result.columns, rows: result.rows })
    } catch {
      exportPath = null
    }
  }
  return {
    columns: result.columns,
    rows,
    rowCount: result.rowCount,
    truncated,
    exportPath,
    durationMs: result.durationMs,
    reconnected: result.reconnected === true,
  }
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`)
  return value
}

async function dispatch(payload, store, manager) {
  const action = String(payload.action ?? '')
  if (action === 'list') return store.describe()
  if (action === 'save') return store.save(requireObject(payload.connection, 'connection'))
  if (action === 'remove') {
    const id = String(payload.id ?? '')
    await manager.drop(id)
    return store.remove(id)
  }
  if (action === 'test') {
    const connection = await store.resolve(requireObject(payload.connection, 'connection'))
    return manager.test(connection)
  }
  if (action === 'status') return manager.status(String(payload.id ?? ''))
  if (action === 'disconnect') {
    await manager.drop(String(payload.id ?? ''))
    return { ok: true }
  }
  if (action === 'query') {
    const id = String(payload.id ?? '')
    const connection = await store.find(id)
    const result = await manager.exec(id, payload.sql)
    return queryResult(result, connection?.name ?? id)
  }
  throw new Error(`未知 action：${action}`)
}

async function respond(req, res, store, manager) {
  if (!sameOrigin(req)) {
    sendJson(res, 403, { error: '跨站请求被拒绝' })
    return
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    sendJson(res, 405, { error: '只支持 POST' })
    return
  }
  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch (error) {
    sendJson(res, 400, { error: `请求体不是合法 JSON：${messageOf(error)}` })
    return
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    sendJson(res, 400, { error: '请求体必须是对象' })
    return
  }
  try {
    sendJson(res, 200, await dispatch(payload, store, manager))
  } catch (error) {
    const body = { error: messageOf(error) }
    if (typeof error?.code === 'string') body.code = error.code
    sendJson(res, 500, body)
  }
}

/**
 * @param {{ register: (route: object) => () => void }} webServer
 * @param {ReturnType<import('./config.js').createConfigStore>} store
 * @param {ReturnType<import('./manager.js').createManager>} manager
 */
export function registerSqlRoute(webServer, store, manager) {
  return webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: (req, res) => respond(req, res, store, manager),
  })
}
