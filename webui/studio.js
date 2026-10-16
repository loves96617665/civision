/* =============================================================================
 * Civision Gateway WebUI — 创作工作台（Studio）
 * 参数集与源站 modelscope.ai/civision 对齐：比例取自模型的 sizes，
 * 数值默认值取自模型的 default_params.basicDiffusionArgs。
 * ========================================================================== */

import {
  api, ApiError, MOCK, addStrings, t, pick, h, frag, clear, icon, toast, toastError,
  lightbox, skeletonGrid, emptyState, busy, store, copyText, chipRow, segmented,
  collapsible, numberInput, selectInput, textInput, field, fmtRelative, fmtDuration, tag,
} from './app.js';

/* ---------------------------------------------------------------------------
 * 文案
 * ------------------------------------------------------------------------ */
addStrings({
  'st.title': ['创作工作台', 'Studio'],
  'st.sub': ['图片 / 视频 / 音乐生成，参数与源站 civision 一致', 'Image / video / music generation, parameters mirror civision'],
  'st.mode': ['模式', 'Mode'],
  'st.mode.custom': ['自定义', 'Custom'],
  'st.mode.agent': ['智能体', 'Agent'],
  'st.mode.agentHint': ['智能体模式走上游会话 / SSE 链路：POST /studio/api/agent/generate（网关侧创建会话并消费 text/event-stream）',
    'Agent mode uses the upstream conversation/SSE path: POST /studio/api/agent/generate (the gateway creates a conversation and consumes text/event-stream)'],
  'st.type': ['类型', 'Type'],
  'st.kind.image': ['图片', 'Image'],
  'st.kind.video': ['视频', 'Video'],
  'st.kind.audio': ['音乐', 'Music'],
  'st.model': ['模型', 'Model'],
  'st.model.search': ['搜索模型…', 'Search models…'],
  'st.model.none': ['没有匹配的模型', 'No matching model'],
  'st.model.disabled': ['已关闭', 'Disabled'],
  'st.model.checkpoint': ['Checkpoint', 'Checkpoint'],
  'st.model.lora': ['LoRA', 'LoRA'],
  'st.model.platform': ['Platform Call', 'Platform Call'],
  'st.model.free': ['Free', 'Free'],
  'st.model.version': ['version_id', 'version_id'],
  'st.ratio': ['比例', 'Aspect'],
  'st.prompt': ['提示词', 'Prompt'],
  'st.prompt.placeholder': [
    '描述你想要的画面、镜头运动或音乐氛围… 例如：一只橘猫坐在月球表面，背后地球升起，35mm 摄影级细节',
    'Describe the image, camera move or music mood… e.g. an orange cat on the lunar surface, Earth rising behind, 35mm detail'],
  'st.prompt.inspire': ['灵感词', 'Inspiration'],
  'st.prompt.append': ['追加到提示词', 'Append to prompt'],
  'st.params': ['参数', 'Parameters'],
  'st.params.summary': ['参数摘要', 'Summary'],
  'st.params.restore': ['恢复默认', 'Restore defaults'],
  'st.params.hint': ['默认值取自该模型的 default_params', 'Defaults come from the model default_params'],
  'st.params.image': ['图片参数', 'Image parameters'],
  'st.params.video': ['视频参数', 'Video parameters'],
  'st.params.audio': ['音乐参数', 'Music parameters'],
  'st.p.quantity': ['数量 quantity', 'Quantity'],
  'st.p.steps': ['步数 steps', 'Steps'],
  'st.p.guidance': ['引导强度 guidance_scale', 'Guidance scale'],
  'st.p.sampler': ['采样器 sampler', 'Sampler'],
  'st.p.seed': ['随机种子 seed', 'Seed'],
  'st.p.seed.hint': ['-1 表示随机', '-1 means random'],
  'st.p.negative': ['负面提示词 negative_prompt', 'Negative prompt'],
  'st.p.strength': ['重绘幅度 strength', 'Strength'],
  'st.p.strength.hint': ['仅图生图（带参考图）时生效', 'Only applies to image-to-image (with a reference)'],
  'st.p.seconds': ['时长 total_seconds', 'Duration'],
  'st.p.size': ['尺寸 width × height', 'Size'],
  'st.p.duration': ['时长 duration', 'Duration'],
  'st.p.bpm': ['BPM', 'BPM'],
  'st.p.sampleRate': ['采样率 sample_rate', 'Sample rate'],
  'st.p.keyScale': ['调性 key_scale', 'Key'],
  'st.p.timeSignature': ['拍号 time_signature', 'Time signature'],
  'st.p.vocalLanguage': ['人声语言 vocal_language', 'Vocal language'],
  'st.p.lyrics': ['歌词 lyrics', 'Lyrics'],
  'st.p.lyrics.placeholder': ['可留空由模型自由发挥', 'Leave empty to let the model improvise'],
  'st.p.lyrics.hint': ['上限 4000 字符（上游 limits.lyricsMaxLength）', 'Max 4000 characters (upstream limits.lyricsMaxLength)'],
  'st.ref': ['参考图', 'Reference'],
  'st.ref.drop': ['拖拽图片到这里，或点击选择', 'Drop an image here, or click to choose'],
  'st.ref.hint': ['支持 png / jpg / webp，单张 ≤ 10MB；图生图 / 图生视频会带上传', 'png / jpg / webp, up to 10MB; used for image-to-image and image-to-video'],
  'st.ref.urlLabel': ['或粘贴图片 URL', 'Or paste an image URL'],
  'st.ref.urlPlaceholder': ['https://…/ref.png', 'https://…/ref.png'],
  'st.ref.attached': ['已附参考图', 'Reference attached'],
  'st.ref.remove': ['移除参考图', 'Remove reference'],
  'st.ref.tooBig': ['图片超过 10MB，请压缩后再试', 'Image exceeds 10MB, please compress it'],
  'st.ref.notImage': ['只接受图片文件', 'Image files only'],
  'st.ref.uploading': ['上传中…', 'Uploading…'],
  'st.ref.uploaded': ['已上传到上游', 'Uploaded upstream'],
  'st.ref.localOnly': ['仅本地落盘', 'Local only'],
  'st.ref.localOnly.desc': ['号池无可用账号，参考图只存在本机；上游生成需要可被上游访问的 URL', 'No account available, so the reference stays local; upstream generation needs a reachable URL'],
  'st.ref.uploadFailed': ['参考图上传失败', 'Reference upload failed'],
  'st.gen': ['生成', 'Generate'],
  'st.gen.running': ['生成中…', 'Generating…'],
  'st.gen.queued': ['排队中…', 'Queued…'],
  'st.gen.processing': ['生成中', 'Processing'],
  'st.gen.done': ['已进入画廊', 'Added to gallery'],
  'st.gen.failed': ['生成失败', 'Generation failed'],
  'st.gen.needPrompt': ['请输入提示词', 'Please enter a prompt'],
  'st.gen.needModel': ['该类型暂无可用模型', 'No enabled model for this kind'],
  'st.gen.disabledModel': ['所选模型已被管理台关闭，请换一个', 'This model is disabled in the console, pick another'],
  'st.gen.started': ['任务已提交', 'Task submitted'],
  'st.gen.dismiss': ['移除', 'Dismiss'],
  'st.results': ['结果', 'Results'],
  'st.results.count': ['{n} 项', '{n} items'],
  'st.results.loading': ['加载画廊…', 'Loading gallery…'],
  'st.results.empty.title': ['画廊还是空的', 'Your gallery is empty'],
  'st.results.empty.desc': ['左侧输入提示词并点击「生成」，结果会出现在这里，也会写入 GET /studio/api/gallery。',
    'Write a prompt on the left and hit Generate; results show up here and are stored via GET /studio/api/gallery.'],
  'st.results.empty.cta': ['用示例提示词试一下', 'Try a sample prompt'],
  'st.results.error': ['画廊加载失败', 'Failed to load the gallery'],
  'st.results.filterAll': ['全部', 'All'],
  'st.task.line': ['任务 {id}', 'Task {id}'],
  'st.task.account': ['账号 {acct}', 'Account {acct}'],
  'st.health.ok': ['号池 {healthy}/{total} · 上游 {latency}ms', 'Pool {healthy}/{total} · upstream {latency}ms'],
  'st.health.fail': ['健康检查失败', 'Health check failed'],
  'st.regen': ['重新生成（同一提示词与参数）', 'Regenerate with the same prompt and parameters'],
  'st.cooldown': ['冷却 {sec}s', 'Cooldown {sec}s'],
  'st.mock.video': ['演示模式无真实视频，显示为占位帧', 'Demo mode has no real video; showing a placeholder frame'],
  'st.mock.audio': ['演示模式无真实音频', 'Demo mode has no real audio'],
  'st.star': ['收藏', 'Star'],
  'st.unstar': ['取消收藏', 'Unstar'],
});

/* ---------------------------------------------------------------------------
 * 状态（跨语言切换 / 路由切换保持）
 * ------------------------------------------------------------------------ */

const KINDS = ['image', 'video', 'audio'];

function defaultState() {
  return {
    mode: 'custom',
    kind: 'image',
    prompt: '',
    model: { image: '', video: '', audio: '' },
    ratio: { image: 0, video: 0, audio: 0 },
    values: {},          // { [kind]: { [alias]: {param: value} } }
    paramsOpen: { image: true, video: true, audio: true },
    ref: null,           // { name, size, url, dataUrl }
    refUrl: '',
    galleryKind: '',     // '' = 全部
  };
}

let S = load();

function load() {
  const saved = store.getJSON(store.keys.studio, null);
  const base = defaultState();
  if (!saved || typeof saved !== 'object') return base;
  const next = { ...base, ...saved };
  next.model = { ...base.model, ...(saved.model || {}) };
  next.ratio = { ...base.ratio, ...(saved.ratio || {}) };
  next.paramsOpen = { ...base.paramsOpen, ...(saved.paramsOpen || {}) };
  next.values = saved.values || {};
  next.ref = null; // objectURL 无法跨会话恢复
  next.refUrl = '';
  return next;
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; store.setJSON(store.keys.studio, S); }, 250);
}

/* 目录缓存 */
let CATALOG = null;
let catalogError = null;

async function loadCatalog() {
  if (CATALOG) return CATALOG;
  CATALOG = await api.studio('/studio/api/catalog');
  return CATALOG;
}

function modelsFor(kind) {
  if (!CATALOG) return [];
  return CATALOG[kind] || [];
}

function currentModel() {
  const list = modelsFor(S.kind);
  return list.find((m) => m.alias === S.model[S.kind]) || list[0] || null;
}

function sizeList(model, kind) {
  if (!model) return [];
  if (kind === 'video' && model.sizes_large && model.sizes_large.length) {
    return model.sizes_large.length ? model.sizes_large : model.sizes;
  }
  return model.sizes || [];
}

/* ---------------------------------------------------------------------------
 * 参数规格与默认值
 * ------------------------------------------------------------------------ */

function paramDefaults(model, kind) {
  const dp = (model && model.default_params && model.default_params.basicDiffusionArgs) || {};
  const defaults = (CATALOG && CATALOG.defaults) || {};
  const ir = (defaults.image_request && defaults.image_request.basicDiffusionArgs) || {};
  const irFront = (defaults.image_request && defaults.image_request.imageInputFrontArgs) || {};
  const vr = (defaults.video_request && defaults.video_request.basicDiffusionArgs) || {};
  const num = (...vals) => {
    for (const v of vals) if (typeof v === 'number' && !Number.isNaN(v)) return v;
    return undefined;
  };

  if (kind === 'image') {
    return {
      quantity: num(dp.numImagesPerPrompt, ir.numImagesPerPrompt, 1),
      steps: num(dp.numInferenceSteps, ir.numInferenceSteps, 30),
      guidance_scale: num(dp.guidanceScale, ir.guidanceScale, 4),
      sampler: dp.sampler || ir.sampler || (model.support_sampler && model.support_sampler[0] && model.support_sampler[0].value) || 'Euler',
      seed: num(dp.seed, ir.seed, -1),
      negative_prompt: (defaults.image_request && defaults.image_request.promptArgs && defaults.image_request.promptArgs.negativePrompt) || '',
      strength: num(irFront.strength, 0.7),
    };
  }
  if (kind === 'video') {
    return {
      total_seconds: num(dp.totalSeconds, vr.totalSeconds, 5),
      steps: num(dp.numInferenceSteps, vr.numInferenceSteps, 50),
      guidance_scale: num(dp.guidanceScale, vr.guidanceScale, 5),
      seed: num(dp.seed, vr.seed, -1),
      negative_prompt: (defaults.video_request && defaults.video_request.promptArgs && defaults.video_request.promptArgs.negativePrompt) || '',
    };
  }
  // audio：字段来自 registry 的 default_params / limits / allowed
  const al = (model && model.allowed) || {};
  return {
    quantity: num(dp.audioCount, 1),
    steps: num(dp.numInferenceSteps, 40),
    guidance_scale: num(dp.cfgScale, 4),
    seed: num(dp.seed, -1),
    total_seconds: num(dp.duration, 60),
    bpm: num(dp.bpm, 128),
    sample_rate: num(dp.sampleRate, (al.sampleRates && al.sampleRates[0]) || 48000),
    key_scale: dp.keyScale || (al.keyScales && al.keyScales[0]) || 'N/A',
    time_signature: dp.timeSignature || (al.timeSignatures && al.timeSignatures[0]) || 'N/A',
    vocal_language: dp.vocalLanguage || (al.vocalLanguages && al.vocalLanguages[0]) || 'unknown',
    lyrics: '',
  };
}

/** 音频字段的可选值（来自模型 allowed；没有就退回通用列表） */
function allowedOf(model, key, fallback) {
  const al = (model && model.allowed) || {};
  const v = al[key];
  return Array.isArray(v) && v.length ? v : fallback;
}

function limitsOf(model, kind, key) {
  const lim = (model && model.limits) || {};
  const map = {
    quantity: 'audioCount', steps: 'numInferenceSteps',
    guidance_scale: 'cfgScale', seed: 'seed', total_seconds: 'duration',
  };
  const l = lim[map[key]];
  if (l && typeof l === 'object') return l;
  // 通用兜底
  if (key === 'quantity') return { min: 1, max: 4 };
  if (key === 'steps') return { min: 1, max: 100 };
  if (key === 'guidance_scale') return { min: 0, max: 20 };
  if (key === 'seed') return { min: -1, max: 2147483647 };
  if (key === 'total_seconds') return { min: 1, max: 600 };
  return { min: 0, max: 100 };
}

/** 当前生效值 = 用户覆盖 ?? 模型默认 */
function valueOf(model, kind, key) {
  const box = (S.values[kind] && S.values[kind][model.alias]) || {};
  if (Object.prototype.hasOwnProperty.call(box, key)) return box[key];
  return paramDefaults(model, kind)[key];
}

function setValue(model, kind, key, value) {
  S.values[kind] = S.values[kind] || {};
  S.values[kind][model.alias] = S.values[kind][model.alias] || {};
  S.values[kind][model.alias][key] = value;
  save();
}

/* ---------------------------------------------------------------------------
 * 视图
 * ------------------------------------------------------------------------ */

let view = null;
let resultsBox = null;
let pendingBox = null;
let healthState = { ok: false, text: '' };
const pollers = new Map();

export async function mount(root, ctx) {
  const cleanupFns = [];

  root.appendChild(h('div.view.view--studio'));
  view = root.querySelector('.view--studio');

  const side = h('aside.studio__side');
  const main = h('section.studio__main');
  const grid = h('div.studio', side, main);
  view.appendChild(h('div', h('div.row.row--between.row--wrap',
    h('div',
      h('h1', { style: { fontSize: '18px' } }, t('st.title')),
      h('div.card__sub', t('st.sub'))),
    h('div.row.row--sm', ...headerExtras()),
  )));
  view.appendChild(grid);

  // 先渲染骨架，避免布局跳动
  main.appendChild(h('div.card', h('div.card__body', skeletonGrid(6))));

  try {
    await loadCatalog();
    catalogError = null;
  } catch (err) {
    catalogError = err;
    renderError(root, err);
    return cleanup;
  }

  ensureSelection();
  renderSide(side);
  renderMain(main);

  healthCheck();

  return cleanup;

  function cleanup() {
    for (const stop of pollers.values()) stop();
    pollers.clear();
    cleanupFns.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    view = null;
    resultsBox = null;
    pendingBox = null;
  }
}

function headerExtras() {
  const chips = [];
  if (MOCK) chips.push(tag(pick('演示数据', 'demo data'), 'accent'));
  const healthChip = h('span.tag', { id: 'st-health' }, t('c.loading'));
  chips.push(healthChip);
  setTimeout(() => {
    const el = document.getElementById('st-health');
    if (el && healthState.text) el.textContent = healthState.text;
  }, 0);
  return [frag(...chips)];
}

function renderError(root, err) {
  clear(view);
  const retry = h('button.btn.btn--primary', {
    type: 'button',
    on: { click: () => { CATALOG = null; location.reload(); } },
  }, t('c.retry'));
  view.appendChild(emptyState({
    title: t('c.error'),
    desc: err instanceof ApiError ? err.describe() : String(err && err.message ? err.message : err),
    iconName: 'alert',
    action: retry,
  }));
}

async function healthCheck() {
  const el = document.getElementById('st-health');
  try {
    const res = await api.studio('/studio/api/health');
    const pool = res.pool || {};
    const up = res.upstream || {};
    healthState = {
      ok: true,
      text: t('st.health.ok')
        .replace('{healthy}', String(pool.healthy ?? '?'))
        .replace('{total}', String(pool.total ?? '?'))
        .replace('{latency}', String(up.latency_ms ?? '?')),
    };
    if (el) el.textContent = healthState.text;
  } catch (err) {
    healthState = { ok: false, text: t('st.health.fail') };
    if (el) el.textContent = healthState.text;
  }
}

/** 选中不存在的模型时：优先用目录 defaults[kind]，否则第一个 enabled 的模型 */
function ensureSelection() {
  const defaults = (CATALOG && CATALOG.defaults) || {};
  for (const kind of KINDS) {
    const list = modelsFor(kind);
    if (!list.length) continue;
    const cur = list.find((m) => m.alias === S.model[kind]);
    if (cur && cur.enabled) continue;

    const preferred = defaults[kind];
    const preferredModel = preferred ? list.find((m) => m.alias === preferred && m.enabled) : null;
    if (!cur && preferredModel) { S.model[kind] = preferredModel.alias; continue; }
    if (!cur && preferred && !list.some((m) => m.alias === preferred)) {
      // 目录里没有该别名，退回第一个启用的
    }
    const firstEnabled = list.find((m) => m.enabled);
    if (firstEnabled) S.model[kind] = firstEnabled.alias;
    else if (!cur) S.model[kind] = list[0].alias;
  }
  const model = currentModel();
  if (model) syncRatioToModel(model);
}

function syncRatioToModel(model) {
  const list = sizeList(model, S.kind);
  if (!list.length) return;
  const dp = (model.default_params && model.default_params.basicDiffusionArgs) || {};
  let idx = -1;
  if (typeof dp.width === 'number' && typeof dp.height === 'number') {
    idx = list.findIndex((s) => s.width === dp.width && s.height === dp.height);
  }
  if (idx < 0) idx = list.findIndex((s) => s.value === 0);
  if (idx < 0) idx = 0;
  S.ratio[S.kind] = idx;
}

/* ---------------------------------------------------------------------------
 * 左侧参数区
 * ------------------------------------------------------------------------ */

function section(title, ...children) {
  return h('div.stack.stack--sm',
    h('div.section-label', title),
    ...children);
}

function renderSide(side) {
  clear(side);

  /* ---- 模式 ---- */
  const modeSeg = segmented({
    items: [
      { value: 'custom', label: t('st.mode.custom') },
      { value: 'agent', label: t('st.mode.agent') },
    ],
    value: S.mode,
    onChange: (v) => { S.mode = v; save(); renderSide(side); renderMain(document.querySelector('.studio__main')); },
  });

  /* ---- 类型 ---- */
  const kindSeg = segmented({
    items: [
      { value: 'image', label: t('st.kind.image'), icon: 'image' },
      { value: 'video', label: t('st.kind.video'), icon: 'video' },
      { value: 'audio', label: t('st.kind.audio'), icon: 'music' },
    ],
    value: S.kind,
    size: 'lg',
    onChange: (v) => {
      S.kind = v;
      ensureSelection();
      save();
      renderSide(side);
      renderMain(document.querySelector('.studio__main'));
    },
  });

  side.appendChild(h('div.card',
    h('div.card__body',
      section(t('st.mode'), modeSeg,
        S.mode === 'agent' ? h('div.field__hint', t('st.mode.agentHint')) : null),
      h('div.card__divider'),
      section(t('st.type'), kindSeg),
    ),
  ));

  const model = currentModel();
  if (!model) {
    side.appendChild(h('div.card', h('div.card__body',
      emptyState({
        title: t('st.gen.needModel'),
        desc: pick('该类型下没有启用的模型，去管理台「模型开关」里打开。',
          'No enabled model for this kind; enable one under Admin → Models.'),
        iconName: 'sliders',
      }))));
    return;
  }

  /* ---- 模型 ---- */
  side.appendChild(h('div.card', h('div.card__body',
    section(t('st.model'), modelPicker(model, side)),
    section(t('st.ratio'), ratioChips(model, side)),
  )));

  /* ---- 提示词（Omni 渐变边框） ---- */
  const textarea = h('textarea.prompt-textarea', {
    placeholder: t('st.prompt.placeholder'),
    rows: 6,
    props: { value: S.prompt },
    on: {
      input: (e) => {
        S.prompt = e.target.value;
        save();
        countEl.textContent = `${S.prompt.length} / 2000`;
        countEl.classList.toggle('is-over', S.prompt.length > 2000);
        summaryEl.textContent = summaryLine();
      },
    },
  });
  const countEl = h('span.charcount', `${S.prompt.length} / 2000`);
  const genBtn = h('button.btn.btn--primary', {
    type: 'button',
    on: { click: (ev) => doGenerate(ev.currentTarget) },
  }, icon('sparkles', 'icon icon--16'), t('st.gen'));

  const summaryEl = h('div.charcount', { id: 'st-summary' }, summaryLine());

  const omni = h('div.omni.prompt-omni',
    h('div.omni__inner',
      textarea,
      h('div.prompt-toolbar',
        h('div.prompt-toolbar__left',
          h('span.tag.tag--accent', `${model.label} · ${model.sub_label}`),
          summaryEl),
        h('span.spacer'),
        countEl,
        genBtn,
      ),
    ),
  );

  const inspire = chipRow({
    className: '',
    items: inspirationItems().map((label) => ({ value: label, label, ghost: true })),
    value: '__none__',
    onChange: (v) => {
      if (!v || v === '__none__') return;
      appendPrompt(v, textarea, countEl, summaryEl);
    },
  });
  inspire.classList.add('chips--inspire');

  side.appendChild(h('div.card', h('div.card__body',
    section(t('st.prompt'), omni, h('div.section-label', t('st.prompt.inspire')), inspire),
  )));

  /* ---- 参数 ---- */
  side.appendChild(buildParamsPanel(model, side));

  /* ---- 参考图 ---- */
  if (S.kind !== 'audio') {
    side.appendChild(buildRefPanel(side));
  }

  /* ---- 生成按钮（大屏时在面板底部再放一个，方便长参数后操作） ---- */
  side.appendChild(h('button.btn.btn--primary.btn--block', {
    type: 'button',
    on: { click: (ev) => doGenerate(ev.currentTarget) },
  }, icon('sparkles', 'icon icon--16'), t('st.gen')));
}

function summaryLine() {
  const model = currentModel();
  if (!model) return '';
  const kind = S.kind;
  const list = sizeList(model, kind);
  const size = list[S.ratio[kind]] || list[0] || {};
  const parts = [`${size.width}×${size.height}`];
  if (kind !== 'audio') parts.push(`${valueOf(model, kind, 'steps')} ${pick('步', 'steps')}`);
  const g = valueOf(model, kind, 'guidance_scale');
  parts.push(kind === 'audio' ? `CFG ${g}` : `CFG ${g}`);
  if (kind === 'video' || kind === 'audio') parts.push(`${valueOf(model, kind, 'total_seconds')}s`);
  if (kind === 'image') {
    parts.push(`×${valueOf(model, kind, 'quantity')}`);
    parts.push(String(valueOf(model, kind, 'sampler')));
  }
  return parts.join(' · ');
}

function inspirationItems() {
  return pick(
    ['电影感光线，浅景深', '赛博朋克霓虹夜景', '手绘水彩风格', '产品级棚拍', '中国水墨', '8K 超清细节', '柔和的晨光', '复古胶片颗粒'],
    ['cinematic lighting, shallow depth of field', 'cyberpunk neon night', 'hand-drawn watercolor',
      'studio product shot', 'chinese ink painting', '8k ultra detailed', 'soft morning light', 'vintage film grain'],
  );
}

function appendPrompt(text, textarea, countEl, summaryEl) {
  const cur = textarea.value.trim();
  S.prompt = cur ? `${cur}${/[，,。.]$/.test(cur) ? ' ' : '，'}${text}` : text;
  textarea.value = S.prompt;
  textarea.focus();
  save();
  countEl.textContent = `${S.prompt.length} / 2000`;
  if (summaryEl) summaryEl.textContent = summaryLine();
}

/* ---- 模型选择器 ---- */

function badgesFor(model) {
  const tags = [];
  tags.push(tag(model.trainable ? t('st.model.lora') : t('st.model.checkpoint'), model.trainable ? 'accent' : ''));
  const isFree = /^MusePublic\//.test(String(model.model || ''));
  tags.push(tag(isFree ? t('st.model.free') : t('st.model.platform'), isFree ? 'free' : 'platform'));
  if (!model.enabled) tags.push(tag(t('st.model.disabled'), 'muted'));
  return tags;
}

function modelPicker(model, side) {
  const menu = h('div.model-menu', { style: { display: 'none' } });
  const trigger = h('button.model-trigger', {
    type: 'button',
    'aria-expanded': 'false',
    'aria-haspopup': 'listbox',
    on: {
      click: (e) => {
        e.stopPropagation();
        const open = trigger.getAttribute('aria-expanded') === 'true';
        trigger.setAttribute('aria-expanded', open ? 'false' : 'true');
        menu.style.display = open ? 'none' : '';
        if (!open) menu.querySelector('input')?.focus();
      },
    },
  },
    icon(S.kind === 'image' ? 'image' : S.kind === 'video' ? 'video' : 'music', 'icon icon--20'),
    h('span.model-trigger__text',
      h('span.model-trigger__title', `${model.label} · ${model.sub_label}`),
      h('span.model-trigger__meta', ...badgesFor(model))),
    icon('chevron-down'),
  );

  const search = h('input.input', {
    type: 'search', placeholder: t('st.model.search'),
    on: { input: () => paint(search.value.trim().toLowerCase()) },
  });

  function optionRow(m) {
    const disabled = !m.enabled;
    const btn = h('button.model-option', {
      type: 'button',
      role: 'option',
      'aria-disabled': disabled ? 'true' : 'false',
      'aria-selected': m.alias === model.alias ? 'true' : 'false',
      class: m.alias === model.alias ? 'is-active' : '',
      on: {
        click: () => {
          if (disabled) { toast(t('st.gen.disabledModel'), { type: 'info' }); return; }
          S.model[S.kind] = m.alias;
          syncRatioToModel(m);
          save();
          renderSide(side);
        },
      },
    },
      h('span.model-option__text',
        h('div.model-option__title', `${m.label} · ${m.sub_label}`),
        h('div.model-option__sub.truncate', m.model)),
      h('span.model-option__tags', ...badgesFor(m)),
    );
    return btn;
  }

  function paint(q = '') {
    clear(menu);
    menu.appendChild(h('div.model-menu__search', search));
    const list = modelsFor(S.kind).filter((m) => {
      if (!q) return true;
      return `${m.label} ${m.sub_label} ${m.alias} ${m.model}`.toLowerCase().includes(q);
    });
    if (!list.length) {
      menu.appendChild(h('div.empty', { style: { padding: '24px 12px', border: '0' } }, t('st.model.none')));
      return;
    }
    for (const m of list) menu.appendChild(optionRow(m));
  }

  paint();

  const wrap = h('div.model-select', trigger, menu);
  const closeOnOutside = (ev) => {
    if (!wrap.contains(ev.target)) {
      trigger.setAttribute('aria-expanded', 'false');
      menu.style.display = 'none';
    }
  };
  document.addEventListener('mousedown', closeOnOutside);
  const closeOnEsc = (ev) => {
    if (ev.key === 'Escape') { trigger.setAttribute('aria-expanded', 'false'); menu.style.display = 'none'; }
  };
  document.addEventListener('keydown', closeOnEsc);
  // 卸载时清理（通过 MutationObserver 观察 side 是否脱离文档）
  const mo = new MutationObserver(() => {
    if (!document.body.contains(wrap)) {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEsc);
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  return wrap;
}

/* ---- 比例 ---- */

function ratioChips(model, side) {
  const list = sizeList(model, S.kind);
  if (!list.length) return h('div.field__hint', t('c.none'));
  return chipRow({
    items: list.map((s, i) => ({
      value: i,
      label: `${s.label} · ${s.width}×${s.height}`,
      title: `${s.width} × ${s.height}${s.value !== undefined ? ` (value=${s.value})` : ''}`,
    })),
    value: S.ratio[S.kind] ?? 0,
    onChange: (i) => {
      S.ratio[S.kind] = Number(i);
      save();
      renderSide(side);
      renderMain(document.querySelector('.studio__main'));
    },
  });
}

/* ---- 参数面板 ---- */

function buildParamsPanel(model, side) {
  const kind = S.kind;
  const title = kind === 'image' ? t('st.params.image') : kind === 'video' ? t('st.params.video') : t('st.params.audio');
  const open = S.paramsOpen[kind] !== false;

  const restore = h('button.btn.btn--sm.btn--ghost', {
    type: 'button',
    on: {
      click: (ev) => {
        ev.stopPropagation();
        if (S.values[kind]) delete S.values[kind][model.alias];
        save();
        renderSide(side);
        renderMain(document.querySelector('.studio__main'));
        toast(t('st.params.restore'), { type: 'ok', timeout: 1600 });
      },
    },
  }, icon('refresh', 'icon icon--14'), t('st.params.restore'));

  const col = collapsible({
    title,
    subtitle: t('st.params.hint'),
    open,
    extra: restore,
    onToggle: (v) => { S.paramsOpen[kind] = v; save(); },
  });

  const body = col.body;
  const refresh = () => {
    const summaryEl = document.getElementById('st-summary');
    if (summaryEl) summaryEl.textContent = summaryLine();
  };

  if (kind === 'image') {
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'quantity', t('st.p.quantity'), { min: 1, max: 4 }, refresh),
      numField(model, kind, 'steps', t('st.p.steps'), limitsOf(model, kind, 'steps'), refresh),
    ));
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'guidance_scale', t('st.p.guidance'), limitsOf(model, kind, 'guidance_scale'), refresh, 0.5),
      seedField(model, kind, refresh),
    ));
    const samplers = (model.support_sampler || []).map((s) => ({ value: s.value, label: s.label }));
    if (samplers.length) {
      body.appendChild(field(t('st.p.sampler'), selectInput({
        options: samplers,
        value: valueOf(model, kind, 'sampler'),
        onChange: (v) => { setValue(model, kind, 'sampler', v); refresh(); },
      })));
    }
    body.appendChild(field(t('st.p.negative'), h('textarea.textarea', {
      rows: 3,
      props: { value: valueOf(model, kind, 'negative_prompt') || '' },
      on: { input: (e) => setValue(model, kind, 'negative_prompt', e.target.value) },
    }), { hint: pick('负面提示词会随请求一起提交', 'Sent along with the request') }));

    const strength = numField(model, kind, 'strength', t('st.p.strength'), { min: 0, max: 1 }, refresh, 0.05);
    strength.style.opacity = S.ref || S.refUrl ? '1' : '.5';
    strength.querySelector('input').disabled = !(S.ref || S.refUrl);
    body.appendChild(h('div',
      strength,
      h('div.field__hint', t('st.p.strength.hint')),
    ));
  } else if (kind === 'video') {
    const list = sizeList(model, kind);
    const size = list[S.ratio[kind]] || list[0] || {};
    body.appendChild(field(t('st.p.size'),
      h('div.input.input--mono', { style: { display: 'flex', alignItems: 'center' } }, `${size.width} × ${size.height}`),
      { hint: pick('由上方比例决定，切换比例档位即改变尺寸', 'Determined by the aspect chips above') }));
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'total_seconds', t('st.p.seconds'), limitsOf(model, kind, 'total_seconds'), refresh),
      numField(model, kind, 'steps', t('st.p.steps'), limitsOf(model, kind, 'steps'), refresh),
    ));
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'guidance_scale', t('st.p.guidance'), limitsOf(model, kind, 'guidance_scale'), refresh, 0.5),
      seedField(model, kind, refresh),
    ));
    body.appendChild(field(t('st.p.negative'), h('textarea.textarea', {
      rows: 3,
      props: { value: valueOf(model, kind, 'negative_prompt') || '' },
      on: { input: (e) => setValue(model, kind, 'negative_prompt', e.target.value) },
    })));
  } else {
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'quantity', t('st.p.quantity'), limitsOf(model, kind, 'quantity'), refresh),
      numField(model, kind, 'steps', t('st.p.steps'), limitsOf(model, kind, 'steps'), refresh),
    ));
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'guidance_scale', t('st.p.guidance'), limitsOf(model, kind, 'guidance_scale'), refresh, 0.1),
      seedField(model, kind, refresh),
    ));
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'total_seconds', t('st.p.duration'), limitsOf(model, kind, 'total_seconds'), refresh),
    ));
  }

  if (kind === 'audio') {
    body.appendChild(h('div.grid-2',
      numField(model, kind, 'bpm', t('st.p.bpm'), limitsOf(model, kind, 'bpm'), refresh),
      numField(model, kind, 'sample_rate', t('st.p.sampleRate'), { min: 8000, max: 48000 }, refresh, 100),
    ));
    body.appendChild(h('div.grid-2',
      field(t('st.p.keyScale'), selectInput({
        options: allowedOf(model, 'keyScales', ['N/A', 'C major', 'A minor']).map((x) => ({ label: String(x), value: String(x) })),
        value: valueOf(model, kind, 'key_scale'),
        onChange: (v) => { setValue(model, kind, 'key_scale', v); refresh(); },
      })),
      field(t('st.p.timeSignature'), selectInput({
        options: allowedOf(model, 'timeSignatures', ['N/A', '2', '3', '4', '6']).map((x) => ({ label: String(x), value: String(x) })),
        value: valueOf(model, kind, 'time_signature'),
        onChange: (v) => { setValue(model, kind, 'time_signature', v); refresh(); },
      })),
    ));
    body.appendChild(field(t('st.p.vocalLanguage'), selectInput({
      options: allowedOf(model, 'vocalLanguages', ['unknown', 'zh', 'en']).map((x) => ({ label: String(x), value: String(x) })),
      value: valueOf(model, kind, 'vocal_language'),
      onChange: (v) => { setValue(model, kind, 'vocal_language', v); refresh(); },
    })));
    body.appendChild(field(t('st.p.lyrics'), h('textarea.textarea', {
      rows: 4,
      placeholder: t('st.p.lyrics.placeholder'),
      props: { value: valueOf(model, kind, 'lyrics') || '' },
      on: { input: (e) => setValue(model, kind, 'lyrics', e.target.value) },
    }), { hint: t('st.p.lyrics.hint') }));
  }

  return col.panel;
}

function numField(model, kind, key, label, lim, onChange, step = 1) {
  const input = numberInput({
    value: valueOf(model, kind, key),
    min: lim.min, max: lim.max, step,
    onChange: (v) => { setValue(model, kind, key, v); if (onChange) onChange(); },
  });
  return field(label, h('div.input-num', input), {
    hint: lim.min !== undefined ? `${lim.min} – ${lim.max}` : '',
  });
}

function seedField(model, kind, onChange) {
  const seed = valueOf(model, kind, 'seed');
  const input = numberInput({
    value: seed,
    min: -1, max: 2147483647,
    onChange: (v) => { setValue(model, kind, 'seed', v); if (onChange) onChange(); },
  });
  const dice = h('button.btn.btn--sm.btn--icon', {
    type: 'button',
    title: pick('随机种子', 'Random seed'),
    on: {
      click: () => {
        const v = Math.floor(Math.random() * 2147483647);
        input.value = String(v);
        setValue(model, kind, 'seed', v);
        if (onChange) onChange();
      },
    },
  }, icon('refresh', 'icon icon--14'));
  return field(t('st.p.seed'), h('div.input-num', input, dice), { hint: t('st.p.seed.hint') });
}

/* ---- 参考图 ---- */

function buildRefPanel(side) {
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', class: 'sr-only',
  });

  const zone = h('div.dropzone', {
    role: 'button', tabindex: '0',
    on: {
      click: () => fileInput.click(),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
      dragover: (e) => { e.preventDefault(); zone.classList.add('is-over'); },
      dragleave: () => zone.classList.remove('is-over'),
      drop: (e) => {
        e.preventDefault();
        zone.classList.remove('is-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) attachFile(f, side);
      },
    },
  },
    icon('upload', 'icon icon--24'),
    h('div.dropzone__title', t('st.ref.drop')),
    h('div.dropzone__hint', t('st.ref.hint')),
  );

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) attachFile(f, side);
    fileInput.value = '';
  });

  const urlInput = textInput({
    value: S.refUrl,
    placeholder: t('st.ref.urlPlaceholder'),
    mono: true,
    onChange: (v) => { S.refUrl = v.trim(); save(); renderSide(side); renderMain(document.querySelector('.studio__main')); },
  });

  const preview = S.ref || S.refUrl
    ? h('div.thumb',
      h('img', { src: S.ref ? S.ref.url : S.refUrl, alt: 'reference' }),
      h('span.thumb__badge', S.ref ? `${S.ref.name} · ${(S.ref.size / 1024).toFixed(0)}KB` : 'URL'),
      h('button.thumb__remove', {
        type: 'button', title: t('st.ref.remove'), 'aria-label': t('st.ref.remove'),
        on: {
          click: () => {
            if (S.ref && S.ref.url.startsWith('blob:')) URL.revokeObjectURL(S.ref.url);
            S.ref = null;
            S.refUrl = '';
            save();
            renderSide(side);
            renderMain(document.querySelector('.studio__main'));
          },
        },
      }, icon('x', 'icon icon--14')),
    )
    : null;

  return h('div.card', h('div.card__body',
    section(t('st.ref'),
      preview || zone,
      fileInput,
      !preview ? field(t('st.ref.urlLabel'), urlInput) : null,
    ),
  ));
}

function attachFile(file, side) {
  if (!file.type.startsWith('image/')) { toast(t('st.ref.notImage'), { type: 'error' }); return; }
  if (file.size > 10 * 1024 * 1024) { toast(t('st.ref.tooBig'), { type: 'error' }); return; }
  if (S.ref && S.ref.url && S.ref.url.startsWith('blob:')) URL.revokeObjectURL(S.ref.url);
  const previewUrl = URL.createObjectURL(file);
  S.ref = {
    name: file.name, size: file.size, type: file.type,
    url: previewUrl, previewUrl, uploading: true,
  };
  save();
  renderSide(side);
  renderMain(document.querySelector('.studio__main'));

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = String(reader.result || '');
    const alive = () => S.ref && S.ref.previewUrl === previewUrl;
    if (!alive()) return;
    S.ref.dataUrl = dataUrl;
    try {
      // 走网关的 OSS 三段式上传，拿到可被上游访问的 URL
      const res = await api.studio('/studio/api/uploads', {
        method: 'POST',
        body: { filename: file.name, data_url: dataUrl, type: 'AIGC_MUSE_IMG' },
      });
      if (!alive()) return;
      S.ref.uploading = false;
      S.ref.remoteUrl = (res && res.url) || '';
      S.ref.mediaId = (res && res.media_id) || '';
      S.ref.upstream = !!(res && res.upstream);
      S.ref.note = (res && res.note) || '';
      if (!S.ref.upstream) {
        toast(t('st.ref.localOnly'), { desc: res && res.note ? res.note : t('st.ref.localOnly.desc'), type: 'warning' });
      }
    } catch (err) {
      if (!alive()) return;
      S.ref.uploading = false;
      S.ref.uploadError = err instanceof ApiError ? err.describe() : String((err && err.message) || err);
      toast(t('st.ref.uploadFailed'), { desc: S.ref.uploadError, type: 'error' });
    }
    save();
    renderSide(side);
    renderMain(document.querySelector('.studio__main'));
  };
  reader.readAsDataURL(file);
}

/* ---------------------------------------------------------------------------
 * 生成
 * ------------------------------------------------------------------------ */

function buildPayload(model, kind) {
  const list = sizeList(model, kind);
  const size = list[S.ratio[kind]] || list[0] || {};
  const mode = S.mode;
  const v = (k) => valueOf(model, kind, k);

  const payload = {
    kind,
    model: model.alias,
    mode,
    prompt: S.prompt.trim(),
  };

  if (kind === 'image') {
    Object.assign(payload, {
      width: size.width,
      height: size.height,
      quantity: v('quantity'),
      seed: v('seed'),
      steps: v('steps'),
      guidance_scale: v('guidance_scale'),
      sampler: v('sampler'),
      negative_prompt: v('negative_prompt') || '',
    });
    const ref = referenceUrl();
    if (ref) {
      payload.image = ref;
      payload.strength = v('strength');
      payload.references = [{ type: 'IMAGE', url: ref }];
    }
  } else if (kind === 'video') {
    Object.assign(payload, {
      width: size.width,
      height: size.height,
      total_seconds: v('total_seconds'),
      steps: v('steps'),
      guidance_scale: v('guidance_scale'),
      seed: v('seed'),
      negative_prompt: v('negative_prompt') || '',
    });
    const ref = referenceUrl();
    if (ref) {
      payload.image = ref;
      payload.references = [{ type: 'IMAGE', url: ref }];
    }
  } else {
    Object.assign(payload, {
      quantity: v('quantity'),
      steps: v('steps'),
      guidance_scale: v('guidance_scale'),
      seed: v('seed'),
      total_seconds: v('total_seconds'),
      bpm: v('bpm'),
      sample_rate: v('sample_rate'),
      key_scale: v('key_scale'),
      time_signature: v('time_signature'),
      vocal_language: v('vocal_language'),
      lyrics: v('lyrics') || '',
    });
  }
  return payload;
}

function referenceUrl() {
  if (S.refUrl) return S.refUrl;
  if (S.ref) return S.ref.remoteUrl || S.ref.url;
  return '';
}

async function doGenerate(btn) {
  const model = currentModel();
  if (!model) { toast(t('st.gen.needModel'), { type: 'error' }); return; }
  if (!model.enabled) { toast(t('st.gen.disabledModel'), { type: 'error' }); return; }
  if (!S.prompt.trim()) { toast(t('st.gen.needPrompt'), { type: 'error' }); return; }

  const payload = buildPayload(model, S.kind);
  const main = document.querySelector('.studio__main');
  // 智能体模式走上游会话 + SSE 链路，网关侧是独立路由
  const agent = S.mode === 'agent' && (S.kind === 'image' || S.kind === 'video');
  const endpoint = agent ? '/studio/api/agent/generate' : '/studio/api/generate';

  await busy(btn, async () => {
    try {
      const res = await api.studio(endpoint, { method: 'POST', body: payload });
      toast(t('st.gen.started'), {
        desc: `${model.sub_label} · ${res.task_id}${agent ? ' · Agent' : ''}`,
        type: 'ok',
      });
      addPending(main, res.task_id, payload, model);
      startPoll(res.task_id, main);
    } catch (err) {
      toastError(err, t('st.gen.failed'));
      pushFailureCard(main, payload, err);
    }
  });
}

const BACKOFF = { base: 1500, factor: 1.35, max: 5000, maxAttempts: 400 };

function startPoll(taskId, main) {
  if (pollers.has(taskId)) return;
  let attempt = 0;
  let stopped = false;
  let timer = null;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    pollers.delete(taskId);
  };
  pollers.set(taskId, stop);

  const tick = async () => {
    if (stopped) return;
    attempt += 1;
    try {
      const task = await api.studio(`/studio/api/tasks/${encodeURIComponent(taskId)}`);
      updatePending(task);
      if (task.status === 'succeeded') {
        stop();
        removePending(taskId);
        toast(t('st.gen.done'), { desc: task.prompt ? String(task.prompt).slice(0, 60) : taskId, type: 'ok' });
        refreshGallery(main);
        return;
      }
      if (task.status === 'failed' || task.status === 'cancelled') {
        stop();
        removePending(taskId);
        pushFailureCard(main, task.params || {}, new ApiError(task.error || t('st.gen.failed'), { type: 'upstream_error' }));
        return;
      }
    } catch (err) {
      // 404/网络抖动：指数退避重试，超限后放弃
      if (err instanceof ApiError && err.status === 404) {
        stop();
        removePending(taskId);
        pushFailureCard(main, {}, err);
        return;
      }
      if (attempt > BACKOFF.maxAttempts) {
        stop();
        removePending(taskId);
        pushFailureCard(main, {}, err);
        return;
      }
    }
    const delay = Math.min(BACKOFF.max, BACKOFF.base * Math.pow(BACKOFF.factor, attempt - 1));
    timer = setTimeout(tick, delay);
  };

  timer = setTimeout(tick, 900);
}

/* ---- 生成中的骨架卡 ---- */

function addPending(main, taskId, payload, model) {
  const box = ensurePendingBox();
  const slot = document.getElementById('st-pending-slot');
  if (slot && !slot.contains(box)) slot.appendChild(box);
  else if (!box.isConnected) main.appendChild(box);

  const count = Math.max(1, Math.min(4, payload.quantity || 1));
  const ratio = payload.width && payload.height ? `${payload.width} / ${payload.height}` : '1 / 1';
  const card = h('div.gcard', { dataset: { task: taskId } },
    h('div.gcard__media', { style: { '--gcard-ratio': ratio } },
      h('div.skeleton', { style: { position: 'absolute', inset: '0', borderRadius: '0' } }),
      count > 1 ? h('span.gcard__badge', `×${count}`) : null),
    h('div.gcard__meta',
      h('div.progress', h('div.progress__bar', { style: { width: '6%' } })),
      h('div.gcard__prompt', String(payload.prompt).slice(0, 120)),
      h('div.gcard__sub',
        icon('loader', 'icon icon--14 spin'),
        h('span', { dataset: { stage: '1' } }, t('st.gen.queued')),
        h('span.spacer'),
        h('span.mono', taskId)),
    ),
  );
  box.appendChild(card);
}

function ensurePendingBox() {
  if (pendingBox) return pendingBox;
  pendingBox = h('div.gallery', { id: 'st-pending' });
  return pendingBox;
}

function updatePending(task) {
  const main = document.querySelector('.studio__main');
  const el = document.querySelector(`.gcard[data-task="${CSS.escape(task.task_id)}"]`);
  if (!el) return;
  const bar = el.querySelector('.progress__bar');
  const stage = el.querySelector('[data-stage]');
  const pct = typeof task.progress === 'number' ? Math.max(6, Math.min(100, task.progress)) : (task.status === 'processing' ? 60 : 12);
  if (bar) bar.style.width = `${pct}%`;
  if (stage) {
    stage.textContent = task.status === 'processing'
      ? `${t('st.gen.processing')} ${pct}%`
      : t('st.gen.queued');
  }
}

function removePending(taskId) {
  const el = document.querySelector(`.gcard[data-task="${CSS.escape(taskId)}"]`);
  if (el) el.remove();
  const box = document.getElementById('st-pending');
  if (box && !box.children.length) box.remove();
}

function pushFailureCard(main, payload, err) {
  if (!main) return;
  const box = main.querySelector('.st-failures') || (() => {
    const b = h('div.stack.stack--sm.st-failures');
    main.appendChild(b);
    return b;
  })();
  const card = h('div.card',
    h('div.card__body.card__body--tight',
      h('div.row',
        icon('alert', 'icon icon--20'),
        h('div.stack.stack--xs.truncate',
          h('div', h('strong', t('st.gen.failed'))),
          h('div.card__sub', err instanceof ApiError ? err.describe() : String(err))),
        h('span.spacer'),
        h('button.btn.btn--sm', {
          type: 'button',
          on: {
            click: (ev) => {
              const btn = ev.currentTarget;
              busy(btn, async () => {
                try {
                  const res = await api.studio('/studio/api/generate', { method: 'POST', body: payload });
                  card.remove();
                  startPoll(res.task_id, main);
                  addPending(main, res.task_id, payload, currentModel());
                } catch (e2) { toastError(e2, t('st.gen.failed')); }
              });
            },
          },
        }, t('c.retry')),
        h('button.btn.btn--sm.btn--ghost', {
          type: 'button', 'aria-label': t('st.gen.dismiss'),
          on: { click: () => card.remove() },
        }, icon('x', 'icon icon--14')),
      ),
    ),
  );
  box.appendChild(card);
}

/* ---------------------------------------------------------------------------
 * 结果区
 * ------------------------------------------------------------------------ */

let galleryItems = [];
let galleryLoading = false;
let galleryError = null;

function renderMain(main) {
  if (!main) return;
  clear(main);
  resultsBox = null;
  pendingBox = null;

  const refreshBtn = h('button.btn.btn--sm', {
    type: 'button',
    on: { click: (ev) => busy(ev.currentTarget, () => refreshGallery(main, true)) },
  }, icon('refresh', 'icon icon--14'), t('c.refresh'));

  const filter = chipRow({
    items: [
      { value: '', label: t('st.results.filterAll') },
      { value: 'image', label: t('st.kind.image'), icon: 'image' },
      { value: 'video', label: t('st.kind.video'), icon: 'video' },
      { value: 'audio', label: t('st.kind.audio'), icon: 'music' },
    ],
    value: S.galleryKind,
    onChange: (v) => { S.galleryKind = v; save(); refreshGallery(main); },
  });

  main.appendChild(h('div.card',
    h('div.card__head',
      h('div.card__title', icon('grid', 'icon icon--16'), t('st.results')),
      h('span.card__sub', { id: 'st-results-count' }, galleryItems.length ? t('st.results.count').replace('{n}', String(galleryItems.length)) : ''),
      h('span.spacer'),
      h('div.row.row--sm', filter, refreshBtn),
    ),
    h('div.card__body.card__body--tight',
      h('div', { id: 'st-pending-slot' }),
      h('div', { id: 'st-gallery' }, galleryLoading
        ? skeletonGrid(6)
        : galleryError
          ? emptyState({ title: t('st.results.error'), desc: galleryError, iconName: 'alert' })
          : galleryItems.length
            ? buildGallery(main)
            : emptyState({
              title: t('st.results.empty.title'),
              desc: t('st.results.empty.desc'),
              iconName: 'image',
              action: h('button.btn.btn--sm.btn--primary', {
                type: 'button',
                on: {
                  click: () => {
                    S.prompt = inspirationItems()[1];
                    save();
                    renderSide(document.querySelector('.studio__side'));
                  },
                },
              }, t('st.results.empty.cta')),
            })),
    ),
  ));

  refreshGallery(main);
}

function setCount() {
  const el = document.getElementById('st-results-count');
  if (el) el.textContent = galleryItems.length ? t('st.results.count').replace('{n}', String(galleryItems.length)) : '';
}

async function refreshGallery(main, showToast = false) {
  const target = document.getElementById('st-gallery');
  if (!target) return;
  if (!galleryItems.length) {
    clear(target);
    target.appendChild(skeletonGrid(6));
  }
  try {
    const query = { limit: 60 };
    if (S.galleryKind) query.kind = S.galleryKind;
    const res = await api.studio('/studio/api/gallery', { query });
    galleryItems = Array.isArray(res.items) ? res.items : [];
    galleryError = null;
  } catch (err) {
    galleryError = err instanceof ApiError ? err.describe() : String(err);
    galleryItems = [];
  }
  const box = document.getElementById('st-gallery');
  if (!box) return;
  clear(box);
  if (galleryError) {
    box.appendChild(emptyState({
      title: t('st.results.error'),
      desc: galleryError,
      iconName: 'alert',
      action: h('button.btn.btn--sm.btn--primary', {
        type: 'button', on: { click: () => refreshGallery(main, true) },
      }, t('c.retry')),
    }));
  } else if (!galleryItems.length) {
    box.appendChild(emptyState({
      title: t('st.results.empty.title'),
      desc: t('st.results.empty.desc'),
      iconName: 'image',
    }));
  } else {
    box.appendChild(buildGallery(main));
  }
  setCount();
  const slot = document.getElementById('st-pending-slot');
  if (slot && pendingBox) slot.appendChild(pendingBox);
  if (showToast) toast(t('c.refresh'), { type: 'ok', timeout: 1200 });
}

function buildGallery(main) {
  const grid = h('div.gallery');
  for (const task of galleryItems) grid.appendChild(taskCard(task, main));
  return grid;
}

function taskCard(task, main) {
  const out = (task.outputs && task.outputs[0]) || {};
  const model = MODEL_LABEL(task.model);
  const kind = task.kind || out.type || 'image';
  const ratio = out.width && out.height ? `${out.width} / ${out.height}` : '1 / 1';

  const media = h('div.gcard__media', {
    class: kind === 'video' || kind === 'audio' ? 'gcard__media--video' : '',
    style: { '--gcard-ratio': ratio },
  });

  if (kind === 'video' && out.url && !MOCK) {
    const video = h('video', {
      src: out.url,
      poster: out.poster || undefined,
      controls: true,
      preload: 'metadata',
      playsinline: true,
    });
    video.addEventListener('error', () => {
      clear(media);
      media.appendChild(h('img', { src: out.poster || '', alt: task.prompt || '' }));
    });
    media.appendChild(video);
  } else if (kind === 'audio') {
    media.appendChild(h('img', { src: out.poster || out.url || '', alt: task.prompt || '' }));
  } else {
    media.appendChild(h('img', {
      src: out.url || out.poster || '',
      alt: task.prompt || '',
      loading: 'lazy',
    }));
  }

  media.appendChild(h('span.gcard__badge',
    icon(kind === 'video' ? 'video' : kind === 'audio' ? 'music' : 'image', 'icon icon--14'),
    kind === 'video' ? `${out.duration || 5}s` : kind === 'audio' ? fmtDuration(out.duration || 0) : `${out.width || '?'}×${out.height || '?'}`));

  const overlay = h('div.gcard__overlay',
    actBtn('download', t('c.download'), () => downloadTask(task)),
    actBtn('copy', t('c.copyLink'), async () => {
      const ok = await copyText(out.url || '');
      toast(ok ? t('c.copied') : t('c.copyFailed'), { type: ok ? 'ok' : 'error', timeout: 1600 });
    }),
    actBtn('expand', t('c.zoom'), () => lightbox(out.url || out.poster || '', task.prompt || '')),
    actBtn('refresh', t('st.regen'), () => regenerate(task)),
    actBtn(task.star ? 'star' : 'star', task.star ? t('st.unstar') : t('st.star'), async (ev) => {
      try {
        await api.studio(`/studio/api/gallery/${encodeURIComponent(task.task_id)}/star`, {
          method: 'POST', body: { star: !task.star },
        });
        task.star = !task.star;
        toast(task.star ? t('st.star') : t('st.unstar'), { type: 'ok', timeout: 1200 });
      } catch (err) {
        toastError(err);
      }
    }),
  );
  media.appendChild(overlay);

  const meta = h('div.gcard__meta',
    kind === 'audio' && out.url && !MOCK
      ? h('audio.gcard__audio', { src: out.url, controls: true, preload: 'none' })
      : null,
    h('div.gcard__prompt', { title: task.prompt || '' }, task.prompt || pick('（无提示词）', '(no prompt)')),
    h('div.gcard__sub',
      h('span.mono', model),
      h('span', '·'),
      h('span', fmtRelative(task.created)),
      task.account ? frag(h('span', '·'), h('span.truncate', task.account)) : null),
  );

  const card = h('div.gcard', { dataset: { id: task.task_id } }, media, meta);
  if (kind === 'video') card.querySelector('.gcard__media').classList.add('gcard__media--video');
  return card;

  function actBtn(iconName, label, onClick) {
    const b = h('button.gcard__act', {
      type: 'button', title: label, 'aria-label': label,
      on: { click: (ev) => { ev.stopPropagation(); onClick(ev); } },
    }, icon(iconName, 'icon icon--16'));
    return b;
  }
}

function MODEL_LABEL(alias) {
  for (const kind of KINDS) {
    const m = modelsFor(kind).find((x) => x.alias === alias);
    if (m) return m.sub_label || m.label;
  }
  return alias || '';
}

async function downloadTask(task) {
  const out = (task.outputs && task.outputs[0]) || {};
  const url = out.url || out.poster;
  if (!url) { toast(t('c.error'), { type: 'error' }); return; }
  const ext = task.kind === 'video' ? 'mp4' : task.kind === 'audio' ? 'mp3' : 'png';
  const name = `${task.task_id}.${ext}`;
  try {
    const a = h('a', { href: url, download: name, rel: 'noopener' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

/** 用当前画廊项的提示词与参数再跑一次 */
async function regenerate(task) {
  const main = document.querySelector('.studio__main');
  const kind = task.kind || 'image';
  if (kind !== S.kind) {
    S.kind = kind;
    ensureSelection();
    renderSide(document.querySelector('.studio__side'));
  }
  if (task.model) {
    const list = modelsFor(kind);
    const found = list.find((m) => m.alias === task.model);
    if (found && found.enabled) {
      S.model[kind] = found.alias;
    } else if (found) {
      toast(t('st.gen.disabledModel'), { type: 'info' });
      return;
    }
  }
  if (task.prompt) S.prompt = task.prompt;
  const p = task.params || {};
  const model = currentModel();
  if (model) {
    const box = { params: {} };
    for (const key of ['quantity', 'steps', 'guidance_scale', 'seed', 'sampler', 'total_seconds']) {
      if (p[key] !== undefined) box.params[key] = p[key];
    }
    S.values[kind] = S.values[kind] || {};
    S.values[kind][model.alias] = { ...(S.values[kind][model.alias] || {}), ...box.params };
    const list = sizeList(model, kind);
    const idx = list.findIndex((s) => s.width === p.width && s.height === p.height);
    if (idx >= 0) S.ratio[kind] = idx;
  }
  save();
  renderSide(document.querySelector('.studio__side'));
  const btn = document.querySelector('.studio__side .btn--primary');
  await doGenerate(btn);
  toast(t('st.regen'), { type: 'ok', timeout: 1400 });
}
