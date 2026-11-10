/**
 * SQL 脚本处理：按语句切分，并按路径读取脚本文本。
 *
 * 分号是唯一分隔符；引号、行注释、块注释与 PostgreSQL 美元引号内的分号不切分。
 * MySQL 的 DELIMITER 指令不在此处理。
 */

import { readFile, stat } from 'node:fs/promises'

const MAX_SCRIPT_BYTES = 1024 * 1024

/**
 * 把整段脚本切成单条语句，去掉空白与纯注释段。
 *
 * @param {string} sql 脚本文本
 * @returns {string[]} 语句列表
 */
export function splitStatements(sql) {
  const statements = []
  let current = ''
  let hasCode = false
  let mode = 'code'
  let dollarTag = ''
  let index = 0

  const push = () => {
    const text = current.trim()
    if (hasCode && text !== '') statements.push(text)
    current = ''
    hasCode = false
  }

  while (index < sql.length) {
    const char = sql[index]
    const next = sql[index + 1]

    if (mode === 'code') {
      if (char === '-' && next === '-') {
        mode = 'line'
        current += char + next
        index += 2
        continue
      }
      if (char === '/' && next === '*') {
        mode = 'block'
        current += char + next
        index += 2
        continue
      }
      if (char === "'" || char === '"' || char === '`') {
        mode = char === "'" ? 'single' : char === '"' ? 'double' : 'backtick'
        hasCode = true
        current += char
        index += 1
        continue
      }
      if (char === '$') {
        const match = /^(?:\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)/.exec(sql.slice(index))
        if (match) {
          mode = 'dollar'
          dollarTag = match[0]
          hasCode = true
          current += dollarTag
          index += dollarTag.length
          continue
        }
      }
      if (char === ';') {
        push()
        index += 1
        continue
      }
      if (!/\s/.test(char)) hasCode = true
      current += char
      index += 1
      continue
    }

    if (mode === 'line') {
      current += char
      index += 1
      if (char === '\n') mode = 'code'
      continue
    }

    if (mode === 'block') {
      if (char === '*' && next === '/') {
        current += '*/'
        index += 2
        mode = 'code'
        continue
      }
      current += char
      index += 1
      continue
    }

    if (mode === 'dollar') {
      if (sql.startsWith(dollarTag, index)) {
        current += dollarTag
        index += dollarTag.length
        mode = 'code'
        continue
      }
      current += char
      index += 1
      continue
    }

    const quote = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
    if (char === '\\' && mode !== 'backtick') {
      current += char + (next ?? '')
      index += 2
      continue
    }
    if (char === quote) {
      if (next === quote) {
        current += char + next
        index += 2
        continue
      }
      current += char
      index += 1
      mode = 'code'
      continue
    }
    current += char
    index += 1
  }

  push()
  return statements
}

/**
 * 读取 .sql 脚本文件，去掉 UTF-8 BOM。
 *
 * @param {string} path 脚本文件路径
 * @returns {Promise<string>} 脚本文本
 */
export async function readScriptFile(path) {
  const file = String(path ?? '').trim()
  if (file === '') throw new Error('缺少脚本文件路径')
  if (!/\.sql$/i.test(file)) throw new Error('脚本文件必须是 .sql 文件')
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`脚本路径不是文件：${file}`)
  if (info.size > MAX_SCRIPT_BYTES) {
    throw new Error(`脚本文件超过 ${MAX_SCRIPT_BYTES / 1024} KB：${file}`)
  }
  const text = await readFile(file, 'utf8')
  return text.replace(/^\uFEFF/, '')
}
