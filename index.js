/**
 * Host 半入口：注册工作台的 HTTP 端点，进程内维护连接与自动重连。
 */

import { createConfigStore } from './src/config.js'
import { createManager } from './src/manager.js'
import { registerSqlRoute } from './src/routes.js'
import { registerDatabaseTool } from './src/tools.js'

/** Loader 条目标识，与包名一致。 */
export const name = 'sql-connect'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const store = createConfigStore()
  const manager = createManager(store)

  ctx.effect(() => () => {
    void manager.disposeAll()
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerSqlRoute(webCtx.webServer, store, manager))
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(() => registerDatabaseTool(toolCtx, store, manager))
  })
}
