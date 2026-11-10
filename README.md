# dsh-plugin-sql-connect

DSH（DeepSeek Harness）的 SQL 客户端：在侧栏面板里管理 MySQL、PostgreSQL、SQLite 连接并执行 SQL，同时把同一批连接交给 Agent 的 `database` 工具。

## 使用

点侧栏底部的 **SQL 客户端** 打开工作台：左侧维护连接（新建、编辑、测试、断开、删除），右侧输入 SQL，`Ctrl + Enter` 执行。结果最多显示 500 行，超出时完整结果写入 CSV 并给出路径。

## Agent 工具

工具名 `database`，按 `action` 调用，`connection` 传连接名称或 id：

| action | 作用 |
| --- | --- |
| `connections` | 列出面板里已保存的连接 |
| `status` | 探测连接状态与未结束的事务 |
| `tables` / `describe` | 列出表与视图 / 查看列定义 |
| `query` | 执行一条 SQL |
| `script` | 按分号切分逐条执行（`sql` 或 `file`，遇错停止） |
| `begin` / `commit` / `rollback` | 控制事务 |

事务按「连接 + 调用方」隔离：`begin` 之后对同一连接的 `query`、`script` 都在事务内，面板查询不受影响；事务 10 分钟无操作自动回滚。连接级故障会自动重连并重试一次。

## 安装

```bash
dsh plugin --profile <profile> add dsh-plugin-sql-connect
```

也可以在 **设置 → 插件 → 添加插件** 里填包名。

从源码安装时先 `pnpm install`（`mysql2`、`pg` 是运行时依赖），再用 `plugin_manager action=install_bundle target=<本目录>` 挂载。

SQLite 走 Node 内置的 `node:sqlite`，要求 Host 运行时 ≥ 22.5。所有驱动操作都在独立的工作进程里执行——Host 进程访问内网数据库会被系统网络策略拒绝。

## 配置与数据

- 连接保存在 profile 目录的 `sql-connect.json`，权限 `0600`；密码不回传给面板与模型，编辑时留空表示沿用已保存的密码。
- 结果被截断时导出到 profile 目录下的 `sql-connect-exports/`（UTF-8 带 BOM，便于 Excel 打开）。
- 面板接口 `POST /_sql-connect/api` 只接受同源 POST，请求体上限 256 KB。

## 开发

无构建步骤：`index.js` 是 Host 入口，`client.js` 是手写的前端半，`src/` 放配置、驱动、路由、工具与工作进程。改完在 DSH 里重新加载插件即可。

## License

MIT
