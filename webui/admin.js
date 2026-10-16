/* =============================================================================
 * Civision Gateway WebUI — 管理台（Admin）
 * 顶部 Tab：概览 / API KEY / 号池 / 模型开关 / 设置 / 日志
 * 全部请求带 X-Admin-Token（存 localStorage，可在设置页编辑）。
 * ========================================================================== */

import {
  api, ApiError, MOCK, addStrings, t, pick, h, clear, icon, toast, toastError,
  openModal, confirmDialog, dataTable, skeletonLines, emptyState, busy,
  store, copyText, chipRow, selectInput, textInput, numberInput, switchEl, checkbox,
  field, fmtTime, fmtRelative, fmtNum, fmtDuration, tag, dot,
} from './app.js';

/* ---------------------------------------------------------------------------
 * 文案
 * ------------------------------------------------------------------------ */
addStrings({
  'ad.title': ['管理台', 'Console'],
  'ad.sub': ['API KEY · 号池 · 模型开关 · 设置 · 日志', 'API keys · account pool · models · settings · logs'],

  'ad.tab.overview': ['概览', 'Overview'],
  'ad.tab.keys': ['API KEY', 'API KEY'],
  'ad.tab.pool': ['号池', 'Pool'],
  'ad.tab.models': ['模型开关', 'Models'],
  'ad.tab.settings': ['设置', 'Settings'],
  'ad.tab.logs': ['日志', 'Logs'],

  /* 概览 */
  'ad.ov.keys': ['API KEY', 'API keys'],
  'ad.ov.keys.foot': ['已启用 {n}', '{n} enabled'],
  'ad.ov.pool': ['号池健康', 'Pool health'],
  'ad.ov.pool.foot': ['冷却中 {n}', '{n} cooling down'],
  'ad.ov.models': ['模型启用', 'Models enabled'],
  'ad.ov.models.foot': ['注册表共 {n}', '{n} in registry'],
  'ad.ov.today': ['今日请求', 'Requests today'],
  'ad.ov.today.foot': ['累计 {total} · 失败 {failed}', 'total {total} · {failed} failed'],
  'ad.ov.upstream': ['上游可达', 'Upstream'],
  'ad.ov.upstream.ok': ['可达', 'reachable'],
  'ad.ov.upstream.bad': ['不可达', 'unreachable'],
  'ad.ov.upstream.foot': ['延迟 {n} ms', '{n} ms latency'],
  'ad.ov.runtime': ['运行信息', 'Runtime'],
  'ad.ov.version': ['版本', 'Version'],
  'ad.ov.uptime': ['运行时长', 'Uptime'],
  'ad.ov.selftest': ['端到端自检', 'End-to-end self-test'],
  'ad.ov.selftest.hint': ['依次检查上游可达 / 号池 / 模型目录 / 一次真实出图 / 存储',
    'Checks upstream reachability, pool, model catalog, one real generation and storage'],

  /* API KEY */
  'ad.keys.new': ['新建 KEY', 'New key'],
  'ad.keys.name': ['名称', 'Name'],
  'ad.keys.prefix': ['前缀', 'Prefix'],
  'ad.keys.status': ['状态', 'Status'],
  'ad.keys.scope': ['模型范围', 'Model scope'],
  'ad.keys.rpm': ['RPM', 'RPM'],
  'ad.keys.usage': ['用量', 'Usage'],
  'ad.keys.created': ['创建时间', 'Created'],
  'ad.keys.enabled': ['启用', 'Enabled'],
  'ad.keys.disabled': ['已停用', 'Disabled'],
  'ad.keys.reset': ['重置用量', 'Reset usage'],
  'ad.keys.reset.done': ['用量已重置', 'Usage reset'],
  'ad.keys.deleted': ['KEY 已删除', 'Key deleted'],
  'ad.keys.delete.confirm': ['删除后该 KEY 立即失效，确认删除「{name}」？', 'This key stops working immediately. Delete “{name}”?'],
  'ad.keys.updated': ['已更新', 'Updated'],
  'ad.keys.empty': ['还没有 API KEY', 'No API keys yet'],
  'ad.keys.empty.desc': ['创建一个 KEY 给 OpenAI 兼容客户端（/v1/*）与 Studio 使用。',
    'Create a key for OpenAI-compatible clients (/v1/*) and the Studio.'],
  'ad.keys.note': ['备注', 'Note'],
  'ad.keys.note.ph': ['给谁用 / 用途', 'Who uses it / purpose'],
  'ad.keys.rpm.hint': ['每分钟请求上限，0 = 不限', 'Requests per minute, 0 = unlimited'],
  'ad.keys.quota': ['额度上限（次数）', 'Quota (requests)'],
  'ad.keys.quota.hint': ['0 = 不限', '0 = unlimited'],
  'ad.keys.models': ['可用模型', 'Allowed models'],
  'ad.keys.models.all': ['全部模型', 'All models'],
  'ad.keys.models.hint': ['勾选「全部模型」即 models: ["*"]', 'Checking “All models” sets models: ["*"]'],
  'ad.keys.created.title': ['KEY 已创建（明文只显示这一次）', 'Key created (plaintext shown once)'],
  'ad.keys.created.note': ['服务端只保存 sha256 前缀与末 4 位，关闭后无法再查看。请立刻复制到安全位置。',
    'The server only keeps a sha256 prefix and last 4 chars. Copy it somewhere safe now.'],
  'ad.keys.created.copy': ['复制 KEY', 'Copy key'],
  'ad.keys.created.use': ['设为当前 WebUI KEY', 'Use as current WebUI key'],
  'ad.keys.created.used': ['已设为当前 KEY', 'Set as current key'],
  'ad.keys.name.required': ['请填写名称', 'Name is required'],

  /* 号池 */
  'ad.pool.accounts': ['账号', 'Accounts'],
  'ad.pool.add': ['手动添加', 'Add manually'],
  'ad.pool.import': ['批量导入', 'Bulk import'],
  'ad.pool.label': ['标签 / 邮箱', 'Label / email'],
  'ad.pool.health': ['健康', 'Health'],
  'ad.pool.cooldown': ['冷却', 'Cooldown'],
  'ad.pool.requests': ['请求', 'Requests'],
  'ad.pool.failures': ['失败', 'Failures'],
  'ad.pool.quota': ['额度', 'Quota'],
  'ad.pool.lasterr': ['最后错误', 'Last error'],
  'ad.pool.check': ['检查', 'Check'],
  'ad.pool.check.done': ['检查完成', 'Check finished'],
  'ad.pool.enabled': ['已启用', 'Enabled'],
  'ad.pool.disabled': ['已禁用', 'Disabled'],
  'ad.pool.deleted': ['账号已删除', 'Account deleted'],
  'ad.pool.delete.confirm': ['删除账号 {label}？该账号的 Cookie 会一并从库里移除。',
    'Delete account {label}? Its cookie is removed from storage too.'],
  'ad.pool.add.title': ['手动添加账号', 'Add account manually'],
  'ad.pool.add.label': ['标签', 'Label'],
  'ad.pool.add.label.ph': ['手工号 · 备用', 'manual · backup'],
  'ad.pool.add.cookie': ['Cookie 或 Token', 'Cookie or token'],
  'ad.pool.add.cookie.ph': ['完整 Cookie 串，或 Access Token', 'Full cookie string, or an access token'],
  'ad.pool.add.cookie.hint': ['对应 POST /admin/api/accounts 的 "cookie" 字段', 'Maps to the "cookie" field of POST /admin/api/accounts'],
  'ad.pool.import.title': ['批量导入', 'Bulk import'],
  'ad.pool.import.text': ['每行一个 Cookie（或 Token）', 'One cookie (or token) per line'],
  'ad.pool.import.label': ['批次标签', 'Batch label'],
  'ad.pool.import.count': ['已导入 {n} 个账号', 'Imported {n} accounts'],
  'ad.pool.import.empty': ['没有可导入的内容', 'Nothing to import'],
  'ad.pool.empty': ['号池为空', 'Pool is empty'],
  'ad.pool.empty.desc': ['手动粘贴 Cookie，或使用下方「一键注册补号」。', 'Paste a cookie, or use the refill below.'],
  'ad.pool.healthy': ['健康', 'healthy'],
  'ad.pool.unhealthy': ['异常', 'unhealthy'],
  'ad.pool.off': ['停用', 'off'],
  'ad.pool.quota.fmt': ['图 {image} / 视频 {video} / 余额 {balance}', 'image {image} / video {video} / balance {balance}'],
  'ad.pool.cd': ['{n}s', '{n}s'],
  'ad.pool.cd.ready': ['就绪', 'ready'],

  /* 补号 */
  'ad.refill.title': ['一键注册补号', 'One-click refill'],
  'ad.refill.sub': ['复用邮箱源自动注册上游账号；验证码阻塞时人工回填 captcha_verify',
    'Auto-registers upstream accounts via a mailbox provider; when captcha blocks, paste captcha_verify manually'],
  'ad.refill.count': ['数量', 'Count'],
  'ad.refill.provider': ['邮箱源', 'Mail provider'],
  'ad.refill.verify': ['需要验证码人工介入', 'Wait for manual captcha'],
  'ad.refill.start': ['开始补号', 'Start refill'],
  'ad.refill.job': ['任务', 'Job'],
  'ad.refill.target': ['目标 {done}/{target}', '{done}/{target} done'],
  'ad.refill.status.running': ['运行中', 'running'],
  'ad.refill.status.waiting_captcha': ['等待验证码', 'waiting captcha'],
  'ad.refill.status.done': ['已完成', 'done'],
  'ad.refill.status.failed': ['失败', 'failed'],
  'ad.refill.submitted': ['补号任务已提交', 'Refill job submitted'],
  'ad.refill.stage.mailbox': ['分配邮箱', 'mailbox'],
  'ad.refill.stage.sendEmail': ['发送邮件', 'sendEmail'],
  'ad.refill.stage.captcha': ['验证码', 'captcha'],
  'ad.refill.stage.confirm': ['邮件确认', 'confirm'],
  'ad.refill.stage.loginRegister': ['完成注册', 'loginRegister'],
  'ad.refill.stage.done': ['入库完成', 'done'],
  'ad.refill.stage.failed': ['失败', 'failed'],
  'ad.refill.stages': ['邮箱 → sendEmail → captcha → confirm → loginRegister → done',
    'mailbox → sendEmail → captcha → confirm → loginRegister → done'],
  'ad.refill.captcha.title': ['需要人工过码', 'Manual captcha required'],
  'ad.refill.captcha.desc': ['邮箱 {email} 卡在阿里云验证码（SceneId {scene}，prefix {prefix}）。在浏览器里过掉滑块，把 captcha_verify 贴进来。',
    'Mailbox {email} is blocked at Aliyun captcha (SceneId {scene}, prefix {prefix}). Solve the slider in a browser and paste captcha_verify.'],
  'ad.refill.captcha.label': ['captcha_verify', 'captcha_verify'],
  'ad.refill.captcha.submit': ['回填并继续', 'Submit and continue'],
  'ad.refill.captcha.done': ['captcha_verify 已回填', 'captcha_verify submitted'],
  'ad.refill.captcha.required': ['请填写 captcha_verify', 'captcha_verify is required'],
  'ad.refill.captcha.waiting': ['等待人工过码…（可再次打开输入框）', 'Waiting for manual captcha… (reopen the dialog)'],
  'ad.refill.captcha.open': ['打开回填框', 'Open captcha dialog'],
  'ad.refill.progress': ['任务进度', 'Job progress'],
  'ad.refill.nojob': ['暂无进行中的补号任务', 'No refill job yet'],
  'ad.refill.accounts': ['本次新增账号 {n}', '{n} accounts added'],

  /* 浏览器托管 */
  'ad.br.title': ['浏览器托管', 'Managed browser'],
  'ad.br.sub': ['用托管窗口替代「DevTools 里抠 captcha_verify」', 'Replaces copying captcha_verify from devtools'],
  'ad.br.state.idle': ['未启动', 'not running'],
  'ad.br.state.running': ['运行中', 'running'],
  'ad.br.state.launching': ['启动中…', 'launching…'],
  'ad.br.state.error': ['出错', 'error'],
  'ad.br.state.ready': ['就绪', 'ready'],
  'ad.br.open': ['打开托管窗口', 'Open managed window'],
  'ad.br.register': ['打开注册页', 'Open register page'],
  'ad.br.harvest': ['抓取会话入库', 'Harvest session'],
  'ad.br.harvest.done': ['已入库：{label}', 'Imported: {label}'],
  'ad.br.close': ['关闭窗口', 'Close window'],
  'ad.br.hosted': ['托管注册（自动建邮箱 + 预填）', 'Hosted signup (mailbox + prefill)'],
  'ad.br.hosted.hint': ['自动建一个临时邮箱、打开注册页并填好邮箱/用户名/密码 —— 你只需点「注册」+ 拖一次滑块',
    'Creates a mailbox, opens the register page and fills the form — you only click Sign up and drag the slider once'],
  'ad.br.step1': ['① 在窗口里正常登录或注册（滑块自然过掉）', '1. Log in or sign up in the window (slider passes naturally)'],
  'ad.br.step2': ['② 登录成功后点「抓取会话入库」，不用碰 DevTools', '2. Then click “Harvest session” — no devtools needed'],
  'ad.br.cookies': ['Cookie {n}', 'Cookies {n}'],
  'ad.br.captcha': ['已嗅到验证码 {n} 次', 'Captcha seen {n}×'],
  'ad.br.captcha.none': ['尚未嗅到验证码', 'No captcha seen yet'],
  'ad.br.email': ['临时邮箱', 'Temp mailbox'],
  'ad.br.activation': ['激活链接', 'Activation link'],
  'ad.br.openLink': ['在窗口里打开', 'Open in window'],
  'ad.br.waiting': ['等待窗口里出现登录态…', 'Waiting for a session in the window…'],
  'ad.br.needLogin': ['托管窗口里还没有 modelscope 的登录态 —— 先在窗口里登录或注册成功',
    'No modelscope session in the managed window yet — log in or sign up there first'],
  'ad.br.mailCount': ['收件 {n} 封', '{n} message(s)'],

  /* 过码弹窗（浏览器托管优先） */
  'ad.cap.hostTitle': ['推荐：在托管浏览器里过码', 'Recommended: solve it in the managed browser'],
  'ad.cap.hostBtn': ['打开托管窗口过码', 'Open managed window'],
  'ad.cap.hostHint': ['点上面的按钮 → 窗口里点「注册」→ 拖一次滑块。网关会**自动**把 captcha_verify 回填给这个任务，你不用复制任何东西。',
    'Click the button → hit Sign up in the window → drag the slider once. The gateway auto-fills captcha_verify for this job; nothing to copy.'],
  'ad.cap.opened': ['托管窗口已打开', 'Managed window opened'],
  'ad.cap.openedDesc': ['在窗口里点「注册」并拖动滑块，完成后本框会自动关闭', 'Click Sign up and drag the slider in the window; this dialog closes itself when done'],
  'ad.cap.autoFilled': ['captcha_verify 已自动回填，任务继续', 'captcha_verify auto-filled, job continues'],
  'ad.cap.manualTitle': ['或者手动粘贴', 'Or paste manually'],
  'ad.cap.manualHint': ['F12 → Network → 找 sendEmail 请求 → 从请求体复制 captcha_verify', 'F12 → Network → find the sendEmail request → copy captcha_verify from its body'],

  /* 模型开关 */
  'ad.models.search': ['搜索名称 / 别名 / model', 'Search name / alias / model'],
  'ad.models.allOn': ['全部打开', 'Enable all'],
  'ad.models.allOff': ['全部关闭', 'Disable all'],
  'ad.models.on': ['开', 'On'],
  'ad.models.off': ['关', 'Off'],
  'ad.models.alias': ['别名', 'Alias'],
  'ad.models.alias.saved': ['别名已保存', 'Alias saved'],
  'ad.models.alias.conflict': ['别名不能为空', 'Alias cannot be empty'],
  'ad.models.alias.readonly': ['别名由后端从模型仓库名派生（server/registry.py），不支持在线改名；如需变更请改代码后重启网关',
    'Aliases are derived from the model repo name by the backend (server/registry.py) and cannot be renamed online; change the code and restart'],
  'ad.models.toggled': ['{alias} → {state}', '{alias} → {state}'],
  'ad.models.bulk.done': ['已更新 {n} 个模型', '{n} models updated'],
  'ad.models.kind.image': ['图片模型', 'Image models'],
  'ad.models.kind.video': ['视频模型', 'Video models'],
  'ad.models.kind.audio': ['音乐模型', 'Music models'],
  'ad.models.empty': ['没有匹配的模型', 'No matching model'],
  'ad.models.enabledCount': ['已开 {on}/{total}', '{on}/{total} on'],

  /* 设置 */
  'ad.set.upstream': ['上游地址 upstream_base', 'Upstream base'],
  'ad.set.upstream.hint': ['例如 https://modelscope.ai', 'e.g. https://modelscope.ai'],
  'ad.set.timeout': ['超时 timeout（秒）', 'Timeout (seconds)'],
  'ad.set.pool': ['号池目标数 pool_size', 'Pool target size'],
  'ad.set.cooldown': ['冷却秒数 cooldown', 'Cooldown (seconds)'],
  'ad.set.strict': ['strict_model（上游降级时报 409）', 'strict_model (409 on upstream downgrade)'],
  'ad.set.autorefill': ['自动补号 auto_refill', 'Auto refill'],
  'ad.set.provider': ['默认邮箱源 mail_provider', 'Default mail provider'],
  'ad.set.proxy': ['代理 proxy', 'Proxy'],
  'ad.set.proxy.hint': ['http://127.0.0.1:7890，留空表示直连', 'http://127.0.0.1:7890, empty = direct'],
  'ad.set.defaultkind': ['默认类型 default_kind', 'Default kind'],
  'ad.set.save': ['保存设置', 'Save settings'],
  'ad.set.saved': ['设置已保存', 'Settings saved'],
  'ad.set.auth': ['WebUI 鉴权与基址', 'WebUI auth & base URL'],
  'ad.set.auth.hint': ['只保存在本机 localStorage，用于给请求加头，不会写入后端。',
    'Stored in this browser only; used to add request headers, never written to the backend.'],
  'ad.set.apikey': ['网关 API KEY（Authorization: Bearer）', 'Gateway API KEY (Authorization: Bearer)'],
  'ad.set.token': ['Admin Token（X-Admin-Token）', 'Admin token (X-Admin-Token)'],
  'ad.set.token.hint': ['后端首次启动打印在控制台，或见 server/data/admin.token', 'Printed by the backend on first boot, or in server/data/admin.token'],
  'ad.set.base': ['API 基址 base（默认同源）', 'API base (default: same origin)'],
  'ad.set.base.hint': ['留空 = 同源；跨域部署时填 http://host:port', 'Empty = same origin; set http://host:port when cross-origin'],
  'ad.set.auth.saved': ['本地鉴权信息已保存', 'Local auth info saved'],
  'ad.set.selftest': ['端到端自检', 'End-to-end self-test'],
  'ad.set.selftest.running': ['自检中…', 'Running self-test…'],
  'ad.set.selftest.ok': ['自检通过', 'Self-test passed'],
  'ad.set.selftest.fail': ['自检未通过', 'Self-test failed'],

  /* 日志 */
  'ad.logs.level': ['级别', 'Level'],
  'ad.logs.all': ['全部级别', 'All levels'],
  'ad.logs.limit': ['条数', 'Lines'],
  'ad.logs.auto': ['自动刷新', 'Auto refresh'],
  'ad.logs.empty': ['暂无日志', 'No logs'],
  'ad.logs.empty.desc': ['网关产生请求后这里会实时出现记录。', 'Log lines appear here once the gateway serves requests.'],
  'ad.logs.total': ['共 {n} 条', '{n} lines'],
});

/* ---------------------------------------------------------------------------
 * 模块状态
 * ------------------------------------------------------------------------ */

const TABS = [
  { id: 'overview', label: 'ad.tab.overview', icon: 'grid' },
  { id: 'keys', label: 'ad.tab.keys', icon: 'key' },
  { id: 'pool', label: 'ad.tab.pool', icon: 'users' },
  { id: 'models', label: 'ad.tab.models', icon: 'sliders' },
  { id: 'settings', label: 'ad.tab.settings', icon: 'gear' },
  { id: 'logs', label: 'ad.tab.logs', icon: 'terminal' },
];

const TAB_RENDER = {
  overview: renderOverview,
  keys: renderKeys,
  pool: renderPool,
  models: renderModels,
  settings: renderSettings,
  logs: renderLogs,
};

const MODELS_CACHE = { items: null, at: 0 };

let tabCleanup = null;
let activeTab = null;

/* ---------------------------------------------------------------------------
 * 挂载
 * ------------------------------------------------------------------------ */

export async function mount(root, ctx) {
  activeTab = resolveTab(ctx && ctx.sub);

  const body = h('div.stack', { id: 'ad-body' });
  const nav = h('nav.admin-tabs', { role: 'tablist', 'aria-label': 'admin sections' });
  const tabs = new Map();

  for (const tab of TABS) {
    const btn = h('button.admin-tab', {
      type: 'button', role: 'tab',
      'aria-selected': tab.id === activeTab ? 'true' : 'false',
      class: tab.id === activeTab ? 'is-active' : '',
      on: { click: () => switchTab(tab.id) },
    }, icon(tab.icon, 'icon icon--14'), t(tab.label));
    tabs.set(tab.id, btn);
    nav.appendChild(btn);
  }

  const view = h('div.view.view--admin',
    h('div.row.row--between.row--wrap',
      h('div',
        h('h1', { style: { fontSize: '18px' } }, t('ad.title')),
        h('div.card__sub', t('ad.sub'))),
      MOCK ? tag(pick('演示数据', 'demo data'), 'accent') : null),
    nav,
    body,
  );
  root.appendChild(view);

  async function switchTab(id) {
    if (!TAB_RENDER[id]) return;
    if (tabCleanup) { try { tabCleanup(); } catch { /* ignore */ } tabCleanup = null; }
    activeTab = id;
    for (const [key, btn] of tabs) {
      btn.classList.toggle('is-active', key === id);
      btn.setAttribute('aria-selected', key === id ? 'true' : 'false');
    }
    // 用 replaceState 更新深链，但不触发 hashchange（避免整页重挂载）
    try { history.replaceState(null, '', `#/admin/${id}`); } catch { /* ignore */ }
    store.setJSON(store.keys.adminTab, id);

    clear(body);
    body.appendChild(h('div.card', h('div.card__body', skeletonLines(4))));
    try {
      const cleanup = await TAB_RENDER[id](body);
      tabCleanup = typeof cleanup === 'function' ? cleanup : null;
      if (activeTab !== id && tabCleanup) { tabCleanup(); tabCleanup = null; }
    } catch (err) {
      clear(body);
      body.appendChild(emptyState({
        title: t('c.error'),
        desc: err instanceof ApiError ? err.describe() : String(err && err.message ? err.message : err),
        iconName: 'alert',
        action: h('button.btn.btn--sm.btn--primary', {
          type: 'button', on: { click: () => switchTab(id) },
        }, t('c.retry')),
      }));
    }
  }

  await switchTab(activeTab);

  return function cleanup() {
    if (tabCleanup) { try { tabCleanup(); } catch { /* ignore */ } tabCleanup = null; }
    activeTab = null;
  };
}

function resolveTab(sub) {
  const fromHash = (sub || '').split('/')[0];
  if (TAB_RENDER[fromHash]) return fromHash;
  const saved = store.getJSON(store.keys.adminTab, null);
  if (TAB_RENDER[saved]) return saved;
  return 'overview';
}

/* ---------------------------------------------------------------------------
 * 通用小件
 * ------------------------------------------------------------------------ */

function toolRow(...nodes) { return h('div.row.row--sm.row--wrap', ...nodes); }

function iconBtn(iconName, label, onClick, variant = '') {
  const btn = h('button.btn.btn--sm', {
    type: 'button',
    class: variant === 'danger' ? 'btn--danger' : variant === 'ghost' ? 'btn--ghost' : '',
    title: label, 'aria-label': label,
    on: { click: (ev) => onClick(ev) },
  }, icon(iconName, 'icon icon--14'));
  return btn;
}

function textBtn(iconName, label, onClick, variant = '') {
  return h('button.btn.btn--sm', {
    type: 'button',
    class: variant === 'primary' ? 'btn--primary' : variant === 'danger' ? 'btn--danger' : '',
    on: { click: (ev) => onClick(ev) },
  }, iconName ? icon(iconName, 'icon icon--14') : null, label);
}

function statusTag(ok, textOn, textOff) {
  return h('span.row.row--sm',
    dot(ok ? 'ok' : 'idle'),
    h('span', ok ? textOn : textOff),
  );
}

function renderErrorCard(body, err, retry) {
  clear(body);
  body.appendChild(h('div.card', h('div.card__body',
    emptyState({
      title: t('c.error'),
      desc: err instanceof ApiError ? err.describe() : String(err && err.message ? err.message : err),
      iconName: 'alert',
      action: h('button.btn.btn--sm.btn--primary', { type: 'button', on: { click: retry } }, t('c.retry')),
    }))));
}

/* ---------------------------------------------------------------------------
 * 概览
 * ------------------------------------------------------------------------ */

async function renderOverview(body) {
  clear(body);
  let data;
  try {
    data = await api.admin('/admin/api/overview');
  } catch (err) {
    renderErrorCard(body, err, () => renderOverview(body));
    return;
  }

  const stat = (label, iconName, value, unit, foot) => h('div.stat',
    h('div.stat__label', icon(iconName, 'icon icon--14'), label),
    h('div.stat__value', value, unit ? h('span.stat__unit', unit) : null),
    h('div.stat__foot', foot || ''),
  );

  const keys = data.keys || {};
  const pool = data.pool || {};
  const models = data.models || {};
  const req = data.requests || {};
  const up = data.upstream || {};

  const grid = h('div.stat-grid',
    stat(t('ad.ov.keys'), 'key', String(keys.total ?? '—'), null, t('ad.ov.keys.foot').replace('{n}', String(keys.enabled ?? '—'))),
    stat(t('ad.ov.pool'), 'users', `${pool.healthy ?? '—'}/${pool.total ?? '—'}`, null, t('ad.ov.pool.foot').replace('{n}', String(pool.cooldown ?? 0))),
    stat(t('ad.ov.models'), 'sliders', `${models.enabled ?? '—'}/${models.total ?? '—'}`, null, t('ad.ov.models.foot').replace('{n}', String(models.total ?? '—'))),
    stat(t('ad.ov.today'), 'sparkles', String(req.today ?? '—'), null,
      t('ad.ov.today.foot').replace('{total}', String(req.total ?? '—')).replace('{failed}', String(req.failed ?? '—'))),
    h('div.stat', { class: up.reachable ? 'stat--accent' : '' },
      h('div.stat__label', icon('shield', 'icon icon--14'), t('ad.ov.upstream')),
      h('div.stat__value',
        h('span.row.row--sm', dot(up.reachable ? 'ok' : 'bad', true),
          up.reachable ? t('ad.ov.upstream.ok') : t('ad.ov.upstream.bad'))),
      h('div.stat__foot', t('ad.ov.upstream.foot').replace('{n}', String(up.latency_ms ?? '—')))),
  );

  const runtime = h('div.card',
    h('div.card__head', h('div.card__title', icon('info', 'icon icon--14'), t('ad.ov.runtime'))),
    h('div.card__body',
      h('div.kv',
        h('div.muted', t('ad.ov.version')), h('div.mono', String(data.version ?? '—')),
        h('div.muted', t('ad.ov.uptime')), h('div', fmtDuration(data.uptime || 0)),
        h('div.muted', 'GET /admin/api/overview'), h('div.mono', fmtTime(Math.floor(Date.now() / 1000))),
      ),
    ),
  );

  const selftestCard = h('div.card',
    h('div.card__head',
      h('div.card__title', icon('check-circle', 'icon icon--14'), t('ad.ov.selftest')),
      h('span.card__sub', t('ad.ov.selftest.hint')),
      h('span.spacer'),
      h('button.btn.btn--sm.btn--primary', {
        type: 'button',
        on: {
          click: (ev) => busy(ev.currentTarget, async () => {
            const box = selftestCard.querySelector('.selftest-list');
            clear(box);
            box.appendChild(skeletonLines(3));
            try {
              const res = await api.admin('/admin/api/selftest', { method: 'POST' });
              renderSelftest(box, res);
              toast(res.ok ? t('ad.set.selftest.ok') : t('ad.set.selftest.fail'),
                { type: res.ok ? 'ok' : 'error' });
            } catch (err) {
              clear(box);
              box.appendChild(h('div.toast--error', { style: { padding: '12px' } }, err instanceof ApiError ? err.describe() : String(err)));
            }
          }),
        },
      }, icon('check-circle', 'icon icon--14'), t('ad.set.selftest')),
    ),
    h('div.card__body', h('div.selftest-list', h('div.field__hint', t('ad.ov.selftest.hint')))),
  );

  body.appendChild(grid);
  body.appendChild(h('div.grid-2', runtime, selftestCard));
}

function renderSelftest(box, res) {
  clear(box);
  const items = (res.items || []);
  if (!items.length) { box.appendChild(h('div.field__hint', t('c.empty'))); return; }
  for (const item of items) {
    box.appendChild(h('div.selftest-item',
      h('span', { style: { marginTop: '2px' } }, dot(item.ok ? 'ok' : 'bad', !!item.ok)),
      h('div.stack.stack--xs.truncate',
        h('div.selftest-item__name', item.name),
        item.message ? h('div.selftest-item__msg', item.message) : null),
      item.ms !== undefined ? h('span.selftest-item__ms', `${item.ms} ms`) : null,
    ));
  }
}

/* ---------------------------------------------------------------------------
 * API KEY
 * ------------------------------------------------------------------------ */

async function loadModelsForPicker() {
  const now = Date.now();
  if (MODELS_CACHE.items && now - MODELS_CACHE.at < 30000) return MODELS_CACHE.items;
  const res = await api.admin('/admin/api/models');
  MODELS_CACHE.items = res.items || [];
  MODELS_CACHE.at = now;
  return MODELS_CACHE.items;
}

async function renderKeys(body) {
  clear(body);
  let items = [];
  async function load(showSkeleton = true) {
    if (showSkeleton) {
      clear(body);
      body.appendChild(h('div.card', h('div.card__body', skeletonLines(4))));
    }
    try {
      const res = await api.admin('/admin/api/keys');
      items = res.items || [];
      paint();
    } catch (err) {
      renderErrorCard(body, err, () => load());
    }
  }

  function scopeLabel(key) {
    const list = key.models || [];
    if (!list.length || list.includes('*')) return t('c.all');
    if (list.length <= 2) return list.join(', ');
    return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
  }

  function paint() {
    clear(body);
    const table = dataTable({
      columns: [
        { key: 'name', label: t('ad.keys.name'), render: (k) => h('div.stack.stack--xs',
          h('div.cell-main', k.name || '—'),
          k.note ? h('div.cell-sub', k.note) : null) },
        { key: 'prefix', label: t('ad.keys.prefix'), render: (k) => h('span.mono', `${k.prefix || 'sk-civ-…'}…${k.last4 || '----'}`) },
        { key: 'enabled', label: t('ad.keys.status'), render: (k) => statusTag(!!k.enabled, t('ad.keys.enabled'), t('ad.keys.disabled')) },
        { key: 'models', label: t('ad.keys.scope'), render: (k) => h('span', { title: (k.models || []).join('\n') }, scopeLabel(k)) },
        { key: 'rpm', label: t('ad.keys.rpm'), render: (k) => h('span.mono', String(k.rpm ?? 0)) },
        { key: 'used', label: t('ad.keys.usage'), render: (k) => h('div.stack.stack--xs',
          h('div.mono', `${fmtNum(k.used ?? 0)}${k.quota ? ` / ${fmtNum(k.quota)}` : ''}`),
          k.last_used ? h('div.cell-sub', fmtRelative(k.last_used)) : null) },
        { key: 'created', label: t('ad.keys.created'), render: (k) => h('span.mono', fmtTime(k.created)) },
        {
          key: 'actions', label: t('c.actions'), className: 'col-actions', render: (k) => h('div.actions',
            iconBtn(k.enabled ? 'x' : 'check', k.enabled ? t('c.disable') : t('c.enable'), async (ev) => {
              await patchKey(k, { enabled: !k.enabled }, ev.currentTarget);
            }),
            iconBtn('refresh', t('ad.keys.reset'), async (ev) => {
              await busy(ev.currentTarget, async () => {
                try {
                  await api.admin(`/admin/api/keys/${encodeURIComponent(k.id)}/reset`, { method: 'POST' });
                  toast(t('ad.keys.reset.done'), { type: 'ok' });
                  load(false);
                } catch (err) { toastError(err); }
              });
            }),
            iconBtn('trash', t('c.delete'), async () => {
              const ok = await confirmDialog({
                title: t('c.delete'),
                message: t('ad.keys.delete.confirm').replace('{name}', k.name || k.id),
                confirmLabel: t('c.delete'), danger: true,
              });
              if (!ok) return;
              try {
                await api.admin(`/admin/api/keys/${encodeURIComponent(k.id)}`, { method: 'DELETE' });
                toast(t('ad.keys.deleted'), { type: 'ok' });
                load(false);
              } catch (err) { toastError(err); }
            }, 'danger'),
          ),
        },
      ],
      rows: items,
      empty: {
        title: t('ad.keys.empty'),
        desc: t('ad.keys.empty.desc'),
        icon: 'key',
        action: h('button.btn.btn--sm.btn--primary', { type: 'button', on: { click: () => openCreate() } }, t('ad.keys.new')),
      },
    });

    body.appendChild(h('div.card',
      h('div.card__head',
        h('div.card__title', icon('key', 'icon icon--14'), t('ad.tab.keys')),
        h('span.card__sub', `${items.length} / ${items.filter((k) => k.enabled).length} ${pick('启用', 'enabled')}`),
        h('span.spacer'),
        toolRow(
          textBtn('refresh', t('c.refresh'), () => load(false)),
          textBtn('plus', t('ad.keys.new'), () => openCreate(), 'primary'),
        )),
      table,
    ));
  }

  async function patchKey(key, patch, btn) {
    await busy(btn, async () => {
      try {
        await api.admin(`/admin/api/keys/${encodeURIComponent(key.id)}`, { method: 'PATCH', body: patch });
        toast(t('ad.keys.updated'), { type: 'ok' });
        load(false);
      } catch (err) { toastError(err); }
    });
  }

  async function openCreate() {
    let models = [];
    try { models = await loadModelsForPicker(); } catch (err) { toastError(err); }

    const nameInput = textInput({ placeholder: 'cherry-studio' });
    const noteInput = textInput({ placeholder: t('ad.keys.note.ph') });
    const rpmInput = numberInput({ value: 60, min: 0, max: 100000 });
    const quotaInput = numberInput({ value: 0, min: 0, max: 10000000 });

    let allChecked = true;
    const selected = new Set(models.map((m) => m.alias));
    const list = h('div.stack.stack--xs', { style: { maxHeight: '220px', overflowY: 'auto' } });

    function paintModels() {
      clear(list);
      for (const m of models) {
        list.appendChild(checkbox({
          checked: allChecked || selected.has(m.alias),
          label: `${m.label} · ${m.sub_label}`,
          disabled: allChecked,
          onChange: (v) => { if (v) selected.add(m.alias); else selected.delete(m.alias); },
        }));
      }
    }

    const allBox = checkbox({
      checked: true,
      label: t('ad.keys.models.all'),
      onChange: (v) => { allChecked = v; paintModels(); },
    });
    paintModels();

    openModal({
      title: t('ad.keys.new'),
      sub: t('ad.keys.created.note'),
      width: 'wide',
      body: h('div.stack',
        h('div.grid-2',
          field(t('ad.keys.name'), nameInput),
          field(t('ad.keys.note'), noteInput)),
        h('div.grid-2',
          field(t('ad.keys.rpm'), rpmInput, { hint: t('ad.keys.rpm.hint') }),
          field(t('ad.keys.quota'), quotaInput, { hint: t('ad.keys.quota.hint') })),
        h('div.field',
          h('label.field__label', t('ad.keys.models')),
          allBox,
          list,
          h('div.field__hint', t('ad.keys.models.hint'))),
      ),
      actions: [
        { label: t('c.cancel') },
        {
          label: t('c.confirm'),
          variant: 'primary',
          closeAfter: false,
          onClick: async (ev, handle) => {
            const name = nameInput.value.trim();
            if (!name) { toast(t('ad.keys.name.required'), { type: 'error' }); nameInput.focus(); return; }
            const payload = {
              name,
              note: noteInput.value.trim(),
              models: allChecked ? ['*'] : Array.from(selected),
              rpm: Number(rpmInput.value) || 0,
              quota: Number(quotaInput.value) || 0,
            };
            try {
              const created = await api.admin('/admin/api/keys', { method: 'POST', body: payload });
              handle.close();
              showPlaintext(created);
              load(false);
            } catch (err) {
              toastError(err);
            }
          },
        },
      ],
    });
  }

  function showPlaintext(created) {
    const plain = created.key || created.plaintext || '';
    const keyBox = h('code.onetime__key', plain || '—');
    const copyBtn = h('button.btn.btn--primary.btn--sm', {
      type: 'button',
      on: {
        click: async () => {
          const ok = await copyText(plain);
          toast(ok ? t('c.copied') : t('c.copyFailed'), { type: ok ? 'ok' : 'error' });
        },
      },
    }, icon('copy', 'icon icon--14'), t('ad.keys.created.copy'));

    const useBtn = h('button.btn.btn--sm', {
      type: 'button',
      on: {
        click: () => {
          store.setApiKey(plain);
          toast(t('ad.keys.created.used'), { type: 'ok' });
          location.reload();
        },
      },
    }, icon('key', 'icon icon--14'), t('ad.keys.created.use'));

    openModal({
      title: t('ad.keys.created.title'),
      width: 'md',
      dismissible: false,
      body: h('div.onetime',
        h('div.onetime__head', icon('alert', 'icon icon--16'), t('ad.keys.created.title')),
        keyBox,
        h('div.onetime__note', t('ad.keys.created.note')),
        h('div.btn-row', copyBtn, useBtn),
      ),
      actions: [{ label: t('c.close'), variant: 'primary' }],
    });
  }

  await load();
}

/* ---------------------------------------------------------------------------
 * 号池
 * ------------------------------------------------------------------------ */

const FALLBACK_PROVIDERS = [
  { id: 'emailnator', label: 'emailnator' },
  { id: 'temp.tf', label: 'temp.tf' },
  { id: 'boomlify', label: 'boomlify' },
  { id: 'relay.firefox.com', label: 'relay.firefox.com' },
];

async function renderPool(body) {
  clear(body);
  let accounts = [];
  const tickers = [];
  let jobPoller = null;
  let currentJob = null;
  let captchaModalShown = false;

  /* ---- 账号表 ---- */
  const accountsCard = h('div.card');
  const refillCard = h('div.card');
  body.appendChild(accountsCard);
  body.appendChild(refillCard);

  async function loadAccounts(skeleton = true) {
    if (skeleton) {
      clear(accountsCard);
      accountsCard.appendChild(h('div.card__body', skeletonLines(5)));
    }
    try {
      const res = await api.admin('/admin/api/accounts');
      accounts = res.items || [];
      paintAccounts();
    } catch (err) {
      clear(accountsCard);
      accountsCard.appendChild(h('div.card__body',
        emptyState({
          title: t('c.error'),
          desc: err instanceof ApiError ? err.describe() : String(err),
          iconName: 'alert',
          action: h('button.btn.btn--sm.btn--primary', { type: 'button', on: { click: () => loadAccounts() } }, t('c.retry')),
        })));
    }
  }

  function cooldownCell(acc) {
    const el = h('span.mono', acc.cooldown_sec > 0 ? t('ad.pool.cd').replace('{n}', String(acc.cooldown_sec)) : t('ad.pool.cd.ready'));
    if (acc.cooldown_sec > 0) {
      const timer = setInterval(() => {
        acc.cooldown_sec = Math.max(0, acc.cooldown_sec - 1);
        if (!el.isConnected) { clearInterval(timer); return; }
        el.textContent = acc.cooldown_sec > 0 ? t('ad.pool.cd').replace('{n}', String(acc.cooldown_sec)) : t('ad.pool.cd.ready');
        if (acc.cooldown_sec === 0) clearInterval(timer);
      }, 1000);
      tickers.push(timer);
    }
    return el;
  }

  function healthCell(acc) {
    const kind = !acc.enabled ? 'idle' : acc.healthy ? 'ok' : 'bad';
    const label = !acc.enabled ? t('ad.pool.off') : acc.healthy ? t('ad.pool.healthy') : t('ad.pool.unhealthy');
    return h('span.row.row--sm', dot(kind, acc.healthy && acc.enabled), h('span', label));
  }

  function stopTickers() {
    for (const timer of tickers) clearInterval(timer);
    tickers.length = 0;
  }

  function paintAccounts() {
    stopTickers();
    clear(accountsCard);

    const table = dataTable({
      columns: [
        {
          key: 'label', label: t('ad.pool.label'), render: (a) => h('div.stack.stack--xs',
            h('div.cell-main', a.label || a.email || a.id),
            a.email && a.email !== a.label ? h('div.cell-sub.mono', a.email) : null),
        },
        { key: 'health', label: t('ad.pool.health'), render: healthCell },
        { key: 'cooldown', label: t('ad.pool.cooldown'), render: cooldownCell },
        { key: 'requests', label: t('ad.pool.requests'), render: (a) => h('span.mono', String(a.requests ?? 0)) },
        { key: 'failures', label: t('ad.pool.failures'), render: (a) => h('span.mono', String(a.failures ?? 0)) },
        {
          key: 'quota', label: t('ad.pool.quota'), render: (a) => {
            const q = a.quota || {};
            return h('span.mono.subtle', t('ad.pool.quota.fmt')
              .replace('{image}', String(q.image ?? '—'))
              .replace('{video}', String(q.video ?? '—'))
              .replace('{balance}', String(q.balance ?? '—')));
          },
        },
        {
          key: 'last_error', label: t('ad.pool.lasterr'), render: (a) => (a.last_error
            ? h('span.danger-text.truncate', { style: { display: 'inline-block', maxWidth: '260px' }, title: a.last_error }, a.last_error)
            : h('span.subtle', t('c.none'))),
        },
        {
          key: 'actions', label: t('c.actions'), className: 'col-actions', render: (a) => h('div.actions',
            iconBtn('shield', t('ad.pool.check'), async (ev) => {
              await busy(ev.currentTarget, async () => {
                try {
                  await api.admin(`/admin/api/accounts/${encodeURIComponent(a.id)}/check`, { method: 'POST' });
                  toast(t('ad.pool.check.done'), { type: 'ok' });
                  loadAccounts(false);
                } catch (err) { toastError(err); }
              });
            }),
            iconBtn(a.enabled ? 'power' : 'check', a.enabled ? t('c.disable') : t('c.enable'), async (ev) => {
              await busy(ev.currentTarget, async () => {
                try {
                  await api.admin(`/admin/api/accounts/${encodeURIComponent(a.id)}/enable`, {
                    method: 'POST', body: { enabled: !a.enabled },
                  });
                  toast(a.enabled ? t('ad.pool.disabled') : t('ad.pool.enabled'), { type: 'ok' });
                  loadAccounts(false);
                } catch (err) { toastError(err); }
              });
            }),
            iconBtn('trash', t('c.delete'), async () => {
              const ok = await confirmDialog({
                title: t('c.delete'),
                message: t('ad.pool.delete.confirm').replace('{label}', a.label || a.id),
                confirmLabel: t('c.delete'), danger: true,
              });
              if (!ok) return;
              try {
                await api.admin(`/admin/api/accounts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
                toast(t('ad.pool.deleted'), { type: 'ok' });
                loadAccounts(false);
              } catch (err) { toastError(err); }
            }, 'danger'),
          ),
        },
      ],
      rows: accounts,
      empty: {
        title: t('ad.pool.empty'),
        desc: t('ad.pool.empty.desc'),
        icon: 'users',
        action: h('button.btn.btn--sm.btn--primary', { type: 'button', on: { click: openAddAccount } }, t('ad.pool.add')),
      },
    });

    accountsCard.appendChild(h('div.card__head',
      h('div.card__title', icon('users', 'icon icon--14'), t('ad.pool.accounts')),
      h('span.card__sub', `${accounts.filter((a) => a.healthy && a.enabled).length}/${accounts.length} ${t('ad.pool.healthy')}`),
      h('span.spacer'),
      toolRow(
        textBtn('refresh', t('c.refresh'), () => loadAccounts(false)),
        textBtn('upload', t('ad.pool.import'), openImport),
        textBtn('plus', t('ad.pool.add'), openAddAccount, 'primary'),
      )));
    accountsCard.appendChild(table);
  }

  function openAddAccount() {
    const cookieInput = h('textarea.textarea.input--mono', { rows: 5, placeholder: t('ad.pool.add.cookie.ph') });
    const labelInput = textInput({ placeholder: t('ad.pool.add.label.ph') });
    openModal({
      title: t('ad.pool.add.title'),
      width: 'md',
      body: h('div.stack',
        field(t('ad.pool.add.label'), labelInput),
        field(t('ad.pool.add.cookie'), cookieInput, { hint: t('ad.pool.add.cookie.hint') })),
      actions: [
        { label: t('c.cancel') },
        {
          label: t('c.confirm'),
          variant: 'primary',
          closeAfter: false,
          onClick: async (ev, handle) => {
            const cookie = cookieInput.value.trim();
            if (!cookie) { toast(t('ad.pool.add.cookie'), { type: 'error' }); cookieInput.focus(); return; }
            try {
              await api.admin('/admin/api/accounts', {
                method: 'POST',
                body: {
                  cookie,
                  label: labelInput.value.trim() || t('ad.pool.add.label.ph'),
                  email: cookie.length < 40 ? cookie : undefined,
                },
              });
              handle.close();
              toast(t('c.saved'), { type: 'ok' });
              loadAccounts(false);
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  }

  function openImport() {
    const text = h('textarea.textarea.input--mono', { rows: 8, placeholder: 'cookie1\ncookie2\ncookie3' });
    const label = textInput({ value: t('ad.pool.import.label'), placeholder: t('ad.pool.import.label') });
    openModal({
      title: t('ad.pool.import.title'),
      width: 'md',
      body: h('div.stack',
        field(t('ad.pool.import.text'), text),
        field(t('ad.pool.import.label'), label)),
      actions: [
        { label: t('c.cancel') },
        {
          label: t('c.import'),
          variant: 'primary',
          closeAfter: false,
          onClick: async (ev, handle) => {
            const value = text.value.trim();
            if (!value) { toast(t('ad.pool.import.empty'), { type: 'error' }); return; }
            try {
              const res = await api.admin('/admin/api/accounts/import', {
                method: 'POST', body: { text: value, label: label.value.trim() },
              });
              handle.close();
              toast(t('ad.pool.import.count').replace('{n}', String(res.imported ?? '?')), { type: 'ok' });
              loadAccounts(false);
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
  }

  /* ---- 一键注册补号 ---- */
  let providers = FALLBACK_PROVIDERS;
  try {
    const res = await api.admin('/admin/api/mail/providers');
    if (res && Array.isArray(res.items) && res.items.length) providers = res.items;
  } catch { /* 用兜底列表 */ }

  // provider 的标识可能是 name（后端 /admin/api/mail/providers 的字段）或 id（兜底列表），
  // 两者都要认；缺失时直接回落到默认源，绝不能把 undefined 字符串发回后端。
  const providerKey = (p) => p && (p.name || p.id) ? String(p.name || p.id) : 'emailnator';
  const providerLabel = (p) => String(p.label || providerKey(p));
  const providerList = providers
    .map((p) => ({ key: providerKey(p), label: providerLabel(p), available: p.available !== false }))
    .filter((p) => p.key && p.key !== 'undefined' && p.key !== 'null');

  const countInput = numberInput({ value: 2, min: 1, max: 10, width: '92px' });
  const providerSelect = selectInput({
    options: providerList.map((p) => ({
      value: p.key,
      label: p.label + (p.available ? '' : pick('（不可用）', ' (unavailable)')),
    })),
    value: (providerList[0] && providerList[0].key) || 'emailnator',
  });
  const verifySwitch = switchEl({ checked: true, label: t('ad.refill.verify') });
  const timeline = h('div.timeline', h('div.field__hint', t('ad.refill.nojob')));

  const captchaBox = h('div', { style: { display: 'none' } });

  const startBtn = h('button.btn.btn--primary.btn--sm', {
    type: 'button',
    on: {
      click: (ev) => busy(ev.currentTarget, async () => {
        try {
          const res = await api.admin('/admin/api/pool/refill', {
            method: 'POST',
            body: {
              count: Number(countInput.value) || 1,
              provider: providerSelect.value || 'emailnator',
              verify: verifySwitch.getAttribute('aria-checked') === 'true',
            },
          });
          currentJob = res.job;
          captchaModalShown = false;
          toast(t('ad.refill.submitted'), { desc: res.job, type: 'ok' });
          paintJob(res);
          startPolling(res.job);
        } catch (err) { toastError(err); }
      }),
    },
  }, icon('sparkles', 'icon icon--14'), t('ad.refill.start'));

  refillCard.appendChild(h('div.card__head',
    h('div.card__title', icon('mail', 'icon icon--14'), t('ad.refill.title')),
    h('span.card__sub', t('ad.refill.stages')),
    h('span.spacer'),
    toolRow(
      h('span.card__sub', t('ad.refill.count')), countInput,
      h('span.card__sub', t('ad.refill.provider')), providerSelect,
      h('span.row.row--sm', verifySwitch, h('span.card__sub', t('ad.refill.verify'))),
      startBtn,
    )));
  refillCard.appendChild(h('div.card__body', h('div.stack', captchaBox, timeline)));

  function paintJob(job) {
    const statusKey = `ad.refill.status.${job.status}`;
    const statusLabel = t(statusKey, job.status);
    const kindMap = { done: 'ok', running: 'warn', waiting_captcha: 'warn', failed: 'bad' };
    clear(timeline);
    timeline.appendChild(h('div.row.row--sm.row--wrap',
      dot(kindMap[job.status] || 'idle', job.status === 'running' || job.status === 'waiting_captcha'),
      h('strong', statusLabel),
      h('span.mono.subtle', job.job),
      h('span.card__sub', t('ad.refill.target')
        .replace('{done}', String(job.done ?? 0)).replace('{target}', String(job.target ?? 0))),
      h('span.card__sub', `provider=${job.provider}`),
      job.status === 'waiting_captcha'
        ? h('button.btn.btn--sm.btn--ghost', {
          type: 'button',
          on: { click: () => openCaptcha(job, true) },
        }, icon('key', 'icon icon--14'), t('ad.refill.captcha.open'))
        : null,
    ));

    // 按邮箱分组渲染步骤时间线
    const groups = new Map();
    for (const step of job.steps || []) {
      if (!groups.has(step.email)) groups.set(step.email, []);
      groups.get(step.email).push(step);
    }
    const order = ['mailbox', 'sendEmail', 'captcha', 'confirm', 'loginRegister', 'done', 'failed'];
    for (const [email, steps] of groups) {
      const last = steps[steps.length - 1];
      const groupEl = h('div.timeline__group');
      groupEl.appendChild(h('div.timeline__mail', email));
      const list = h('div.timeline__steps');
      const sorted = steps.slice().sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
      sorted.forEach((step, i) => {
        const isLast = i === sorted.length - 1;
        const state = step.stage === 'failed' ? 'is-failed'
          : isLast && job.status !== 'done' ? 'is-active' : 'is-done';
        list.appendChild(h('div.timeline__step', { class: state },
          h('div.timeline__rail',
            h('div.timeline__dot'),
            h('div.timeline__line')),
          h('div.timeline__content',
            h('div.timeline__stage', t(`ad.refill.stage.${step.stage}`, step.stage)),
            h('div.timeline__msg', step.message || ''),
            h('div.timeline__msg.mono', fmtTime(step.at))),
        ));
      });
      groupEl.appendChild(list);
      timeline.appendChild(groupEl);
    }
    if (job.status === 'done' && (job.accounts || []).length) {
      timeline.appendChild(h('div.field__hint', t('ad.refill.accounts').replace('{n}', String(job.accounts.length))));
    }

    if (job.status === 'waiting_captcha' && job.need_captcha) {
      openCaptcha(job, false);
      captchaBox.style.display = 'none';
    } else {
      captchaBox.style.display = 'none';
    }
  }

  function openCaptcha(job, force) {
    if (captchaModalShown && !force) return;
    captchaModalShown = true;
    const nc = job.need_captcha || {};
    const input = h('textarea.textarea.input--mono', { rows: 3, placeholder: 'captcha_verify=…' });
    const hintBox = h('div.field__hint', t('ad.cap.hostHint'));

    // 主路径：开托管窗口，用户拖一次滑块，网关自动把 token 回填给这个任务
    const hostBtn = h('button.btn.btn--primary', {
      type: 'button',
      on: {
        click: (ev) => busy(ev.currentTarget, async () => {
          try {
            await api.admin('/admin/api/browser/launch', {
              method: 'POST', body: { url: 'https://modelscope.ai/login', headless: false },
            });
            toast(t('ad.cap.opened'), { desc: t('ad.cap.openedDesc'), type: 'ok' });
            watchForCaptcha(job.job, handle => {
              toast(t('ad.cap.autoFilled'), { type: 'ok' });
              try { handle.close(); } catch { /* ignore */ }
              startPolling(job.job);
            });
          } catch (err) { toastError(err); }
        }),
      },
    }, icon('globe', 'icon icon--14'), t('ad.cap.hostBtn'));

    const handle = openModal({
      title: t('ad.refill.captcha.title'),
      sub: t('ad.refill.captcha.desc')
        .replace('{email}', nc.email || '—')
        .replace('{scene}', nc.scene_id || '—')
        .replace('{prefix}', nc.prefix || '—'),
      width: 'md',
      body: h('div.stack',
        h('div.stack.stack--sm',
          h('div.field__label', t('ad.cap.hostTitle')),
          hostBtn,
          hintBox),
        h('div.divider'),
        h('div.field__label', t('ad.cap.manualTitle')),
        field(t('ad.refill.captcha.label'), input, { hint: t('ad.cap.manualHint') })),
      actions: [
        { label: t('c.cancel') },
        {
          label: t('ad.refill.captcha.submit'),
          variant: 'primary',
          closeAfter: false,
          onClick: async (ev, h2) => {
            const value = input.value.trim();
            if (!value) { toast(t('ad.refill.captcha.required'), { type: 'error' }); input.focus(); return; }
            try {
              const res = await api.admin(`/admin/api/pool/refill/${encodeURIComponent(job.job)}/captcha`, {
                method: 'POST', body: { captcha_verify: value },
              });
              h2.close();
              toast(t('ad.refill.captcha.done'), { type: 'ok' });
              paintJob(res);
              startPolling(job.job);
            } catch (err) { toastError(err); }
          },
        },
      ],
    });
    return handle;
  }

  /**
   * 轮询托管浏览器，等它嗅到 captcha_verify。
   * 网关在嗅到 token 的瞬间已经自动回填给 waiting_captcha 的任务，
   * 这里只是把「已回填」这个结果反馈给界面。
   */
  function watchForCaptcha(jobId, onFilled) {
    let n = 0;
    const timer = setInterval(async () => {
      n += 1;
      if (n > 150) { clearInterval(timer); return; }   // 5 分钟上限
      try {
        const st = await api.admin('/admin/api/browser/status');
        if (st && st.captcha && st.captcha.length) {
          clearInterval(timer);
          if (onFilled) onFilled({ close() {} });
        }
        if (n % 6 === 0) {
          const jb = await api.admin(`/admin/api/pool/refill/${encodeURIComponent(jobId)}`);
          if (jb.status !== 'waiting_captcha') { clearInterval(timer); startPolling(jobId); }
        }
      } catch { /* 忽略瞬时错误 */ }
    }, 2000);
    return () => clearInterval(timer);
  }

  function startPolling(jobId) {
    stopPolling();
    let attempt = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      attempt += 1;
      try {
        const job = await api.admin(`/admin/api/pool/refill/${encodeURIComponent(jobId)}`);
        paintJob(job);
        if (job.status === 'done' || job.status === 'failed') {
          stopPolling();
          loadAccounts(false);
          return;
        }
      } catch (err) {
        if (attempt > 200) { stopPolling(); toastError(err); return; }
      }
      const delay = Math.min(5000, 1500 * Math.pow(1.25, attempt - 1));
      jobPoller = setTimeout(tick, delay);
    };
    jobPoller = setTimeout(tick, 1200);
  }

  function stopPolling() {
    if (jobPoller) { clearTimeout(jobPoller); jobPoller = null; }
  }

  await loadAccounts();

  /* ---- 浏览器托管卡片 ---- */
  const brCard = await buildBrowserCard();
  if (brCard) body.appendChild(brCard);

  return function cleanup() {
    stopTickers();
    stopPolling();
    if (brTimer) { clearInterval(brTimer); brTimer = null; }
  };
}

/* ---------------------------------------------------------------------------
 * 浏览器托管（在 renderPool 之外，供号池页复用）
 * ------------------------------------------------------------------------ */

let brTimer = null;

async function buildBrowserCard() {
  const statusBox = h('div.row.row--sm.row--wrap');
  const extraBox = h('div.stack.stack--sm');
  const btnRow = h('div.row.row--sm.row--wrap');
  let lastState = '';

  async function refresh() {
    let st = {};
    try { st = await api.admin('/admin/api/browser/status'); } catch { st = {}; }
    const state = st.state || 'idle';
    const kindMap = { running: 'ok', launching: 'warn', error: 'bad', idle: 'idle', ready: 'warn' };
    clear(statusBox);
    statusBox.appendChild(dot(kindMap[state] || 'idle', state === 'running' || state === 'launching'));
    statusBox.appendChild(h('strong', t(`ad.br.state.${state}`, state)));
    if (st.url) statusBox.appendChild(h('span.mono.subtle', String(st.url).slice(0, 70)));
    statusBox.appendChild(h('span.card__sub', t('ad.br.cookies').replace('{n}', String(st.last_cookie_count ?? 0))));
    const capLen = (st.captcha && st.captcha.length) || 0;
    statusBox.appendChild(h('span.card__sub',
      capLen ? t('ad.br.captcha').replace('{n}', String(capLen)) : t('ad.br.captcha.none')));
    lastState = state;
  }

  function need(ev, fn) {
    return busy(ev.currentTarget, async () => {
      try { await fn(); } catch (err) { toastError(err); }
      await refresh();
    });
  }

  btnRow.appendChild(h('button.btn.btn--sm.btn--primary', {
    type: 'button',
    on: { click: (ev) => need(ev, () => api.admin('/admin/api/browser/launch',
      { method: 'POST', body: { url: 'https://modelscope.ai/', headless: false } })) },
  }, icon('globe', 'icon icon--14'), t('ad.br.open')));

  btnRow.appendChild(h('button.btn.btn--sm', {
    type: 'button',
    on: { click: (ev) => need(ev, () => api.admin('/admin/api/browser/launch',
      { method: 'POST', body: { url: 'https://modelscope.ai/login', headless: false } })) },
  }, icon('link', 'icon icon--14'), t('ad.br.register')));

  btnRow.appendChild(h('button.btn.btn--sm.btn--primary', {
    type: 'button',
    on: {
      click: (ev) => busy(ev.currentTarget, async () => {
        try {
          const res = await api.admin('/admin/api/accounts/from-browser', {
            method: 'POST', body: { label: '' },
          });
          if (res.healthy) {
            toast(t('ad.br.harvest.done').replace('{label}', (res.account && res.account.label) || ''), { type: 'ok' });
          } else {
            toast(t('ad.br.needLogin'), { desc: (res.account && res.account.disabled_reason) || '', type: 'warn' });
          }
          await loadAccounts(false);
        } catch (err) { toastError(err); }
        await refresh();
      }),
    },
  }, icon('download', 'icon icon--14'), t('ad.br.harvest')));

  btnRow.appendChild(h('button.btn.btn--sm', {
    type: 'button',
    on: { click: (ev) => need(ev, () => api.admin('/admin/api/browser/close', { method: 'POST', body: {} })) },
  }, icon('x', 'icon icon--14'), t('ad.br.close')));

  const hostedBtn = h('button.btn.btn--sm', {
    type: 'button',
    on: {
      click: (ev) => busy(ev.currentTarget, async () => {
        try {
          const rec = await api.admin('/admin/api/browser/register',
            { method: 'POST', body: { provider: 'emailnator' } });
          clear(extraBox);
          extraBox.appendChild(h('div.row.row--sm.row--wrap',
            h('span.card__sub', t('ad.br.email')), h('span.mono', rec.email || rec.error || '—')));
          if (rec.error) toast(rec.error, { type: 'error' });
          else toast(t('ad.br.hosted'), { desc: rec.email, type: 'ok' });
          startSessionPoll(rec.id, extraBox);
        } catch (err) { toastError(err); }
        await refresh();
      }),
    },
  }, icon('sparkles', 'icon icon--14'), t('ad.br.hosted'));

  function startSessionPoll(sid, box) {
    if (brTimer) clearInterval(brTimer);
    let n = 0;
    brTimer = setInterval(async () => {
      n += 1;
      if (n > 180) { clearInterval(brTimer); brTimer = null; return; }
      try {
        const s = await api.admin(`/admin/api/browser/register/${encodeURIComponent(sid)}`);
        clear(box);
        box.appendChild(h('div.row.row--sm.row--wrap',
          h('span.card__sub', t('ad.br.email')), h('span.mono', s.email || '—')));
        box.appendChild(h('div.row.row--sm.row--wrap',
          h('span.card__sub', t('ad.br.mailCount').replace('{n}', String(s.message_count ?? 0)))));
        if (s.activation_link) {
          box.appendChild(h('div.row.row--sm.row--wrap',
            h('span.card__sub', t('ad.br.activation')),
            h('button.btn.btn--sm', {
              type: 'button',
              on: { click: () => api.admin('/admin/api/browser/goto',
                { method: 'POST', body: { url: s.activation_link } }).catch(toastError) },
            }, t('ad.br.openLink'))));
        }
        if (s.logged_in_hint) {
          box.appendChild(h('div.row.row--sm', dot('ok', true),
            h('span', t('ad.br.step2'))));
          clearInterval(brTimer); brTimer = null;
        }
      } catch { /* 忽略 */ }
    }, 2500);
  }

  const card = h('div.card',
    h('div.card__head',
      h('div.card__title', icon('globe', 'icon icon--14'), t('ad.br.title')),
      h('span.card__sub', t('ad.br.sub')),
      h('span.spacer'),
      hostedBtn),
    h('div.card__body', h('div.stack',
      statusBox,
      h('div.field__hint', t('ad.br.step1')),
      h('div.field__hint', t('ad.br.step2')),
      h('div.field__hint', t('ad.br.hosted.hint')),
      btnRow,
      extraBox)));

  await refresh();
  if (brTimer) { clearInterval(brTimer); brTimer = null; }
  brTimer = setInterval(refresh, 3000);
  return card;
}

/* ---------------------------------------------------------------------------
 * 模型开关
 * ------------------------------------------------------------------------ */

async function renderModels(body) {
  clear(body);
  let items = [];
  let search = '';
  let kindFilter = '';

  async function load(showSkeleton = true) {
    if (showSkeleton) {
      clear(body);
      body.appendChild(h('div.card', h('div.card__body', skeletonLines(6))));
    }
    try {
      const res = await api.admin('/admin/api/models');
      items = res.items || [];
      paint();
    } catch (err) {
      renderErrorCard(body, err, () => load());
    }
  }

  async function patch(alias, patchBody, okMsg) {
    try {
      const res = await api.admin(`/admin/api/models/${encodeURIComponent(alias)}`, { method: 'PATCH', body: patchBody });
      if (okMsg) toast(okMsg, { type: 'ok', timeout: 1600 });
      return res;
    } catch (err) {
      toastError(err);
      throw err;
    }
  }

  async function bulk(kind, enabled) {
    try {
      const res = await api.admin('/admin/api/models/bulk', { method: 'POST', body: { enabled, kind, except: [] } });
      toast(t('ad.models.bulk.done').replace('{n}', String(res.changed ?? 0)), { type: 'ok' });
      load(false);
    } catch (err) { toastError(err); }
  }

  function rowOf(m) {
    // 别名由后端 registry 从仓库名派生，不支持在线改名；这里只读展示
    const aliasInput = textInput({ value: m.alias, mono: true, disabled: true });
    aliasInput.title = t('ad.models.alias.readonly');
    aliasInput.classList.add('model-row__alias');

    return h('div.model-row', { class: m.enabled ? '' : 'is-off' },
      switchEl({
        checked: !!m.enabled,
        label: m.alias,
        onChange: async (v) => {
          try {
            await patch(m.alias, { enabled: v },
              t('ad.models.toggled').replace('{alias}', m.sub_label || m.alias).replace('{state}', v ? t('ad.models.on') : t('ad.models.off')));
            m.enabled = v;
            const row = document.querySelector(`.model-row[data-alias="${CSS.escape(m.alias)}"]`);
            if (row) row.classList.toggle('is-off', !v);
            updateKindCount(m.kind);
          } catch { /* 已 toast */ }
        },
      }),
      h('div.model-row__main',
        h('div.model-row__title',
          h('span', `${m.label} · ${m.sub_label}`),
          tag(`v${m.version_id}`, 'muted'),
          m.enabled ? tag(t('ad.models.on'), 'accent') : tag(t('ad.models.off'), 'muted')),
        h('div.model-row__sub.truncate', m.model || m.sd_version || '')),
      aliasInput,
      h('span.mono.subtle', m.kind),
    );
  }

  function updateKindCount(kind) {
    const el = document.querySelector(`[data-kind-count="${kind}"]`);
    if (!el) return;
    const list = items.filter((m) => m.kind === kind);
    el.textContent = t('ad.models.enabledCount')
      .replace('{on}', String(list.filter((m) => m.enabled).length))
      .replace('{total}', String(list.length));
  }

  function paint() {
    clear(body);
    const filtered = items.filter((m) => {
      if (kindFilter && m.kind !== kindFilter) return false;
      if (!search) return true;
      return `${m.label} ${m.sub_label} ${m.alias} ${m.model}`.toLowerCase().includes(search);
    });

    const searchInput = h('input.input', {
      type: 'search', placeholder: t('ad.models.search'), value: search,
      style: { width: '260px' },
      on: {
        input: (e) => {
          search = e.target.value.trim().toLowerCase();
          paint();
          const el = body.querySelector('input[type="search"]');
          if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
        },
      },
    });

    const kindChips = chipRow({
      items: [
        { value: '', label: t('c.all') },
        { value: 'image', label: t('ad.models.kind.image') },
        { value: 'video', label: t('ad.models.kind.video') },
        { value: 'audio', label: t('ad.models.kind.audio') },
      ],
      value: kindFilter,
      onChange: (v) => { kindFilter = v; paint(); },
    });

    const wrap = h('div.card',
      h('div.card__head',
        h('div.card__title', icon('sliders', 'icon icon--14'), t('ad.tab.models')),
        h('span.card__sub', `${filtered.length} / ${items.length}`),
        h('span.spacer'),
        toolRow(
          searchInput,
          kindChips,
          textBtn('check', t('ad.models.allOn'), () => bulk(kindFilter, true)),
          textBtn('x', t('ad.models.allOff'), () => bulk(kindFilter, false)),
          iconBtn('refresh', t('c.refresh'), () => load(false)),
        )),
    );

    const kinds = ['image', 'video', 'audio'].filter((k) => !kindFilter || k === kindFilter);
    for (const kind of kinds) {
      const list = filtered.filter((m) => m.kind === kind);
      if (!list.length) continue;
      const group = h('div.kind-group');
      const on = list.filter((m) => m.enabled).length;
      group.appendChild(h('div.kind-head',
        icon(kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'music', 'icon icon--16'),
        h('strong', t(`ad.models.kind.${kind}`)),
        h('span.kind-head__count', { dataset: { kindCount: kind } },
          t('ad.models.enabledCount').replace('{on}', String(on)).replace('{total}', String(list.length))),
        h('span.spacer'),
        textBtn('check', t('ad.models.allOn'), () => bulk(kind, true)),
        textBtn('x', t('ad.models.allOff'), () => bulk(kind, false)),
      ));
      for (const m of list) {
        const row = rowOf(m);
        row.dataset.alias = m.alias;
        group.appendChild(row);
      }
      wrap.appendChild(group);
    }

    if (!filtered.length) {
      wrap.appendChild(h('div.card__body', emptyState({ title: t('ad.models.empty'), iconName: 'sliders' })));
    }
    body.appendChild(wrap);
  }

  await load();
}

/* ---------------------------------------------------------------------------
 * 设置
 * ------------------------------------------------------------------------ */

async function renderSettings(body) {
  clear(body);
  let settings = null;
  let loadError = null;
  try {
    settings = await api.admin('/admin/api/settings');
  } catch (err) {
    // 关键：本地鉴权卡片必须照常渲染，否则缺 Token 的用户没法在界面里填 Token
    loadError = err;
  }

  const controls = settings ? {
    upstream_base: textInput({ value: settings.upstream_base || '', mono: true }),
    timeout: numberInput({ value: settings.timeout ?? 180, min: 1, max: 3600 }),
    pool_size: numberInput({ value: settings.pool_size ?? 3, min: 0, max: 100 }),
    cooldown: numberInput({ value: settings.cooldown ?? 90, min: 0, max: 86400 }),
    strict_model: switchEl({ checked: !!settings.strict_model, label: 'strict_model' }),
    auto_refill: switchEl({ checked: !!settings.auto_refill, label: 'auto_refill' }),
    mail_provider: selectInput({
      options: ['emailnator', 'temp.tf', 'boomlify', 'relay.firefox.com'].map((v) => ({ value: v, label: v })),
      value: settings.mail_provider || 'emailnator',
    }),
    proxy: textInput({ value: settings.proxy || '', mono: true }),
    default_kind: selectInput({
      options: ['image', 'video', 'audio'].map((v) => ({ value: v, label: v })),
      value: settings.default_kind || 'image',
    }),
  } : null;

  const saveBtn = h('button.btn.btn--primary', {
    type: 'button',
    on: {
      click: (ev) => busy(ev.currentTarget, async () => {
        const payload = {
          upstream_base: controls.upstream_base.value.trim(),
          timeout: Number(controls.timeout.value) || 180,
          pool_size: Number(controls.pool_size.value) || 0,
          cooldown: Number(controls.cooldown.value) || 0,
          strict_model: controls.strict_model.getAttribute('aria-checked') === 'true',
          auto_refill: controls.auto_refill.getAttribute('aria-checked') === 'true',
          mail_provider: controls.mail_provider.value,
          proxy: controls.proxy.value.trim(),
          default_kind: controls.default_kind.value,
        };
        try {
          await api.admin('/admin/api/settings', { method: 'PUT', body: payload });
          toast(t('ad.set.saved'), { type: 'ok' });
        } catch (err) { toastError(err); }
      }),
    },
  }, icon('check', 'icon icon--14'), t('ad.set.save'));

  const settingsCard = settings ? h('div.card',
    h('div.card__head',
      h('div.card__title', icon('gear', 'icon icon--14'), t('ad.tab.settings')),
      h('span.card__sub', 'GET / PUT /admin/api/settings'),
      h('span.spacer'),
      saveBtn),
    h('div.card__body',
      h('div.grid-2',
        field(t('ad.set.upstream'), controls.upstream_base, { hint: t('ad.set.upstream.hint') }),
        field(t('ad.set.proxy'), controls.proxy, { hint: t('ad.set.proxy.hint') })),
      h('div.grid-2',
        field(t('ad.set.timeout'), controls.timeout),
        field(t('ad.set.pool'), controls.pool_size),
        field(t('ad.set.cooldown'), controls.cooldown),
        field(t('ad.set.defaultkind'), controls.default_kind)),
      h('div.grid-2',
        field(t('ad.set.provider'), controls.mail_provider),
        h('div.stack.stack--sm',
          h('div.field__label', 'strict_model / auto_refill'),
          h('div.row.row--sm', controls.strict_model, h('span.card__sub', t('ad.set.strict'))),
          h('div.row.row--sm', controls.auto_refill, h('span.card__sub', t('ad.set.autorefill'))))),
    ),
  ) : null;

  /* 本地鉴权 */
  const keyInput = textInput({ value: store.getApiKey(), mono: true, placeholder: 'sk-civ-…' });
  const tokenInput = textInput({ value: store.getAdminToken(), mono: true, placeholder: 'admin token' });
  const baseInput = textInput({ value: store.getBase(), mono: true, placeholder: 'http://127.0.0.1:8000' });

  const authCard = h('div.card',
    h('div.card__head',
      h('div.card__title', icon('key', 'icon icon--14'), t('ad.set.auth')),
      h('span.card__sub', t('ad.set.auth.hint')),
      h('span.spacer'),
      h('button.btn.btn--sm.btn--primary', {
        type: 'button',
        on: {
          click: () => {
            store.setApiKey(keyInput.value.trim());
            store.setAdminToken(tokenInput.value.trim());
            store.setBase(baseInput.value.trim());
            toast(t('ad.set.auth.saved'), { type: 'ok' });
          },
        },
      }, icon('check', 'icon icon--14'), t('c.save'))),
    h('div.card__body',
      h('div.grid-2',
        field(t('ad.set.apikey'), keyInput),
        field(t('ad.set.token'), tokenInput, { hint: t('ad.set.token.hint') })),
      field(t('ad.set.base'), baseInput, { hint: t('ad.set.base.hint') })),
  );

  /* 自检 */
  const selftestBox = h('div.selftest-list');
  const selftestCard = h('div.card',
    h('div.card__head',
      h('div.card__title', icon('check-circle', 'icon icon--14'), t('ad.set.selftest')),
      h('span.card__sub', t('ad.ov.selftest.hint')),
      h('span.spacer'),
      h('button.btn.btn--sm.btn--primary', {
        type: 'button',
        on: {
          click: (ev) => busy(ev.currentTarget, async () => {
            clear(selftestBox);
            selftestBox.appendChild(skeletonLines(4));
            try {
              const res = await api.admin('/admin/api/selftest', { method: 'POST' });
              renderSelftest(selftestBox, res);
              toast(res.ok ? t('ad.set.selftest.ok') : t('ad.set.selftest.fail'), { type: res.ok ? 'ok' : 'error' });
            } catch (err) {
              clear(selftestBox);
              selftestBox.appendChild(h('div.danger-text', { style: { padding: '8px 0' } },
                err instanceof ApiError ? err.describe() : String(err)));
            }
          }),
        },
      }, icon('play', 'icon icon--14'), t('ad.set.selftest'))),
    h('div.card__body', selftestBox),
  );

  // 本地鉴权卡片永远先渲染：缺 Token 时用户必须还能在这里填
  body.appendChild(authCard);
  if (settingsCard) {
    body.appendChild(settingsCard);
  } else {
    const errBox = h('div.stack');
    renderErrorCard(errBox, loadError, () => renderSettings(body));
    body.appendChild(errBox);
  }
  body.appendChild(selftestCard);
}

/* ---------------------------------------------------------------------------
 * 日志
 * ------------------------------------------------------------------------ */

async function renderLogs(body) {
  clear(body);
  let level = '';
  let limit = 200;
  let auto = false;
  let timer = null;
  let loading = false;

  async function load() {
    if (loading) return;
    loading = true;
    const list = document.getElementById('ad-logs-list');
    if (list && !list.children.length) {
      clear(list);
      list.appendChild(h('div', { style: { padding: '16px' } }, skeletonLines(6)));
    }
    try {
      const res = await api.admin('/admin/api/logs', { query: { limit, level } });
      paint(res);
    } catch (err) {
      const el = document.getElementById('ad-logs-list');
      if (el) {
        clear(el);
        el.appendChild(h('div.danger-text', { style: { padding: '16px' } }, err instanceof ApiError ? err.describe() : String(err)));
      }
      if (auto) toggleAuto(false);
    } finally {
      loading = false;
    }
  }

  function paint(res) {
    const el = document.getElementById('ad-logs-list');
    if (!el) return;
    clear(el);
    const items = res.items || [];
    if (!items.length) {
      el.appendChild(emptyState({ title: t('ad.logs.empty'), desc: t('ad.logs.empty.desc'), iconName: 'terminal' }));
    } else {
      for (const line of items) {
        el.appendChild(h('div.log-line', { class: `log-line--${line.level || 'info'}` },
          h('span.log-line__time', fmtClockSafe(line.at)),
          h('span.log-line__level', line.level || 'info'),
          h('span.log-line__msg', line.message || ''),
        ));
      }
    }
    const counter = document.getElementById('ad-logs-count');
    if (counter) counter.textContent = t('ad.logs.total').replace('{n}', String(res.total ?? items.length));
  }

  function toggleAuto(next) {
    auto = next;
    if (timer) { clearInterval(timer); timer = null; }
    if (auto) timer = setInterval(load, 5000);
  }

  const levelChips = chipRow({
    items: [
      { value: '', label: t('ad.logs.all') },
      { value: 'error', label: 'error' },
      { value: 'warn', label: 'warn' },
      { value: 'info', label: 'info' },
      { value: 'debug', label: 'debug' },
    ],
    value: level,
    onChange: (v) => { level = v; load(); },
  });

  const limitSelect = selectInput({
    options: [100, 200, 500].map((n) => ({ value: n, label: String(n) })),
    value: limit,
    onChange: (v) => { limit = Number(v); load(); },
  });
  limitSelect.style.width = '92px';

  const autoSwitch = switchEl({
    checked: false,
    label: t('ad.logs.auto'),
    onChange: (v) => toggleAuto(v),
  });

  body.appendChild(h('div.card',
    h('div.card__head',
      h('div.card__title', icon('terminal', 'icon icon--14'), t('ad.tab.logs')),
      h('span.card__sub', { id: 'ad-logs-count' }, ''),
      h('span.spacer'),
      toolRow(
        levelChips,
        h('span.card__sub', t('ad.logs.limit')), limitSelect,
        h('span.row.row--sm', autoSwitch, h('span.card__sub', t('ad.logs.auto'))),
        textBtn('refresh', t('c.refresh'), () => load()),
      )),
    h('div.card__body.card__body--tight',
      h('div.logs', { id: 'ad-logs-list' })),
  ));

  await load();

  return function cleanup() {
    if (timer) { clearInterval(timer); timer = null; }
  };
}

function fmtClockSafe(sec) {
  const d = sec ? new Date(Number(sec) * 1000) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
