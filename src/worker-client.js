/**
 * SQL 工作进程的客户端：按需拉起进程，把请求与响应按 id 配对。
 *
 * 进程退出或启动失败时，未完成的请求立即失败；下一次调用会重新拉起进程。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const WORKER_SCRIPT = fileURLToPath(new URL('./worker.js', import.meta.url))
const REQUEST_TIMEOUT_MS = 180000

/** 工作进程优先用 DSH 自带的独立 node 运行时，避免依赖 PATH。 */
function resolveNodeExecutable() {
  const candidates = [
    join(
      dirname(process.execPath),
      'resources',
      'runtime',
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      'node.exe',
    ),
    process.env.DSH_DESKTOP_NODE_EXECUTABLE,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '' && existsSync(candidate)) return candidate
  }
  return 'node'
}

export function createWorkerClient() {
  let child
  let stderrTail = ''
  let sequence = 0
  const pending = new Map()

  function failAll(reason) {
    const entries = [...pending.values()]
    pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
  }

  function start() {
    if (child) return child
    const executable = resolveNodeExecutable()
    const next = spawn(executable, [WORKER_SCRIPT], {
      cwd: dirname(WORKER_SCRIPT),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    stderrTail = ''

    const lines = createInterface({ input: next.stdout, terminal: false })
    lines.on('line', (line) => {
      if (line.trim() === '') return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.ok) {
        entry.resolve(message.value)
        return
      }
      const error = new Error(message.error?.message ?? 'SQL 工作进程返回错误')
      if (typeof message.error?.code === 'string') error.code = message.error.code
      entry.reject(error)
    })

    next.stderr.on('data', (chunk) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-4000)
    })

    next.on('error', (error) => {
      if (child === next) child = undefined
      lines.close()
      failAll(`SQL 工作进程启动失败：${String(error?.message ?? error)}`)
    })

    next.on('exit', (code) => {
      if (child === next) child = undefined
      lines.close()
      const detail = stderrTail.trim() === '' ? '' : `：${stderrTail.trim()}`
      failAll(`SQL 工作进程已退出（code ${String(code)}）${detail}`)
    })

    child = next
    return next
  }

  function call(method, params) {
    let target
    try {
      target = start()
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('SQL 工作进程响应超时'))
      }, REQUEST_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      try {
        target.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async function dispose() {
    const target = child
    if (!target) return
    failAll('SQL 工作进程已关闭')
    child = undefined
    const exited = new Promise((resolve) => {
      target.once('exit', resolve)
      setTimeout(resolve, 2000)
    })
    target.stdin.end()
    target.kill()
    await exited
  }

  return { call, dispose, isRunning: () => child !== undefined }
}
