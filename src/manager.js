/**
 * Host 侧的连接门面：从配置读出连接参数，实际执行交给 SQL 工作进程。
 *
 * Host 进程访问内网数据库会被系统网络策略拒绝，因此所有驱动操作都在工作进程内完成。
 * agentId 标识事务归属，面板调用不传，因此不会进入助手的事务。
 */

import { createWorkerClient } from './worker-client.js'

export function createManager(store) {
  const worker = createWorkerClient()

  async function requireConnection(id) {
    const connection = await store.find(id)
    if (!connection) throw new Error(`连接不存在：${id}`)
    return connection
  }

  return {
    /**
     * 执行一条 SQL。
     *
     * @param {string} id 连接 id
     * @param {string} sql 待执行的 SQL
     * @param {string} [agentId] 调用方标识，属于事务归属的一部分
     */
    async exec(id, sql, agentId) {
      const connection = await requireConnection(id)
      return worker.call('exec', { connection, sql, agent: agentId ?? '' })
    },

    /**
     * 逐条执行脚本，遇错停止。
     *
     * @param {string} id 连接 id
     * @param {string} sql 脚本文本
     * @param {string} [agentId] 调用方标识，属于事务归属的一部分
     */
    async script(id, sql, agentId) {
      const connection = await requireConnection(id)
      return worker.call('script', { connection, sql, agent: agentId ?? '' })
    },

    /**
     * 在独占连接上开启事务。
     *
     * @param {string} id 连接 id
     * @param {string} [agentId] 调用方标识
     */
    async begin(id, agentId) {
      const connection = await requireConnection(id)
      return worker.call('begin', { connection, agent: agentId ?? '' })
    },

    /**
     * 提交当前事务。
     *
     * @param {string} id 连接 id
     * @param {string} [agentId] 调用方标识
     */
    async commit(id, agentId) {
      const connection = await requireConnection(id)
      return worker.call('commit', { connection, agent: agentId ?? '' })
    },

    /**
     * 回滚当前事务。
     *
     * @param {string} id 连接 id
     * @param {string} [agentId] 调用方标识
     */
    async rollback(id, agentId) {
      const connection = await requireConnection(id)
      return worker.call('rollback', { connection, agent: agentId ?? '' })
    },

    /**
     * 探测连接状态；工作进程内会自动重建失效的会话。
     *
     * @param {string} id 连接 id
     * @param {string} [agentId] 调用方标识
     */
    async status(id, agentId) {
      const connection = await requireConnection(id)
      return worker.call('status', { connection, agent: agentId ?? '' })
    },

    /**
     * 用给定的连接参数试连一次。
     *
     * @param {object} connection 已规范化的连接
     */
    async test(connection) {
      return worker.call('test', { connection })
    },

    /**
     * 列出连接下的表与视图。
     *
     * @param {string} id 连接 id
     * @param {{ schema?: string, limit?: number, offset?: number }} options
     */
    async tables(id, options) {
      const connection = await requireConnection(id)
      return worker.call('tables', { connection, ...options })
    },

    /**
     * 查看一张表的列定义。
     *
     * @param {string} id 连接 id
     * @param {{ table: string, schema?: string }} options
     */
    async describe(id, options) {
      const connection = await requireConnection(id)
      return worker.call('describe', { connection, ...options })
    },

    async drop(id) {
      if (!worker.isRunning()) return
      try {
        await worker.call('drop', { id })
      } catch {
        // 工作进程已退出时会话随之消失，删除连接不受影响。
      }
    },

    async disposeAll() {
      await worker.dispose()
    },
  }
}
