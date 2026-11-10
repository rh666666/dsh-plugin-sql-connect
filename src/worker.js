/**
 * SQL 工作进程：连接数据库并执行 SQL，经 stdin/stdout 的 JSON 行与 Host 通信。
 *
 * 单独成进程的原因：Host 进程访问内网数据库被系统网络策略拒绝，子进程不受该限制。
 * 协议：请求 `{ id, method, params }`，响应 `{ id, ok: true, value }` 或 `{ id, ok: false, error }`。
 */

import { createInterface } from 'node:readline'
import { createSessionManager } from './sessions.js'

const sessions = createSessionManager()
const reader = createInterface({ input: process.stdin, terminal: false })

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function errorOf(error) {
  const body = { message: String(error?.message ?? error) }
  if (typeof error?.code === 'string') body.code = error.code
  return body
}

async function handle(line) {
  let request
  try {
    request = JSON.parse(line)
  } catch (error) {
    reply({ id: null, ok: false, error: errorOf(new Error(`请求不是合法 JSON：${String(error?.message ?? error)}`)) })
    return
  }
  try {
    const value = await sessions.dispatch(request.method, request.params ?? {})
    reply({ id: request.id, ok: true, value })
  } catch (error) {
    reply({ id: request.id, ok: false, error: errorOf(error) })
  }
}

reader.on('line', (line) => {
  if (line.trim() === '') return
  void handle(line)
})

reader.on('close', () => {
  void sessions.disposeAll().finally(() => {
    process.exit(0)
  })
})

process.on('uncaughtException', (error) => {
  process.stderr.write(`sql worker uncaught: ${String(error?.stack ?? error)}\n`)
})
