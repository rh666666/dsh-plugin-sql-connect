/**
 * 连接配置存储：落在 profile 目录的 sql-connect.json，文件权限 0600。
 *
 * 密码只在本模块与驱动之间流转。describe() 与面板都拿不到明文，只说明是否已设置；
 * 保存时密码为空串表示沿用已保存的密码。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 支持的驱动标识。 */
export const DRIVERS = ['mysql', 'postgres', 'sqlite']

/** 各驱动的默认端口，SQLite 不占端口。 */
export const DEFAULT_PORTS = { mysql: 3306, postgres: 5432, sqlite: 0 }

const FILE_NAME = 'sql-connect.json'

/** 配置文件路径：profile 目录优先，缺失时退回用户级 .dsh。 */
function configFile() {
  const profile = process.env.DSH_PROFILE_DIR
  const directory = profile && profile.trim() ? profile.trim() : join(homedir(), '.dsh')
  return join(directory, FILE_NAME)
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function portOf(value, driver) {
  const given = Number(value)
  if (Number.isInteger(given) && given > 0 && given <= 65535) return given
  return DEFAULT_PORTS[driver] ?? 0
}

function defaultName(connection) {
  if (connection.driver === 'sqlite') return connection.file || 'sqlite'
  return `${connection.driver} ${connection.host || 'localhost'}`
}

/**
 * 规范化一条连接。`previous` 是已保存的同一连接，用于沿用密码与名称。
 */
function normalizeConnection(raw, previous) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const driver = DRIVERS.includes(source.driver) ? source.driver : 'mysql'
  const sqlite = driver === 'sqlite'
  const host = sqlite ? '' : text(source.host) || '127.0.0.1'
  const givenPassword = typeof source.password === 'string' ? source.password : ''
  const savedPassword = typeof previous?.password === 'string' ? previous.password : ''
  const password = givenPassword !== '' ? givenPassword : savedPassword
  const connection = {
    id: text(source.id) || text(previous?.id) || randomUUID(),
    name: '',
    driver,
    host,
    port: sqlite ? 0 : portOf(source.port, driver),
    user: sqlite ? '' : text(source.user),
    password,
    database: sqlite ? '' : text(source.database),
    file: sqlite ? text(source.file) : '',
  }
  connection.name = text(source.name) || text(previous?.name) || defaultName(connection)
  return connection
}

/** 面板可见的连接视图：不含密码明文。 */
function present(connection) {
  return {
    id: connection.id,
    name: connection.name,
    driver: connection.driver,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.database,
    file: connection.file,
    passwordSet: connection.password !== '',
  }
}

export function createConfigStore() {
  const file = configFile()
  let cached

  async function load() {
    if (cached) return cached
    let raw = {}
    try {
      raw = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      raw = {}
    }
    const list = raw && Array.isArray(raw.connections) ? raw.connections : []
    const seen = new Set()
    const connections = []
    for (const item of list) {
      const connection = normalizeConnection(item)
      if (seen.has(connection.id)) continue
      seen.add(connection.id)
      connections.push(connection)
    }
    cached = { connections }
    return cached
  }

  async function persist(state) {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, `${JSON.stringify({ connections: state.connections }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, file)
  }

  async function describe() {
    const state = await load()
    return {
      connections: state.connections.map(present),
      drivers: DRIVERS,
      defaultPorts: DEFAULT_PORTS,
    }
  }

  async function find(id) {
    const state = await load()
    return state.connections.find((item) => item.id === id)
  }

  async function findNamed(query) {
    const state = await load()
    const target = text(query)
    if (!target) return undefined
    const lower = target.toLowerCase()
    return (
      state.connections.find((item) => item.id === target) ??
      state.connections.find((item) => item.name === target) ??
      state.connections.find((item) => item.name.toLowerCase() === lower)
    )
  }

  return {
    describe,
    find,
    findNamed,

    /**
     * 把请求里的连接补成完整连接，密码留空时沿用已保存的值。
     *
     * @param {object} input 请求里的连接对象
     */
    async resolve(input) {
      const state = await load()
      const requestedId = text(input?.id)
      const previous = requestedId ? state.connections.find((item) => item.id === requestedId) : undefined
      return normalizeConnection(input, previous)
    },

    /**
     * 新增或更新一条连接，返回更新后的连接视图与本条记录的 id。
     *
     * @param {object} input 请求里的连接对象
     */
    async save(input) {
      const state = await load()
      const requestedId = text(input?.id)
      const previous = requestedId ? state.connections.find((item) => item.id === requestedId) : undefined
      if (requestedId && !previous) throw new Error(`连接不存在：${requestedId}`)
      const connection = normalizeConnection(input, previous)
      const connections = previous
        ? state.connections.map((item) => (item.id === connection.id ? connection : item))
        : [...state.connections, connection]
      await persist({ connections })
      cached = { connections }
      return { ...(await describe()), connectionId: connection.id }
    },

    /**
     * 删除一条连接。
     *
     * @param {string} id 连接 id
     */
    async remove(id) {
      const state = await load()
      const target = text(id)
      if (!target) throw new Error('缺少连接 id')
      const connections = state.connections.filter((item) => item.id !== target)
      if (connections.length === state.connections.length) throw new Error(`连接不存在：${target}`)
      await persist({ connections })
      cached = { connections }
      return describe()
    },
  }
}
