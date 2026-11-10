/**
 * 查询结果导出：结果被截断时把完整行集写成 CSV，返回文件路径。
 *
 * 文件落在 profile 目录下的 sql-connect-exports，文件名带时间戳与连接名，UTF-8 带 BOM 便于 Excel 打开。
 */

import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const EXPORT_DIR_NAME = 'sql-connect-exports'
const MAX_NAME_CHARS = 40

function exportDirectory() {
  const profile = process.env.DSH_PROFILE_DIR
  const base = profile && profile.trim() ? profile.trim() : join(homedir(), '.dsh')
  return join(base, EXPORT_DIR_NAME)
}

function timestamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function safeName(value) {
  const text = String(value ?? '').replace(/[\\/:*?"<>|\s]+/gu, '_').slice(0, MAX_NAME_CHARS)
  return text === '' ? 'result' : text
}

/** 把驱动返回的值转成可 JSON 序列化的形式。 */
export function safeValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return value
}

function csvCell(value) {
  const safe = safeValue(value)
  if (safe === null) return ''
  const text = String(safe)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * 把完整结果写成 CSV。
 *
 * @param {{ connectionName?: string, columns: string[], rows: unknown[][] }} input
 * @returns {Promise<string>} 文件绝对路径
 */
export async function writeCsv({ connectionName, columns, rows }) {
  const directory = exportDirectory()
  await mkdir(directory, { recursive: true })
  const file = join(directory, `${timestamp()}-${safeName(connectionName)}-${randomBytes(3).toString('hex')}.csv`)
  const lines = [columns.map(csvCell).join(',')]
  for (const row of rows) lines.push(row.map(csvCell).join(','))
  await writeFile(file, `\uFEFF${lines.join('\r\n')}\r\n`, { encoding: 'utf8' })
  return file
}
