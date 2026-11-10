/**
 * Client 半：侧栏底部的 SQL 入口与浮层工作台。
 *
 * 所有数据库操作都经 Host 的 /_sql-connect/api 完成；浏览器不直接连数据库。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-sql-connect',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sql-connect'
    const API_URL = '/_sql-connect/api'
    const MAX_ROWS = 500

    const zh = {
      'action.title': 'SQL 客户端',
      'panel.title': 'SQL 工作台',
      'panel.close': '关闭',
      'list.title': '连接',
      'list.new': '新建连接',
      'list.empty': '还没有连接，点上方"新建连接"。',
      'driver.mysql': 'MySQL',
      'driver.postgres': 'PostgreSQL',
      'driver.sqlite': 'SQLite',
      'form.title.new': '新建连接',
      'form.title.edit': '连接设置',
      'form.name': '名称',
      'form.driver': '类型',
      'form.host': '主机',
      'form.port': '端口',
      'form.user': '用户名',
      'form.password': '密码',
      'form.passwordSetHint': '已保存密码，留空表示不修改',
      'form.database': '数据库',
      'form.databaseHint': '留空表示不指定默认数据库',
      'form.file': '数据库文件',
      'form.fileHint': 'SQLite 数据库文件的绝对路径',
      'form.save': '保存',
      'form.test': '测试连接',
      'form.disconnect': '断开',
      'form.delete': '删除',
      'query.placeholder': '输入 SQL，Ctrl + Enter 执行',
      'query.run': '执行',
      'query.running': '执行中…',
      'query.empty': '执行结果会显示在这里。',
      'result.rows': '{count} 行',
      'result.affected': '影响 {count} 行',
      'result.time': '耗时 {ms} ms',
      'result.truncated': '超过 {count} 行，已截断',
      'result.exported': '完整结果已保存：{path}',
      'result.reconnected': '连接已断开，自动重连后重试成功。',
      'state.idle': '未连接',
      'state.ready': '已连接',
      'state.reconnecting': '重连中',
      'state.error': '连接异常',
      'message.saved': '已保存。',
      'message.deleted': '已删除。',
      'message.testOk': '连接成功，{ms} ms。',
      'message.testFailed': '连接失败：{message}',
      'message.disconnected': '已断开。',
      'message.needSave': '先保存连接，再执行 SQL。',
      'error.load': '读取连接配置失败：{message}',
      'error.save': '保存失败：{message}',
      'error.remove': '删除失败：{message}',
    }

    const en = {
      'action.title': 'SQL client',
      'panel.title': 'SQL workbench',
      'panel.close': 'Close',
      'list.title': 'Connections',
      'list.new': 'New connection',
      'list.empty': 'No connections yet. Use "New connection" above.',
      'driver.mysql': 'MySQL',
      'driver.postgres': 'PostgreSQL',
      'driver.sqlite': 'SQLite',
      'form.title.new': 'New connection',
      'form.title.edit': 'Connection settings',
      'form.name': 'Name',
      'form.driver': 'Type',
      'form.host': 'Host',
      'form.port': 'Port',
      'form.user': 'User',
      'form.password': 'Password',
      'form.passwordSetHint': 'Password saved; leave blank to keep it',
      'form.database': 'Database',
      'form.databaseHint': 'Leave blank to use the default database',
      'form.file': 'Database file',
      'form.fileHint': 'Absolute path of the SQLite database file',
      'form.save': 'Save',
      'form.test': 'Test connection',
      'form.disconnect': 'Disconnect',
      'form.delete': 'Delete',
      'query.placeholder': 'Type SQL, Ctrl + Enter to run',
      'query.run': 'Run',
      'query.running': 'Running…',
      'query.empty': 'Results appear here.',
      'result.rows': '{count} rows',
      'result.affected': '{count} rows affected',
      'result.time': '{ms} ms',
      'result.truncated': 'Showing the first {count} rows',
      'result.exported': 'Full result saved to {path}',
      'result.reconnected': 'The connection had dropped; it was reopened and the statement retried.',
      'state.idle': 'Not connected',
      'state.ready': 'Connected',
      'state.reconnecting': 'Reconnecting',
      'state.error': 'Connection failed',
      'message.saved': 'Saved.',
      'message.deleted': 'Deleted.',
      'message.testOk': 'Connected in {ms} ms.',
      'message.testFailed': 'Connection failed: {message}',
      'message.disconnected': 'Disconnected.',
      'message.needSave': 'Save the connection before running SQL.',
      'error.load': 'Could not read connection settings: {message}',
      'error.save': 'Save failed: {message}',
      'error.remove': 'Delete failed: {message}',
    }

    const TOKEN = {
      bg: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      muted: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
    }

    const MONO = 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'

    const S = {
      footerButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'transparent',
        background: 'transparent',
        color: TOKEN.muted,
        cursor: 'pointer',
      },
      footerButtonActive: {
        background: TOKEN.hover,
        color: TOKEN.text,
      },
      scrim: {
        position: 'fixed',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      },
      shell: {
        width: 'min(1120px, 94vw)',
        height: 'min(760px, 88vh)',
        display: 'flex',
        flexDirection: 'column',
        background: TOKEN.layer1,
        color: TOKEN.text,
        border: `1px solid ${TOKEN.border}`,
        borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderBottom: `1px solid ${TOKEN.border}`,
        flexShrink: 0,
      },
      brand: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
      title: { margin: 0, fontSize: 14, fontWeight: 600 },
      iconButton: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        padding: 0,
        borderRadius: 7,
        border: '1px solid transparent',
        background: 'transparent',
        color: TOKEN.muted,
        fontSize: 16,
        lineHeight: 1,
        cursor: 'pointer',
      },
      body: { display: 'flex', flex: 1, minHeight: 0 },
      sidebar: {
        width: 224,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: `1px solid ${TOKEN.border}`,
        minHeight: 0,
      },
      sidebarHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        padding: '10px 12px',
        color: TOKEN.muted,
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
      },
      connList: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '0 8px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      },
      connItem: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        textAlign: 'left',
        padding: '7px 10px',
        borderRadius: 8,
        border: '1px solid transparent',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        minWidth: 0,
      },
      connItemActive: {
        background: TOKEN.layer2,
        borderColor: TOKEN.border,
      },
      connName: {
        fontSize: 13,
        fontWeight: 500,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      connMeta: {
        fontSize: 11,
        color: TOKEN.muted,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
      form: {
        padding: '10px 16px 12px',
        borderBottom: `1px solid ${TOKEN.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      },
      formHead: { display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 },
      formTitle: { fontSize: 12.5, fontWeight: 600 },
      formGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8,
      },
      field: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
      fieldWide: { gridColumn: '1 / -1' },
      label: { fontSize: 11, color: TOKEN.muted },
      input: {
        padding: '5px 8px',
        borderRadius: 7,
        border: `1px solid ${TOKEN.border}`,
        background: TOKEN.bg,
        color: TOKEN.text,
        font: 'inherit',
        fontSize: 12,
        minWidth: 0,
        outline: 'none',
      },
      select: {
        padding: '5px 8px',
        borderRadius: 7,
        border: `1px solid ${TOKEN.border}`,
        background: TOKEN.bg,
        color: TOKEN.text,
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      },
      hint: { fontSize: 11, color: TOKEN.muted },
      actions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      primary: {
        padding: '5px 14px',
        borderRadius: 7,
        border: 'none',
        background: TOKEN.brand,
        color: TOKEN.bg,
        font: 'inherit',
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      },
      ghost: {
        padding: '5px 12px',
        borderRadius: 7,
        border: `1px solid ${TOKEN.border}`,
        background: 'transparent',
        color: TOKEN.text,
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      },
      link: {
        border: 'none',
        background: 'transparent',
        color: TOKEN.brand,
        font: 'inherit',
        fontSize: 12,
        padding: 0,
        cursor: 'pointer',
      },
      noticeOk: { fontSize: 12, lineHeight: 1.5, color: TOKEN.success },
      noticeError: { fontSize: 12, lineHeight: 1.5, color: TOKEN.error, whiteSpace: 'pre-wrap' },
      noticeWarn: { fontSize: 12, lineHeight: 1.5, color: TOKEN.warn },
      queryBox: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '10px 16px 14px', gap: 8 },
      sqlArea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: 96,
        maxHeight: 200,
        padding: '9px 11px',
        borderRadius: 8,
        border: `1px solid ${TOKEN.border}`,
        background: TOKEN.bg,
        color: TOKEN.text,
        fontFamily: MONO,
        fontSize: 12.5,
        lineHeight: 1.6,
        resize: 'vertical',
        outline: 'none',
      },
      runRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
      statusLine: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 11.5, color: TOKEN.muted, flexWrap: 'wrap' },
      dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: TOKEN.idle },
      tableWrap: { flex: 1, minHeight: 0, overflow: 'auto', border: `1px solid ${TOKEN.border}`, borderRadius: 8 },
      table: { borderCollapse: 'collapse', width: '100%', fontFamily: MONO, fontSize: 12 },
      th: {
        position: 'sticky',
        top: 0,
        background: TOKEN.layer2,
        color: TOKEN.muted,
        textAlign: 'left',
        padding: '6px 10px',
        borderBottom: `1px solid ${TOKEN.border}`,
        whiteSpace: 'nowrap',
        fontWeight: 600,
      },
      td: {
        padding: '5px 10px',
        borderBottom: `1px solid ${TOKEN.border}`,
        whiteSpace: 'pre',
        maxWidth: 420,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      empty: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: TOKEN.muted,
        fontSize: 12,
        border: `1px dashed ${TOKEN.border}`,
        borderRadius: 8,
        padding: 12,
        textAlign: 'center',
      },
      emptyError: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: TOKEN.error,
        fontSize: 12,
        border: `1px solid ${TOKEN.border}`,
        borderRadius: 8,
        padding: 12,
        whiteSpace: 'pre-wrap',
        textAlign: 'center',
        overflow: 'auto',
      },
    }

    let boundT = (key) => key

    /** 面板开合状态由侧栏按钮与浮层共享。 */
    let panelOpen = false
    const openListeners = new Set()
    function setPanelOpen(next) {
      if (panelOpen === next) return
      panelOpen = next
      for (const listener of openListeners) listener()
    }
    function usePanelOpen() {
      const [open, setOpen] = React.useState(panelOpen)
      React.useEffect(() => {
        const listener = () => setOpen(panelOpen)
        openListeners.add(listener)
        return () => {
          openListeners.delete(listener)
        }
      }, [])
      return open
    }

    function useHover() {
      const [hovered, setHovered] = React.useState(false)
      return [
        hovered,
        {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
        },
      ]
    }

    function messageOf(error) {
      return String((error && error.message) || error)
    }

    function readJson(response) {
      return response.text().then((text) => {
        if (!text) return undefined
        try {
          return JSON.parse(text)
        } catch {
          return undefined
        }
      })
    }

    async function callApi(payload) {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })
      const body = await readJson(response)
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`)
      }
      if (!body || typeof body !== 'object') throw new Error('响应不是合法 JSON')
      return body
    }

    function SqlIcon(props) {
      const size = props?.size ?? 16
      return h(
        'svg',
        {
          viewBox: '0 0 64 64',
          width: size,
          height: size,
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('ellipse', { cx: 32, cy: 18, rx: 18, ry: 7.5, fill: 'currentColor', opacity: 0.85 }),
        h('path', {
          d: 'M14 18v28c0 4.1 8.1 7.5 18 7.5s18-3.4 18-7.5V18',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 4,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M14 32c0 4.1 8.1 7.5 18 7.5s18-3.4 18-7.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 4,
        }),
      )
    }

    function FooterButton(props) {
      const t = (props && props.t) || boundT
      const open = usePanelOpen()
      const [hovered, hover] = useHover()
      return h(
        'button',
        {
          type: 'button',
          title: t('action.title'),
          'aria-label': t('action.title'),
          'aria-expanded': open,
          onClick: () => setPanelOpen(!open),
          style: hovered ? { ...S.footerButton, ...S.footerButtonActive } : S.footerButton,
          ...hover,
        },
        h(SqlIcon, { size: 16 }),
      )
    }

    function Field(props) {
      return h(
        'label',
        { style: props.wide ? { ...S.field, ...S.fieldWide } : S.field },
        h('span', { style: S.label }, props.label),
        props.children,
        props.hint ? h('span', { style: S.hint }, props.hint) : null,
      )
    }

    function blankConnection(driver) {
      return {
        id: '',
        name: '',
        driver,
        host: driver === 'sqlite' ? '' : '127.0.0.1',
        port: driver === 'mysql' ? 3306 : driver === 'postgres' ? 5432 : 0,
        user: '',
        password: '',
        database: '',
        file: '',
        passwordSet: false,
      }
    }

    function driverLabel(t, driver) {
      if (driver === 'postgres') return t('driver.postgres')
      if (driver === 'sqlite') return t('driver.sqlite')
      return t('driver.mysql')
    }

    function targetOf(connection) {
      if (connection.driver === 'sqlite') return connection.file || '—'
      const hostPort = [connection.host, connection.port].filter((part) => part !== '' && part !== undefined).join(':')
      return connection.database ? `${hostPort} / ${connection.database}` : hostPort
    }

    function statusLabel(t, status) {
      const state = status && status.state
      if (state === 'ready') return t('state.ready')
      if (state === 'reconnecting') return t('state.reconnecting')
      if (state === 'error') return t('state.error')
      return t('state.idle')
    }

    function statusColor(state) {
      if (state === 'ready') return TOKEN.success
      if (state === 'error') return TOKEN.error
      if (state === 'reconnecting') return TOKEN.warn
      return TOKEN.idle
    }

    function Workbench(props) {
      const t = (props && props.t) || boundT
      const tRef = React.useRef(t)
      tRef.current = t

      const open = usePanelOpen()
      const [connections, setConnections] = React.useState([])
      const [draft, setDraft] = React.useState(null)
      const draftRef = React.useRef(null)
      draftRef.current = draft

      const [status, setStatus] = React.useState(null)
      const [sql, setSql] = React.useState('')
      const [result, setResult] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState('')

      const refreshStatus = React.useCallback(async (id) => {
        try {
          const next = await callApi({ action: 'status', id })
          setStatus(next)
        } catch (error) {
          setStatus({ state: 'error', lastError: messageOf(error) })
        }
      }, [])

      const adopt = React.useCallback(
        (connection) => {
          setDraft(connection ? { ...connection } : blankConnection('mysql'))
          setResult(null)
          setNotice(null)
          setStatus(null)
          if (connection) void refreshStatus(connection.id)
        },
        [refreshStatus],
      )

      const load = React.useCallback(async () => {
        try {
          const view = await callApi({ action: 'list' })
          const list = Array.isArray(view.connections) ? view.connections : []
          setConnections(list)
          const currentId = draftRef.current && draftRef.current.id
          const next = (currentId && list.find((item) => item.id === currentId)) || list[0]
          adopt(next || null)
        } catch (error) {
          setNotice({ tone: 'error', text: tRef.current('error.load', { message: messageOf(error) }) })
        }
      }, [adopt])

      React.useEffect(() => {
        if (!open) return
        void load()
      }, [open, load])

      React.useEffect(() => {
        if (!open) return
        const onKey = (event) => {
          if (event.key === 'Escape') setPanelOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('keydown', onKey)
        }
      }, [open])

      if (!open) return null

      const update = (field, value) => {
        setDraft((current) => (current ? { ...current, [field]: value } : current))
      }

      const updateDriver = (driver) => {
        setDraft((current) => {
          if (!current) return current
          return {
            ...current,
            driver,
            port: driver === 'mysql' ? 3306 : driver === 'postgres' ? 5432 : 0,
            host: driver === 'sqlite' ? '' : current.host || '127.0.0.1',
          }
        })
      }

      const save = async () => {
        if (!draft) return
        setBusy('save')
        setNotice(null)
        try {
          const view = await callApi({ action: 'save', connection: draft })
          const list = Array.isArray(view.connections) ? view.connections : []
          setConnections(list)
          const saved = list.find((item) => item.id === view.connectionId)
          if (saved) {
            setDraft({ ...saved })
            void refreshStatus(saved.id)
          }
          setNotice({ tone: 'ok', text: t('message.saved') })
        } catch (error) {
          setNotice({ tone: 'error', text: t('error.save', { message: messageOf(error) }) })
        } finally {
          setBusy('')
        }
      }

      const test = async () => {
        if (!draft) return
        setBusy('test')
        setNotice(null)
        try {
          const view = await callApi({ action: 'test', connection: draft })
          setNotice({ tone: 'ok', text: t('message.testOk', { ms: view.latencyMs }) })
        } catch (error) {
          setNotice({ tone: 'error', text: t('message.testFailed', { message: messageOf(error) }) })
        } finally {
          setBusy('')
        }
      }

      const disconnect = async () => {
        if (!draft || !draft.id) return
        setBusy('disconnect')
        setNotice(null)
        try {
          await callApi({ action: 'disconnect', id: draft.id })
          setStatus({ state: 'idle', lastError: null })
          setNotice({ tone: 'ok', text: t('message.disconnected') })
        } catch (error) {
          setNotice({ tone: 'error', text: messageOf(error) })
        } finally {
          setBusy('')
        }
      }

      const remove = async () => {
        if (!draft || !draft.id) return
        setBusy('remove')
        setNotice(null)
        try {
          const view = await callApi({ action: 'remove', id: draft.id })
          const list = Array.isArray(view.connections) ? view.connections : []
          setConnections(list)
          adopt(list[0] || null)
          setNotice({ tone: 'ok', text: t('message.deleted') })
        } catch (error) {
          setNotice({ tone: 'error', text: t('error.remove', { message: messageOf(error) }) })
        } finally {
          setBusy('')
        }
      }

      const run = async () => {
        if (!draft || !draft.id) {
          setNotice({ tone: 'warn', text: t('message.needSave') })
          return
        }
        if (sql.trim() === '') return
        setBusy('query')
        setResult(null)
        setNotice(null)
        try {
          const view = await callApi({ action: 'query', id: draft.id, sql })
          setResult(view)
          setStatus({ state: 'ready', lastError: null })
          if (view.reconnected) setNotice({ tone: 'warn', text: t('result.reconnected') })
        } catch (error) {
          const message = messageOf(error)
          setResult({ error: message })
          setStatus({ state: 'error', lastError: message })
        } finally {
          setBusy('')
        }
      }

      const renderSidebar = () =>
        h(
          'div',
          { style: S.sidebar },
          h(
            'div',
            { style: S.sidebarHead },
            h('span', null, t('list.title')),
            h('button', { type: 'button', style: S.link, onClick: () => adopt(null) }, t('list.new')),
          ),
          h(
            'div',
            { style: S.connList },
            connections.length === 0
              ? h('div', { style: { ...S.hint, padding: '6px 4px', lineHeight: 1.6 } }, t('list.empty'))
              : connections.map((connection) =>
                  h(
                    'button',
                    {
                      key: connection.id,
                      type: 'button',
                      title: connection.name,
                      onClick: () => adopt(connection),
                      style:
                        draft && draft.id === connection.id
                          ? { ...S.connItem, ...S.connItemActive }
                          : S.connItem,
                    },
                    h('span', { style: S.connName }, connection.name),
                    h('span', { style: S.connMeta }, `${driverLabel(t, connection.driver)} · ${targetOf(connection)}`),
                  ),
                ),
          ),
        )

      const renderForm = () => {
        if (!draft) return null
        const sqlite = draft.driver === 'sqlite'
        const network = [
          h(
            Field,
            { key: 'host', label: t('form.host') },
            h('input', {
              style: S.input,
              value: draft.host,
              spellCheck: false,
              onChange: (event) => update('host', event.target.value),
            }),
          ),
          h(
            Field,
            { key: 'port', label: t('form.port') },
            h('input', {
              style: S.input,
              value: String(draft.port ?? ''),
              inputMode: 'numeric',
              onChange: (event) => update('port', event.target.value),
            }),
          ),
          h(
            Field,
            { key: 'user', label: t('form.user') },
            h('input', {
              style: S.input,
              value: draft.user,
              spellCheck: false,
              autoComplete: 'off',
              onChange: (event) => update('user', event.target.value),
            }),
          ),
          h(
            Field,
            {
              key: 'password',
              label: t('form.password'),
              hint: draft.passwordSet ? t('form.passwordSetHint') : undefined,
            },
            h('input', {
              style: S.input,
              type: 'password',
              value: draft.password || '',
              spellCheck: false,
              autoComplete: 'new-password',
              onChange: (event) => update('password', event.target.value),
            }),
          ),
          h(
            Field,
            { key: 'database', label: t('form.database'), hint: t('form.databaseHint') },
            h('input', {
              style: S.input,
              value: draft.database,
              spellCheck: false,
              onChange: (event) => update('database', event.target.value),
            }),
          ),
        ]
        return h(
          React.Fragment,
          null,
          h(
            'div',
            { style: S.formHead },
            h('span', { style: S.formTitle }, draft.id ? t('form.title.edit') : t('form.title.new')),
            draft.id ? h('span', { style: S.hint }, draft.name) : null,
          ),
          h(
            'div',
            { style: S.formGrid },
            h(
              Field,
              { label: t('form.name') },
              h('input', {
                style: S.input,
                value: draft.name,
                spellCheck: false,
                placeholder: draft.driver === 'sqlite' ? 'sqlite' : `${draft.driver} ${draft.host}`,
                onChange: (event) => update('name', event.target.value),
              }),
            ),
            h(
              Field,
              { label: t('form.driver') },
              h(
                'select',
                { style: S.select, value: draft.driver, onChange: (event) => updateDriver(event.target.value) },
                h('option', { value: 'mysql' }, t('driver.mysql')),
                h('option', { value: 'postgres' }, t('driver.postgres')),
                h('option', { value: 'sqlite' }, t('driver.sqlite')),
              ),
            ),
            sqlite
              ? h(
                  Field,
                  { wide: true, label: t('form.file'), hint: t('form.fileHint') },
                  h('input', {
                    style: { ...S.input, fontFamily: MONO },
                    value: draft.file,
                    spellCheck: false,
                    placeholder: 'D:\\data\\app.db',
                    onChange: (event) => update('file', event.target.value),
                  }),
                )
              : network,
          ),
          h(
            'div',
            { style: S.actions },
            h('button', { type: 'button', style: S.primary, disabled: busy !== '', onClick: () => void save() }, t('form.save')),
            h('button', { type: 'button', style: S.ghost, disabled: busy !== '', onClick: () => void test() }, t('form.test')),
            draft.id
              ? h(
                  'button',
                  { type: 'button', style: S.ghost, disabled: busy !== '', onClick: () => void disconnect() },
                  t('form.disconnect'),
                )
              : null,
            draft.id
              ? h(
                  'button',
                  { type: 'button', style: { ...S.ghost, color: TOKEN.error }, disabled: busy !== '', onClick: () => void remove() },
                  t('form.delete'),
                )
              : null,
          ),
          notice
            ? h(
                'div',
                {
                  style:
                    notice.tone === 'ok' ? S.noticeOk : notice.tone === 'warn' ? S.noticeWarn : S.noticeError,
                },
                notice.text,
              )
            : null,
        )
      }

      const renderResult = () => {
        if (busy === 'query') return h('div', { style: S.empty }, t('query.running'))
        if (!result) return h('div', { style: S.empty }, t('query.empty'))
        if (result.error) return h('div', { style: S.emptyError }, result.error)
        if (!result.rows || result.rows.length === 0) {
          return h('div', { style: S.empty }, t('result.affected', { count: result.rowCount }))
        }
        return h(
          'div',
          { style: S.tableWrap },
          h(
            'table',
            { style: S.table },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                result.columns.map((column, index) => h('th', { key: `${column}-${index}`, style: S.th }, column)),
              ),
            ),
            h(
              'tbody',
              null,
              result.rows.map((row, rowIndex) =>
                h(
                  'tr',
                  { key: rowIndex },
                  row.map((cell, cellIndex) =>
                    h(
                      'td',
                      { key: cellIndex, style: cell === null ? { ...S.td, color: TOKEN.muted } : S.td },
                      cell === null ? 'NULL' : String(cell),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      const state = status && status.state
      return h(
        'div',
        {
          style: S.scrim,
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setPanelOpen(false)
          },
        },
        h(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': t('panel.title'),
            style: S.shell,
            onMouseDown: (event) => event.stopPropagation(),
          },
          h(
            'header',
            { style: S.header },
            h('div', { style: S.brand }, h(SqlIcon, { size: 18 }), h('h2', { style: S.title }, t('panel.title'))),
            h(
              'button',
              { type: 'button', style: S.iconButton, title: t('panel.close'), 'aria-label': t('panel.close'), onClick: () => setPanelOpen(false) },
              '×',
            ),
          ),
          h(
            'div',
            { style: S.body },
            renderSidebar(),
            h(
              'div',
              { style: S.main },
              h('div', { style: S.form }, renderForm()),
              h(
                'div',
                { style: S.queryBox },
                h('textarea', {
                  style: S.sqlArea,
                  value: sql,
                  spellCheck: false,
                  placeholder: t('query.placeholder'),
                  onChange: (event) => setSql(event.target.value),
                  onKeyDown: (event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void run()
                    }
                  },
                }),
                h(
                  'div',
                  { style: S.runRow },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: S.primary,
                      disabled: busy !== '' || sql.trim() === '' || !draft || !draft.id,
                      onClick: () => void run(),
                    },
                    busy === 'query' ? t('query.running') : t('query.run'),
                  ),
                  h(
                    'div',
                    { style: S.statusLine },
                    h(
                      'span',
                      { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
                      h('span', { style: { ...S.dot, background: statusColor(state) } }),
                      h('span', null, statusLabel(t, status)),
                    ),
                    result && !result.error
                      ? h('span', null, t('result.rows', { count: result.rowCount }))
                      : null,
                    result && !result.error
                      ? h('span', null, t('result.time', { ms: result.durationMs }))
                      : null,
                    result && result.truncated
                      ? h('span', { style: { color: TOKEN.warn } }, t('result.truncated', { count: MAX_ROWS }))
                      : null,
                  ),
                ),
                result && result.exportPath
                  ? h(
                      'div',
                      { style: { ...S.hint, fontFamily: MONO, wordBreak: 'break-all' } },
                      t('result.exported', { path: result.exportPath }),
                    )
                  : null,
                renderResult(),
              ),
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale
        ctx.effect(() => locale.register(NS, { zh, en }))
        boundT = locale.bind(NS)
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'sql-connect',
              order: 10,
              label: () => boundT('action.title'),
              locale: NS,
            },
            FooterButton,
          ),
        )
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'sql-connect',
              order: 120,
              label: () => boundT('action.title'),
              locale: NS,
            },
            Workbench,
          ),
        )
      },
    }
  },
})
