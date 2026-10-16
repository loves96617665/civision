/* =============================================================================
 * Civision Gateway WebUI — 核心模块
 * 路由 / i18n / 存储 / API 封装 / 通用组件（toast · modal · table · form）
 * 零外部依赖：原生 ES module，无构建步骤。
 * ========================================================================== */

/* ---------------------------------------------------------------------------
 * 0. 运行环境常量
 * ------------------------------------------------------------------------ */

/** 演示模式：URL 带 ?mock=1 时拦截 fetch（由 mock.js 安装） */
export const MOCK = new URLSearchParams(location.search).get('mock') === '1';

const LS = {
  lang: 'civision.lang',
  theme: 'civision.theme',
  apiKey: 'civision.apikey',
  adminToken: 'civision.admin.token',
  base: 'civision.base',
  studio: 'civision.studio.state',
  adminTab: 'civision.admin.tab',
};

export const APP_VERSION = '1.0.0';

/* ---------------------------------------------------------------------------
 * 1. i18n
 * ------------------------------------------------------------------------ */

const STRINGS = {
  /* 顶栏 / 页脚 */
  'brand.sub': ['创作工作台 · 管理台', 'Workbench · Console'],
  'nav.studio': ['创作', 'Studio'],
  'nav.admin': ['管理', 'Admin'],
  'header.theme': ['切换主题', 'Toggle theme'],
  'header.lang': ['中 / EN', '中 / EN'],
  'header.key': ['API KEY', 'API KEY'],
  'header.keySet': ['KEY 已配置', 'KEY set'],
  'header.keyMissing': ['未设置 KEY', 'No KEY'],
  'header.keyHint': ['点击设置网关 API KEY', 'Click to set gateway API KEY'],
  'footer.note': ['前端零依赖 · 由同一个 FastAPI 进程托管 · 静态资源无需鉴权',
    'Zero-dependency frontend · served by the same FastAPI process · static assets need no auth'],
  'doc.title': ['Civision Gateway', 'Civision Gateway'],

  /* 通用动作 */
  'c.save': ['保存', 'Save'],
  'c.cancel': ['取消', 'Cancel'],
  'c.close': ['关闭', 'Close'],
  'c.confirm': ['确定', 'Confirm'],
  'c.delete': ['删除', 'Delete'],
  'c.edit': ['编辑', 'Edit'],
  'c.enable': ['启用', 'Enable'],
  'c.disable': ['禁用', 'Disable'],
  'c.refresh': ['刷新', 'Refresh'],
  'c.loading': ['加载中…', 'Loading…'],
  'c.copy': ['复制', 'Copy'],
  'c.copied': ['已复制', 'Copied'],
  'c.copyFailed': ['复制失败，请手动选择', 'Copy failed, select manually'],
  'c.retry': ['重试', 'Retry'],
  'c.reset': ['重置', 'Reset'],
  'c.search': ['搜索', 'Search'],
  'c.all': ['全部', 'All'],
  'c.actions': ['操作', 'Actions'],
  'c.empty': ['暂无数据', 'No data'],
  'c.error': ['出错了', 'Something went wrong'],
  'c.saved': ['已保存', 'Saved'],
  'c.apply': ['应用', 'Apply'],
  'c.add': ['添加', 'Add'],
  'c.import': ['导入', 'Import'],
  'c.check': ['检查', 'Check'],
  'c.yes': ['是', 'Yes'],
  'c.no': ['否', 'No'],
  'c.none': ['无', 'None'],
  'c.never': ['从未', 'Never'],
  'c.optional': ['可选', 'optional'],
  'c.copyLink': ['复制链接', 'Copy link'],
  'c.download': ['下载', 'Download'],
  'c.zoom': ['放大', 'Zoom'],
  'c.regenerate': ['重新生成', 'Regenerate'],
  'c.seconds': ['秒', 's'],
  'c.count': ['数量', 'Count'],

  /* 横幅 */
  'banner.noKey.title': ['还没有配置网关 API KEY', 'Gateway API KEY not set'],
  'banner.noKey.desc': ['/v1/* 与 /studio/api/* 需要 Authorization: Bearer <KEY>。点右侧按钮填入。',
    '/v1/* and /studio/api/* require Authorization: Bearer <KEY>. Use the button on the right.'],
  'banner.noKey.action': ['设置 KEY', 'Set KEY'],
  'banner.noToken.title': ['还没有配置 Admin Token', 'Admin token not set'],
  'banner.noToken.desc': ['/admin/api/* 需要 X-Admin-Token。首次启动时后端会打印到控制台（server/data/admin.token）。',
    '/admin/api/* requires X-Admin-Token. The backend prints it on first boot (server/data/admin.token).'],
  'banner.noToken.action': ['去设置页填入', 'Fill in settings'],
  'banner.mock.title': ['演示模式（mock）', 'Demo mode (mock)'],
  'banner.mock.desc': ['已拦截 fetch，返回离线假数据；不会访问任何后端。去掉 ?mock=1 即恢复真实链路。',
    'fetch is intercepted and returns offline fixtures; no backend is contacted. Drop ?mock=1 to use the real API.'],
  'banner.err.title': ['请求失败', 'Request failed'],

  /* KEY 弹窗 */
  'key.modal.title': ['网关 API KEY', 'Gateway API KEY'],
  'key.modal.sub': ['存于本机 localStorage（civision.apikey），不会发送给第三方',
    'Stored in localStorage (civision.apikey), never sent anywhere else'],
  'key.modal.label': ['API KEY', 'API KEY'],
  'key.modal.placeholder': ['sk-civ-…', 'sk-civ-…'],
  'key.modal.hint': ['形如 sk-civ-<32hex>，在管理台「API KEY」页创建',
    'Shape: sk-civ-<32hex>; create it under Admin → API KEY'],
  'key.modal.clear': ['清除', 'Clear'],
  'key.modal.saved': ['API KEY 已保存', 'API KEY saved'],
  'key.modal.cleared': ['API KEY 已清除', 'API KEY cleared'],

  /* 模态 / toast */
  'modal.esc': ['按 Esc 关闭', 'Press Esc to close'],
  'toast.ok': ['完成', 'Done'],
  'toast.error': ['失败', 'Failed'],
};

/** 追加词条（供 studio.js / admin.js 注册自己的文案） */
export function addStrings(dict) {
  for (const key of Object.keys(dict)) {
    const v = dict[key];
    STRINGS[key] = Array.isArray(v) ? v : [v, v];
  }
}

let LANG = readLang();

function readLang() {
  try {
    const v = localStorage.getItem(LS.lang);
    return v === 'en' ? 'en' : 'zh';
  } catch { return 'zh'; }
}

export function getLang() { return LANG; }

/** 取词：key 缺失时返回 fallback 或 key 本身（便于自检发现漏翻） */
export function t(key, fallback) {
  const entry = STRINGS[key];
  if (!entry) return fallback !== undefined ? fallback : key;
  return entry[LANG === 'en' ? 1 : 0] ?? entry[0];
}

/** 非字符串型 i18n：按语言挑一个对象（如表格列定义） */
export function pick(zh, en) { return LANG === 'en' ? en : zh; }

/** 应用 data-i18n / data-i18n-title / data-i18n-placeholder */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'), el.textContent);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title'), el.getAttribute('title') || ''));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), el.getAttribute('placeholder') || ''));
  });
  document.documentElement.setAttribute('lang', LANG === 'en' ? 'en' : 'zh-CN');
}

export function setLang(next) {
  LANG = next === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(LS.lang, LANG); } catch { /* ignore */ }
  applyI18n(document);
  syncLangButton();
  document.title = t('doc.title');
  remount(); // 视图内动态文案需要重挂载
}

function syncLangButton() {
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.querySelector('.lang-toggle__text').textContent = LANG === 'en' ? 'EN' : '中';
}

/* ---------------------------------------------------------------------------
 * 2. 主题
 * ------------------------------------------------------------------------ */

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem(LS.theme, next); } catch { /* ignore */ }
  syncThemeButton();
  document.dispatchEvent(new CustomEvent('civision:theme', { detail: { theme: next } }));
}

function syncThemeButton() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const use = btn.querySelector('use');
  const isDark = getTheme() === 'dark';
  if (use) use.setAttribute('href', isDark ? '#i-moon' : '#i-sun');
  btn.setAttribute('title', t('header.theme'));
}

export function toggleTheme() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

/* ---------------------------------------------------------------------------
 * 3. 本地存储：鉴权与基址
 * ------------------------------------------------------------------------ */

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v) {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ }
}

export const store = {
  getApiKey: () => lsGet(LS.apiKey),
  setApiKey: (v) => { lsSet(LS.apiKey, v); syncKeyChip(); },
  getAdminToken: () => lsGet(LS.adminToken),
  setAdminToken: (v) => lsSet(LS.adminToken, v),
  getBase: () => lsGet(LS.base).replace(/\/+$/, ''),
  setBase: (v) => lsSet(LS.base, v.trim().replace(/\/+$/, '')),
  getJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  setJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  keys: LS,
};

function syncKeyChip() {
  const chip = document.getElementById('key-chip');
  if (!chip) return;
  const key = store.getApiKey();
  const text = chip.querySelector('.key-chip__text');
  chip.classList.toggle('is-ok', !!key);
  chip.classList.toggle('is-missing', !key);
  if (text) {
    text.textContent = key
      ? `${key.slice(0, 10)}…${key.slice(-4)}`
      : t('header.keyMissing');
  }
  chip.setAttribute('title', key ? t('header.keySet') : t('header.keyHint'));
}

/* ---------------------------------------------------------------------------
 * 4. DOM 工具
 * ------------------------------------------------------------------------ */

/**
 * 极简 hyperscript。
 *   h('div.card', { class: 'x', on: { click: fn }, props: { value: 1 }, dataset: {} }, child)
 * tag 支持 'tag.classA.classB' 简写。
 */
export function h(tag, attrs, ...children) {
  const parts = String(tag).split('.');
  const el = document.createElement(parts[0] || 'div');
  if (parts.length > 1) el.className = parts.slice(1).join(' ');

  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.className = (el.className ? el.className + ' ' : '') + v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || sv === undefined) continue;
          if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
          else el.style[sk] = sv;
        }
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) if (dv !== null && dv !== undefined) el.dataset[dk] = String(dv);
      } else if (k === 'props') {
        for (const [pk, pv] of Object.entries(v)) el[pk] = pv;
      } else if (k === 'on') {
        for (const [ek, ev] of Object.entries(v)) if (typeof ev === 'function') el.addEventListener(ek, ev);
      } else if (k === 'text') {
        el.textContent = String(v);
      } else if (k === 'html') {
        el.innerHTML = v; // 仅用于可信静态模板
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  } else if (attrs !== undefined && attrs !== null) {
    children.unshift(attrs);
  }

  append(el, children);
  return el;
}

function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function icon(name, cls = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 24 24');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 格式化 */
export function fmtTime(unixSec) {
  if (!unixSec) return t('c.never');
  const d = new Date(Number(unixSec) * 1000);
  if (Number.isNaN(d.getTime())) return t('c.never');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtClock(unixSec) {
  const d = unixSec ? new Date(Number(unixSec) * 1000) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtRelative(unixSec) {
  if (!unixSec) return t('c.never');
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - Number(unixSec)));
  if (diff < 60) return pick(`${diff} 秒前`, `${diff}s ago`);
  if (diff < 3600) return pick(`${Math.floor(diff / 60)} 分钟前`, `${Math.floor(diff / 60)}m ago`);
  if (diff < 86400) return pick(`${Math.floor(diff / 3600)} 小时前`, `${Math.floor(diff / 3600)}h ago`);
  return pick(`${Math.floor(diff / 86400)} 天前`, `${Math.floor(diff / 86400)}d ago`);
}

export function fmtNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return String(v);
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d) return `${d}d ${hh}h ${mm}m`;
  if (hh) return `${hh}h ${mm}m`;
  if (mm) return `${mm}m ${ss}s`;
  return `${ss}s`;
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    throw new Error('clipboard unavailable');
  } catch {
    try {
      const ta = h('textarea', { props: { value }, style: { position: 'fixed', opacity: '0', top: '-1000px' } });
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/* ---------------------------------------------------------------------------
 * 5. API 层
 * ------------------------------------------------------------------------ */

export class ApiError extends Error {
  constructor(message, meta = {}) {
    super(message || t('c.error'));
    this.name = 'ApiError';
    this.type = meta.type || 'unknown_error';
    this.code = meta.code || '';
    this.status = meta.status || 0;
    this.upstreamStatus = meta.upstream_status || 0;
    this.requestId = meta.request_id || '';
    this.payload = meta.payload;
  }
  /** 面向 toast / 错误态的一行摘要 */
  describe() {
    const bits = [];
    if (this.status) bits.push(`HTTP ${this.status}`);
    if (this.type && this.type !== 'unknown_error') bits.push(this.type);
    if (this.code) bits.push(this.code);
    return bits.length ? `${this.message} (${bits.join(' · ')})` : this.message;
  }
}

function buildUrl(path, query) {
  const base = store.getBase();
  let url = /^https?:\/\//.test(path) ? path : `${base}${path}`;
  if (query && Object.keys(query).length) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === '') continue;
      qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

/**
 * @param {'none'|'bearer'|'admin'} auth
 */
async function request(path, { method = 'GET', body, query, auth = 'none', signal, raw = false, headers = {} } = {}) {
  const hdrs = { Accept: 'application/json', ...headers };
  if (body !== undefined) hdrs['Content-Type'] = 'application/json';

  if (auth === 'bearer') {
    const key = store.getApiKey();
    // mock 模式下允许无 KEY 自检；真实链路必须显式报错，避免静默匿名请求
    if (!key && !MOCK) throw new ApiError(t('banner.noKey.title'), { type: 'missing_api_key', code: 'NoApiKey', status: 0 });
    if (key) hdrs.Authorization = `Bearer ${key}`;
  } else if (auth === 'admin') {
    const token = store.getAdminToken();
    if (!token && !MOCK) throw new ApiError(t('banner.noToken.title'), { type: 'missing_admin_token', code: 'NoAdminToken', status: 0 });
    if (token) hdrs['X-Admin-Token'] = token;
  }

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers: hdrs,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError(
      pick('网络不可达：无法连接网关', 'Network error: gateway unreachable'),
      { type: 'network_error', code: 'NetworkError' },
    );
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let json = null;
  if (text) { try { json = JSON.parse(text); } catch { json = null; } }

  if (!res.ok) {
    const e = (json && json.error) || {};
    throw new ApiError(
      e.message || (json && (json.detail || json.message)) || res.statusText || t('c.error'),
      {
        type: e.type || (res.status === 401 ? 'invalid_api_key' : 'http_error'),
        code: e.code || '',
        status: res.status,
        upstream_status: e.upstream_status,
        request_id: e.request_id,
        payload: json,
      },
    );
  }

  if (raw) return { status: res.status, headers: res.headers, body: json, text };
  if (json === null && text) {
    throw new ApiError(pick('响应不是合法 JSON', 'Response is not valid JSON'),
      { type: 'invalid_response', status: res.status });
  }
  return json;
}

export const api = {
  /** OpenAI 兼容面 /v1/* */
  v1: (path, opts) => request(path, { ...opts, auth: 'bearer' }),
  /** Studio 面 /studio/api/* */
  studio: (path, opts) => request(path, { ...opts, auth: 'bearer' }),
  /** Admin 面 /admin/api/* */
  admin: (path, opts) => request(path, { ...opts, auth: 'admin' }),
  /** 无鉴权（健康探针 / 静态资源） */
  open: (path, opts) => request(path, { ...opts, auth: 'none' }),
  request,
};

/* ---------------------------------------------------------------------------
 * 6. Toast
 * ------------------------------------------------------------------------ */

let toastSeq = 0;

export function toast(title, { desc = '', type = 'info', timeout } = {}) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return { close() {} };

  const id = ++toastSeq;
  const iconName = type === 'ok' ? 'check-circle' : type === 'error' ? 'alert' : 'info';
  const node = h('div.toast', { class: `toast--${type}`, dataset: { id } },
    icon(iconName, 'icon icon--16 toast__icon'),
    h('div.toast__body',
      h('div.toast__title', title),
      desc ? h('div.toast__desc', desc) : null),
    h('button.toast__close', {
      type: 'button', 'aria-label': t('c.close'),
      on: { click: () => close() },
    }, icon('x', 'icon icon--14')),
  );

  const ttl = timeout ?? (type === 'error' ? 7000 : 3600);
  let timer = null;

  function close() {
    if (timer) clearTimeout(timer);
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), 160);
  }

  stack.appendChild(node);
  if (ttl > 0) timer = setTimeout(close, ttl);
  return { close, node };
}

export function toastError(err, title) {
  const msg = err instanceof ApiError ? err.describe() : String(err && err.message ? err.message : err);
  return toast(title || t('toast.error'), { desc: msg, type: 'error' });
}

/* ---------------------------------------------------------------------------
 * 7. Modal
 * ------------------------------------------------------------------------ */

let modalSeq = 0;

/**
 * @param {object} opt
 * @param {string} opt.title
 * @param {string} [opt.sub]
 * @param {Node|Node[]} [opt.body]
 * @param {Array<{label, variant?, onClick?, closeAfter?, autofocus?}>} [opt.actions]
 * @param {'sm'|'md'|'wide'} [opt.width]
 * @param {boolean} [opt.dismissible=true]
 * @param {(h:{close, root, body, setBusy})=>void} [opt.onOpen]
 */
export function openModal(opt = {}) {
  const {
    title = '', sub = '', body = null, actions = [], width = 'md',
    dismissible = true, onOpen, footerExtra = null,
  } = opt;

  const root = document.getElementById('modal-root');
  const id = `modal-${++modalSeq}`;
  const prevFocus = document.activeElement;

  const bodyEl = h('div.modal__body', body || []);
  const footEl = h('div.modal__foot');
  const titleId = `${id}-title`;

  const modal = h('div.modal', {
    class: width === 'wide' ? 'modal--wide' : width === 'sm' ? 'modal--sm' : '',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
  },
    h('div.modal__head',
      h('div.stack.stack--xs.truncate',
        h('h2.modal__title', { id: titleId }, title),
        sub ? h('div.modal__sub', sub) : null),
      h('button.icon-btn.modal__close', {
        type: 'button', 'aria-label': t('c.close'), title: t('c.close'),
        on: { click: () => close() },
      }, icon('x')),
    ),
    bodyEl,
    (actions.length || footerExtra)
      ? footEl
      : null,
  );

  const backdrop = h('div.modal-backdrop', { dataset: { modal: id } }, modal);

  const handle = {
    root: modal,
    body: bodyEl,
    close,
    setBusy(busy) {
      modal.querySelectorAll('button, input, select, textarea').forEach((el) => {
        if (el.dataset.keepEnabled !== undefined) return;
        el.disabled = !!busy;
      });
    },
  };

  for (const act of actions) {
    if (!act) continue;
    const btn = h('button.btn', {
      type: 'button',
      class: act.variant === 'primary' ? 'btn--primary' : act.variant === 'danger' ? 'btn--danger' : '',
      on: {
        click: async (ev) => {
          if (typeof act.onClick !== 'function') { close(); return; }
          const result = act.onClick(ev, handle);
          if (result && typeof result.then === 'function') {
            handle.setBusy(true);
            try { await result; } catch { /* 由调用方 toast */ }
            handle.setBusy(false);
          }
          if (act.closeAfter !== false) close();
        },
      },
    }, act.label);
    if (act.autofocus) setTimeout(() => btn.focus(), 0);
    footEl.appendChild(btn);
  }
  if (footerExtra) footEl.appendChild(footerExtra);

  function onKeydown(ev) {
    if (ev.key === 'Escape' && dismissible) { ev.stopPropagation(); close(); return; }
    if (ev.key !== 'Tab') return;
    const focusables = modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  function onBackdropClick(ev) {
    if (dismissible && ev.target === backdrop) close();
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
  }

  document.addEventListener('keydown', onKeydown, true);
  backdrop.addEventListener('mousedown', onBackdropClick);
  root.appendChild(backdrop);

  const autofocusEl = modal.querySelector('input:not([type=hidden]), textarea, select');
  if (autofocusEl) autofocusEl.focus();
  else modal.querySelector('button')?.focus();

  if (typeof onOpen === 'function') onOpen(handle);
  return handle;
}

/** 确认框 → Promise<boolean> */
export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { if (!decided) { decided = true; resolve(v); } };
    const handle = openModal({
      title,
      width: 'sm',
      body: h('div', { style: { fontSize: '13px', color: 'var(--ms-color-text-secondary)', lineHeight: '1.6' } }, message),
      actions: [
        { label: cancelLabel || t('c.cancel'), onClick: () => done(false) },
        { label: confirmLabel || t('c.confirm'), variant: danger ? 'danger' : 'primary', onClick: () => done(true) },
      ],
    });
    handle.root.addEventListener('civision:closed', () => done(false));
    // 关闭（Esc / 遮罩 / 关闭按钮）视作取消
    const observer = new MutationObserver(() => {
      if (!document.body.contains(handle.root) && !decided) { done(false); observer.disconnect(); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/**
 * 输入框弹窗 → Promise<string|null>
 */
export function inputDialog({
  title, sub, label, placeholder = '', value = '', hint = '',
  multiline = false, confirmLabel, validate,
}) {
  return new Promise((resolve) => {
    let decided = false;
    const done = (v) => { if (!decided) { decided = true; resolve(v); } };
    const control = multiline
      ? h('textarea.textarea.input--mono', { props: { value }, placeholder, rows: 6 })
      : h('input.input.input--mono', { props: { value }, placeholder, type: 'text' });
    const errEl = h('div.field__error', { style: { display: 'none' } });

    const handle = openModal({
      title, sub, width: 'md',
      body: h('div.field',
        label ? h('label.field__label', label) : null,
        control,
        hint ? h('div.field__hint', hint) : null,
        errEl),
      footerExtra: errEl,
      actions: [
        { label: t('c.cancel'), onClick: () => done(null) },
        {
          label: confirmLabel || t('c.confirm'),
          variant: 'primary',
          closeAfter: false,
          onClick: () => {
            const v = control.value.trim();
            if (typeof validate === 'function') {
              const msg = validate(v);
              if (msg) {
                errEl.textContent = msg;
                errEl.style.display = '';
                control.focus();
                return false;
              }
            }
            done(v);
            handle.close();
          },
        },
      ],
    });
    setTimeout(() => control.focus(), 0);
    const observer = new MutationObserver(() => {
      if (!document.body.contains(handle.root) && !decided) { done(null); observer.disconnect(); }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

/** 灯箱 */
export function lightbox(src, caption = '') {
  const prevFocus = document.activeElement;
  const overlay = h('div.lightbox', { role: 'dialog', 'aria-modal': 'true' },
    h('img.lightbox__img', { src, alt: caption || 'preview' }),
    h('button.icon-btn.lightbox__close', {
      type: 'button', 'aria-label': t('c.close'),
      on: { click: () => close() },
    }, icon('x')),
    caption ? h('div.lightbox__bar', caption) : null,
  );
  function onKey(ev) { if (ev.key === 'Escape') close(); }
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('.lightbox__close').focus();
}

/* ---------------------------------------------------------------------------
 * 8. 表格 / 骨架 / 空状态
 * ------------------------------------------------------------------------ */

/**
 * @param {object} opt
 * @param {Array<{key,label,width?,className?,render?:(row,i)=>Node|string}>} opt.columns
 * @param {Array<object>} opt.rows
 * @param {boolean} [opt.loading]
 * @param {number} [opt.skeletonRows]
 * @param {{title,desc,icon?,action?}} [opt.empty]
 */
export function dataTable({ columns, rows = [], loading = false, skeletonRows = 4, empty = null }) {
  const wrap = h('div.table-wrap');

  if (loading && !rows.length) {
    const table = h('table.data');
    table.appendChild(h('thead', h('tr', ...columns.map((c) => h('th', {
      class: c.className || '', scope: 'col',
    }, c.label)))));
    const tbody = h('tbody');
    for (let i = 0; i < skeletonRows; i++) {
      tbody.appendChild(h('tr', ...columns.map((c) => h('td', { class: c.className || '' },
        h('div.skeleton.skeleton--line', {
          style: { width: `${40 + ((i * 17 + String(c.key || '').length * 7) % 50)}%` },
        })))));
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  if (!rows.length) {
    const e = empty || {};
    wrap.appendChild(h('div.empty',
      h('div.empty__icon', icon(e.icon || 'grid')),
      h('div.empty__title', e.title || t('c.empty')),
      e.desc ? h('div.empty__desc', e.desc) : null,
      e.action ? h('div.empty__actions', e.action) : null,
    ));
    return wrap;
  }

  const table = h('table.data');
  table.appendChild(h('thead', h('tr', ...columns.map((c) => h('th', {
    class: c.className || '',
    style: c.width ? { width: c.width } : null,
    scope: 'col',
  }, c.label)))));

  const tbody = h('tbody');
  rows.forEach((row, i) => {
    const tr = h('tr');
    columns.forEach((c) => {
      const cell = h('td', { class: c.className || '' });
      const val = c.render ? c.render(row, i) : row[c.key];
      if (val instanceof Node) cell.appendChild(val);
      else if (Array.isArray(val)) val.forEach((v) => cell.appendChild(v instanceof Node ? v : document.createTextNode(String(v))));
      else if (val !== null && val !== undefined) cell.textContent = String(val);
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

export function skeletonGrid(count = 6, cls = 'skeleton--card') {
  return h('div.skeleton-grid', ...Array.from({ length: count }, () => h(`div.skeleton.${cls}`)));
}

export function skeletonLines(count = 4) {
  return h('div.stack.stack--sm', ...Array.from({ length: count }, () => h('div.skeleton.skeleton--line')));
}

export function emptyState({ title, desc, iconName = 'grid', action = null }) {
  return h('div.empty',
    h('div.empty__icon', icon(iconName)),
    h('div.empty__title', title || t('c.empty')),
    desc ? h('div.empty__desc', desc) : null,
    action ? h('div.empty__actions', action) : null,
  );
}

export function spinner(cls = 'icon icon--16 spin') { return icon('loader', cls); }

/** 按钮异步包装：自动 disabled + 转圈，避免重复提交 */
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return undefined;
  const prev = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  clear(btn);
  btn.appendChild(spinner('icon icon--16 spin'));
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.innerHTML = prev;
  }
}

/* ---------------------------------------------------------------------------
 * 9. 表单控件
 * ------------------------------------------------------------------------ */

export function textInput({ value = '', placeholder = '', type = 'text', mono = false, onInput, onChange, disabled = false, name } = {}) {
  return h(`input.input${mono ? '.input--mono' : ''}`, {
    type, placeholder, name,
    props: { value, disabled },
    on: {
      input: onInput ? (e) => onInput(e.target.value, e) : null,
      change: onChange ? (e) => onChange(e.target.value, e) : null,
    },
  });
}

export function numberInput({ value = 0, min, max, step = 1, onChange, disabled = false, width = '100%' } = {}) {
  return h('input.input.input--mono', {
    type: 'number', style: { width },
    props: { value, min, max, step, disabled },
    on: {
      change: (e) => {
        let v = Number(e.target.value);
        if (Number.isNaN(v)) v = Number(value) || 0;
        if (min !== undefined && v < min) v = Number(min);
        if (max !== undefined && v > max) v = Number(max);
        e.target.value = String(v);
        if (onChange) onChange(v, e);
      },
    },
  });
}

export function selectInput({ options = [], value, onChange, disabled = false } = {}) {
  const sel = h('select.select', {
    props: { disabled },
    on: { change: (e) => onChange && onChange(e.target.value, e) },
  });
  for (const o of options) {
    sel.appendChild(h('option', {
      value: String(o.value),
      props: { selected: String(o.value) === String(value) },
    }, o.label));
  }
  return sel;
}

export function switchEl({ checked = false, onChange, disabled = false, label = '' } = {}) {
  const btn = h('button.switch', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label || undefined,
    props: { disabled },
    on: {
      click: () => {
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', next ? 'true' : 'false');
        if (onChange) onChange(next);
      },
    },
  });
  return btn;
}

export function checkbox({ checked = false, onChange, label = '', disabled = false } = {}) {
  const input = h('input', {
    type: 'checkbox',
    props: { checked, disabled },
    on: { change: (e) => onChange && onChange(e.target.checked, e) },
  });
  return h('label.checkbox', input, label ? h('span', label) : null);
}

export function field(label, control, { hint = '', error = '', id } = {}) {
  const controlId = id || `f-${Math.random().toString(36).slice(2, 8)}`;
  if (control && control.tagName) control.id = control.id || controlId;
  return h('div.field',
    label ? h('label.field__label', { for: controlId }, label) : null,
    control,
    hint ? h('div.field__hint', hint) : null,
    error ? h('div.field__error', error) : null,
  );
}

export function segmented({ items, value, onChange, size = 'md' }) {
  const wrap = h('div.segmented', { class: size === 'lg' ? 'segmented--lg' : '', role: 'tablist' });
  for (const item of items) {
    const btn = h('button.segmented__item', {
      type: 'button', role: 'tab',
      'aria-selected': String(item.value) === String(value) ? 'true' : 'false',
      class: String(item.value) === String(value) ? 'is-active' : '',
      on: {
        click: () => {
          if (String(item.value) === String(value)) return;
          wrap.querySelectorAll('.segmented__item').forEach((b) => {
            b.classList.remove('is-active');
            b.setAttribute('aria-selected', 'false');
          });
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
          onChange(item.value);
        },
      },
    }, item.icon ? icon(item.icon, 'icon icon--16') : null, item.label);
    wrap.appendChild(btn);
  }
  return wrap;
}

export function chipRow({ items, value, onChange, multi = false, className = '' }) {
  const wrap = h('div.chips', { class: className });
  for (const item of items) {
    const active = multi
      ? (Array.isArray(value) ? value.includes(item.value) : false)
      : String(item.value) === String(value);
    const btn = h('button.chip', {
      type: 'button',
      'aria-pressed': active ? 'true' : 'false',
      class: item.ghost ? 'chip--ghost' : '',
      title: item.title || undefined,
      on: {
        click: () => {
          if (multi) {
            const cur = Array.isArray(value) ? value.slice() : [];
            const idx = cur.indexOf(item.value);
            if (idx >= 0) cur.splice(idx, 1); else cur.push(item.value);
            onChange(cur);
          } else {
            wrap.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', 'false'));
            btn.setAttribute('aria-pressed', 'true');
            onChange(item.value);
          }
        },
      },
    }, item.icon ? icon(item.icon, 'icon icon--14') : null, item.label);
    wrap.appendChild(btn);
  }
  return wrap;
}

/** 可折叠面板（border-radius 14px，参数折叠区使用） */
export function collapsible({ title, subtitle = '', open = false, extra = null, onToggle }) {
  const body = h('div.panel__body');
  const head = h('button.panel__head', {
    type: 'button',
    'aria-expanded': open ? 'true' : 'false',
    on: {
      click: () => {
        const next = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', next ? 'true' : 'false');
        body.style.display = next ? '' : 'none';
        if (onToggle) onToggle(next);
      },
    },
  },
    icon('chevron-right', 'icon icon--16 panel__caret'),
    h('span', title),
    subtitle ? h('span.card__sub', subtitle) : null,
    h('span.spacer'),
    extra,
  );
  body.style.display = open ? '' : 'none';
  const panel = h('div.panel', head, body);
  return { panel, body, head };
}

export function tag(text, variant = '') {
  return h('span.tag', { class: variant ? `tag--${variant}` : '' }, text);
}

export function dot(kind = 'idle', pulse = false) {
  return h('span.dot', { class: `dot--${kind}${pulse ? ' dot--pulse' : ''}` });
}

export function keyValueRows(pairs) {
  return h('div.kv', ...pairs.flatMap(([k, v]) => [
    h('div.muted', k),
    v instanceof Node ? v : h('div', v),
  ]));
}

/* ---------------------------------------------------------------------------
 * 10. 横幅
 * ------------------------------------------------------------------------ */

let currentBanner = null;

export function setBanner(cfg) {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  clear(slot);
  currentBanner = cfg || null;
  if (!cfg) return;
  const kind = cfg.kind || 'warn';
  const el = h('div.banner', { class: `banner--${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : kind === 'warn' ? 'info' : 'info', 'icon icon--20 banner__icon'),
    h('div.banner__body',
      h('div.banner__title', cfg.title),
      cfg.desc ? h('div.banner__desc', cfg.desc) : null),
    cfg.actions && cfg.actions.length
      ? h('div.banner__actions', ...cfg.actions.map((a) => h('button.btn.btn--sm', {
        type: 'button',
        class: a.variant === 'primary' ? 'btn--primary' : '',
        on: { click: a.onClick },
      }, a.label)))
      : null,
  );
  slot.appendChild(el);
}

export function refreshBanner() {
  const banner = currentBanner && currentBanner.id;
  if (banner === 'noKey') ensureGlobalBanner('studio');
  else if (banner === 'noToken') ensureGlobalBanner('admin');
  else if (banner === 'mock') ensureGlobalBanner(location.hash.includes('admin') ? 'admin' : 'studio');
}

/** 根据上下文展示「缺 KEY / 缺 Token / mock」提示（优先级：mock > 缺 token > 缺 key） */
export function ensureGlobalBanner(scope) {
  if (MOCK) {
    setBanner({ id: 'mock', kind: 'info', title: t('banner.mock.title'), desc: t('banner.mock.desc') });
    return;
  }
  if (scope === 'admin' && !store.getAdminToken()) {
    setBanner({
      id: 'noToken', kind: 'warn',
      title: t('banner.noToken.title'), desc: t('banner.noToken.desc'),
      actions: [{ label: t('banner.noToken.action'), onClick: () => { location.hash = '#/admin/settings'; } }],
    });
    return;
  }
  if (!store.getApiKey()) {
    setBanner({
      id: 'noKey', kind: 'warn',
      title: t('banner.noKey.title'),
      desc: t('banner.noKey.desc'),
      actions: [{
        label: t('banner.noKey.action'), variant: 'primary',
        onClick: () => openKeyDialog(),
      }],
    });
    return;
  }
  setBanner(null);
}

/* ---------------------------------------------------------------------------
 * 11. KEY 弹窗
 * ------------------------------------------------------------------------ */

export function openKeyDialog(onSaved) {
  const input = textInput({
    value: store.getApiKey(),
    placeholder: t('key.modal.placeholder'),
    mono: true,
  });
  openModal({
    title: t('key.modal.title'),
    sub: t('key.modal.sub'),
    width: 'sm',
    body: field(t('key.modal.label'), input, { hint: t('key.modal.hint') }),
    actions: [
      {
        label: t('key.modal.clear'),
        onClick: () => { store.setApiKey(''); toast(t('key.modal.cleared'), { type: 'info' }); if (onSaved) onSaved(''); },
      },
      {
        label: t('c.save'),
        variant: 'primary',
        onClick: () => {
          store.setApiKey(input.value.trim());
          ensureGlobalBanner(location.hash.includes('admin') ? 'admin' : 'studio');
          toast(t('key.modal.saved'), { type: 'ok' });
          if (onSaved) onSaved(input.value.trim());
        },
      },
    ],
  });
}

/* ---------------------------------------------------------------------------
 * 12. 视图注册与路由
 * ------------------------------------------------------------------------ */

const ROUTES = {
  studio: { loader: () => import('./studio.js'), title: ['Civision Studio', 'Civision Studio'] },
  admin: { loader: () => import('./admin.js'), title: ['Civision Admin', 'Civision Admin'] },
};

const DEFAULT_ROUTE = 'studio';

let currentRoute = null;
let currentCleanup = null;
let mountToken = 0;
const routeListeners = new Set();

export function onRouteChange(fn) { routeListeners.add(fn); return () => routeListeners.delete(fn); }

export function currentRouteName() { return currentRoute; }

export function parseHash() {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/').filter(Boolean);
  const known = Object.prototype.hasOwnProperty.call(ROUTES, name);
  return { name: known ? name : DEFAULT_ROUTE, sub: rest.join('/'), valid: known || !name };
}

export function navigate(path) {
  const next = path.startsWith('#') ? path : `#/${path.replace(/^\/+/, '')}`;
  if (location.hash === next) { route(); return; }
  location.hash = next;
}

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.nav === name);
  });
}

async function route() {
  const { name, sub } = parseHash();
  const view = document.getElementById('view');
  if (!view) return;

  if (!location.hash) {
    history.replaceState(null, '', `#/${DEFAULT_ROUTE}`);
  }

  setActiveNav(name);
  const changed = currentRoute !== name;
  const myToken = ++mountToken;

  if (changed) {
    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch (err) { console.warn('[civision] cleanup failed', err); }
    }
    currentCleanup = null;
    currentRoute = name;
    clear(view);
    view.appendChild(h('div.view',
      h('div.card', h('div.card__body', skeletonLines(3))),
    ));
  }

  let mod;
  try {
    mod = await ROUTES[name].loader();
  } catch (err) {
    console.error('[civision] view load failed', err);
    clear(view);
    view.appendChild(emptyState({
      title: t('c.error'),
      desc: String(err && err.message ? err.message : err),
      iconName: 'alert',
    }));
    return;
  }
  if (myToken !== mountToken) return; // 已被更新的导航取代

  // 同一视图重入（子路径切换）时先清理
  if (!changed && typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
    clear(view);
  } else if (!changed) {
    clear(view);
  }

  document.title = `${t(ROUTES[name].title[0])} · Civision Gateway`;

  try {
    const cleanup = await mod.mount(view, { sub, route: name });
    if (myToken !== mountToken) { if (typeof cleanup === 'function') cleanup(); return; }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    console.error('[civision] mount failed', err);
    clear(view);
    view.appendChild(h('div.view', emptyState({
      title: t('c.error'),
      desc: String(err && err.stack ? err.stack.split('\n')[0] : err),
      iconName: 'alert',
    })));
  }

  for (const fn of routeListeners) {
    try { fn(name, sub); } catch { /* ignore */ }
  }
}

/** 语言切换等场景：重挂载当前视图（视图需自行恢复状态） */
export function remount() { route(); }

export function startRouter() {
  window.addEventListener('hashchange', route);
  route();
}

/* ---------------------------------------------------------------------------
 * 13. 启动
 * ------------------------------------------------------------------------ */

async function boot() {
  applyI18n(document);
  document.title = t('doc.title');
  syncThemeButton();
  syncLangButton();
  syncKeyChip();

  document.getElementById('theme-toggle')?.addEventListener('click', () => toggleTheme());
  document.getElementById('lang-toggle')?.addEventListener('click', () => setLang(LANG === 'en' ? 'zh' : 'en'));
  document.getElementById('key-chip')?.addEventListener('click', () => openKeyDialog(() => remount()));

  if (MOCK) {
    const mod = await import('./mock.js');
    mod.installMock();
    document.getElementById('build-tag').textContent = `webui ${APP_VERSION} · mock`;
  } else {
    document.getElementById('build-tag').textContent = `webui ${APP_VERSION}`;
  }

  startRouter();
  ensureGlobalBanner(parseHash().name);
  onRouteChange((name) => ensureGlobalBanner(name));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

/* 全局兜底：未捕获的 Promise 异常也要让用户看见（而不是静默） */
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason;
  if (reason instanceof ApiError) toastError(reason);
  else console.error('[civision] unhandled rejection', reason);
});
