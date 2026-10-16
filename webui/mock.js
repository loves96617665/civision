/* =============================================================================
 * Civision Gateway WebUI — 演示模式（mock）
 *
 * 用途：不启动后端也能自检整个 UI。URL 带 ?mock=1 时拦截 window.fetch，
 *      按 docs/API.md 定义的结构返回离线假数据。
 *
 * 数据来源：模型目录从 server/data/registry.json 抽取（21 图片 / 8 视频 / 3 音频），
 *          尺寸档位、default_params、version_id、model 与原表一致。
 * 额外可用的调试参数：
 *   ?mock=1&mock_error=1   让约 1/3 的 admin 请求返回 502，用于检查错误态
 *   window.__civisionMock.failNext(n)  让接下来 n 个请求失败
 * ========================================================================== */

import { MOCK } from './app.js';

/* ---------------------------------------------------------------------------
 * 1. 模型注册表夹具（取自 server/data/registry.json）
 * ------------------------------------------------------------------------ */

const RATIO_LABELS = ['9:16', '3:4', '1:1', '4:3', '16:9'];

function sizes(defs) {
  return defs.map(([label, width, height, value]) => ({ label, width, height, value }));
}

const SZ = {
  A: sizes([['9:16', 928, 1664, -2], ['3:4', 1104, 1472, -1], ['1:1', 1328, 1328, 0], ['4:3', 1472, 1104, 1], ['16:9', 1664, 928, 2]]),
  B: sizes([['9:16', 720, 1280, -2], ['3:4', 864, 1152, -1], ['1:1', 1024, 1024, 0], ['4:3', 1152, 864, 1], ['16:9', 1280, 720, 2]]),
  C: sizes([['9:16', 576, 1024, -2], ['3:4', 768, 1024, -1], ['1:1', 1024, 1024, 0], ['4:3', 1024, 768, 1], ['16:9', 1024, 576, 2]]),
  D: sizes([['9:16', 1080, 1920, -2], ['3:4', 1080, 1440, -1], ['1:1', 1440, 1440, 0], ['4:3', 1440, 1080, 1], ['16:9', 1920, 1080, 2]]),
  E: sizes([['9:16', 1152, 2048, -2], ['3:4', 1536, 2048, -1], ['1:1', 2048, 2048, 0], ['4:3', 2048, 1536, 1], ['16:9', 2048, 1152, 2]]),
  VL: sizes([['9:16', 720, 1280, -2], ['3:4', 720, 960, -1], ['1:1', 720, 720, 0], ['4:3', 960, 720, 1], ['16:9', 1280, 720, 2]]),
  VS: sizes([['9:16', 480, 848, -2], ['3:4', 480, 640, -1], ['1:1', 480, 480, 0], ['4:3', 640, 480, 1], ['16:9', 848, 480, 2]]),
  MM: sizes([['9:16', 768, 1280, -2], ['3:4', 768, 960, -1], ['1:1', 768, 768, 0], ['4:3', 960, 768, 1], ['16:9', 1280, 768, 2]]),
};

const EULER = [{ label: 'Euler', value: 'Euler' }, { label: 'Euler Beta', value: 'Euler Beta' }];

/* [sd_version, sub_version, label, sub_label, version_id, model, trainable, max_pic_size, sizes, defaultParams, samplers] */
const IMAGE_ROWS = [
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_EDIT_2511', 'Qwen-Image', 'Qwen-Image-Edit-2511', 507464, 'Qwen/Qwen-Image-Edit-2511', false, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['QWEN_IMAGE_20_B', 'FIRERED_IMAGE_EDIT', 'Qwen-Image', 'FireRed-Image-Edit-1.1', 80028, 'FireRedTeam/FireRed-Image-Edit-1.1', true, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_EDIT_2509', 'Qwen-Image', 'Qwen-Image-Edit-2509', 382481, 'Qwen/Qwen-Image-Edit-2509', true, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_2512', 'Qwen-Image', 'Qwen-Image-2512', 1363, 'Qwen/Qwen-Image-2512', false, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_EDIT', 'Qwen-Image', 'Qwen-Image-Edit', 312623, 'MusePublic/Qwen-Image-Edit', true, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['FLUX_2', 'FLUX2_KLEIN_BASE_4B', 'FLUX.2', 'FLUX.2-klein-base-4B', 7008, 'black-forest-labs/FLUX.2-klein-base-4B', true, 1664, 'A', { guidanceScale: 0, height: 1024, numInferenceSteps: 4, width: 1024 }, EULER],
  ['FLUX_2', 'FLUX2_KLEIN_9B', 'FLUX.2', 'FLUX.2-klein-9B', 7005, 'black-forest-labs/FLUX.2-klein-9B', false, 1664, 'A', { guidanceScale: 0, height: 1024, numInferenceSteps: 4, width: 1024 }, EULER],
  ['FLUX_2', 'FLUX2_KLEIN_4B', 'FLUX.2', 'FLUX.2-klein-4B', 6989, 'black-forest-labs/FLUX.2-klein-4B', false, 1664, 'A', { guidanceScale: 0, height: 1024, numInferenceSteps: 4, width: 1024 }, EULER],
  ['FLUX_2', 'FLUX2_KLEIN_BASE_9B', 'FLUX.2', 'FLUX.2-klein-base-9B', 7010, 'black-forest-labs/FLUX.2-klein-base-9B', true, 1664, 'A', { guidanceScale: 0, height: 480, width: 480 }, EULER],
  ['Z_IMAGE_TURBO', 'Z_IMAGE_TURBO', 'Z-Image', 'Z-Image-Turbo', 692, 'Tongyi-MAI/Z-Image-Turbo', true, 2048, 'B', { guidanceScale: 4, height: 1024, numInferenceSteps: 30, width: 1024 }, [{ label: 'Euler', value: 'euler' }]],
  ['Z_IMAGE_TURBO', 'Z_IMAGE', 'Z-Image', 'Z-Image', 4044, 'Tongyi-MAI/Z-Image', true, 2048, 'B', { guidanceScale: 4, height: 1024, numInferenceSteps: 30, width: 1024 }, [{ label: 'Euler', value: 'euler' }]],
  ['SD_1_5', 'SD_1_5', 'SD1.5', 'stable-diffusion-v1-5', 43, 'MusePublic/14_ckpt_SD_1_5', false, 1024, 'C', { guidanceScale: 7.5, height: 1024, width: 768 }, EULER],
  ['SD_XL', 'SD_XL', 'SDXL', 'stable-diffusion-xl-base-1.0', 3, 'MusePublic/42_ckpt_SD_XL', false, 1440, 'C', { guidanceScale: 7.5, height: 1024, width: 768 }, EULER],
  ['SD_3', 'SD_3', 'SD3', 'stable-diffusion-3-medium', 76, 'MusePublic/stable-diffusion-3-medium', false, 1440, 'D', { guidanceScale: 3.5, height: 1440, width: 1080 }, EULER],
  ['FLUX_1', 'FLUX1_DEV', 'FLUX.1', 'FLUX.1-dev', 80, 'MusePublic/489_ckpt_FLUX_1', false, 1440, 'D', { guidanceScale: 3.5, height: 1440, width: 1080 }, EULER],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_20_B', 'Qwen-Image', 'Qwen-Image', 275167, 'MusePublic/Qwen-image', true, 1664, 'A', { guidanceScale: 4, height: 1472, width: 1104 }, EULER],
  ['HIDREAM_O1', 'HIDREAM_O1_IMAGE', 'HiDream-Image', 'HiDream-O1-Image', 111415, 'HiDream-ai/HiDream-O1-Image', true, 2048, 'E', { guidanceScale: 4, height: 2048, width: 2048 }, [{ label: 'Euler', value: 'Euler' }, { label: 'UniPC', value: 'UniPC' }]],
  ['KREA_2', 'KREA_2_TURBO', 'Krea-2', 'Krea-2-Turbo', 120333, 'krea-community/Krea-2-Turbo', true, 2048, 'C', { guidanceScale: 1, height: 1024, numInferenceSteps: 8, width: 1024 }, [{ label: 'Euler', value: 'euler' }]],
  ['IDEOGRAM_4', 'IDEOGRAM_4_FP8_IMAGE', 'Ideogram-4', 'Ideogram-4-fp8', 124895, 'ideogram-ai-community/ideogram-4-fp8', false, 1280, 'B', { guidanceScale: 1, height: 1024, numInferenceSteps: 8, width: 1024 }, [{ label: 'Euler', value: 'euler' }]],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_2_1', 'Qwen-Image', 'Qwen-Image-2.1', 174178, 'Qwen/Qwen-Image-2.1', true, 1664, 'A', { guidanceScale: 1, height: 1472, numInferenceSteps: 40, width: 1104 }, EULER],
  ['QWEN_IMAGE_20_B', 'QWEN_IMAGE_2_1_TURBO', 'Qwen-Image', 'Qwen-Image-2.1-Turbo', 194661, 'Qwen/Qwen-Image-2.1-Turbo', false, 1664, 'A', { guidanceScale: 1, height: 1472, numInferenceSteps: 8, width: 1104 }, EULER],
];

/* [sd_version, sub_version, label, sub_label, version_id, model, gen_type, support_type, sizesLarge, sizesSmall, defaultParams] */
const VIDEO_ROWS = [
  ['WAN_VIDEO_2_1_T2V_1_3_B', 'WAN_VIDEO_2_1_T2V_1_3_B', 'Wan2.1', 'Wan2.1-T2V-1.3B', 546, 'Wan-AI/Wan2.1-T2V-1.3B', 'T2V', ['TXT_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_1_T2V_14_B', 'WAN_VIDEO_2_1_T2V_14_B', 'Wan2.1', 'Wan2.1-T2V-14B', 650, 'Wan-AI/Wan2.1-T2V-14B-BF16', 'T2V', ['TXT_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_1_I2V_14_B', 'WAN_VIDEO_2_1_I2V_14_B', 'Wan2.1', 'Wan2.1-I2V-14B-720P', 648, 'Wan-AI/Wan2.1-I2V-14B-720P-BF16', 'I2V', ['IMG_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_1_FLF2V_14_B', 'WAN_VIDEO_2_1_FLF2V_14_B', 'Wan2.1', 'Wan2.1-FLF2V-14B-720P', 649, 'Wan-AI/Wan2.1-FLF2V-14B-720P-BF16', 'FLF2V', ['FLF_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_2_TI2V_5_B', 'WAN_VIDEO_2_2_TI2V_5_B', 'Wan2.2', 'Wan2.2-TI2V-5B', 626, 'Wan-AI/Wan2.2-TI2V-5B-BF16', 'IT2V', ['TXT_2_VIDEO', 'IMG_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_2_T2V_A_14_B', 'WAN_VIDEO_2_2_T2V_A_14_B', 'Wan2.2', 'Wan2.2-T2V-A14B', 557, 'Wan-AI/Wan2.2-T2V-A14B-BF16', 'T2V', ['TXT_2_VIDEO'], 'VL', 'VS'],
  ['WAN_VIDEO_2_2_I2V_A_14_B', 'WAN_VIDEO_2_2_I2V_A_14_B', 'Wan2.2', 'Wan2.2-I2V-A14B', 647, 'Wan-AI/Wan2.2-I2V-A14B-BF16', 'I2V', ['IMG_2_VIDEO'], 'VL', 'VS'],
  ['MINIMAX_H3', 'MINIMAX_H3', 'MiniMax-H3', 'MiniMax-H3', 150867, 'MiniMax/MiniMax-H3', 'I2V', ['TXT_2_VIDEO', 'IMG_2_VIDEO', 'FLF_2_VIDEO'], 'MM', null, { guidanceScale: 4, height: 768, numInferenceSteps: 20, width: 1280 }],
];

const AUDIO_ALLOWED = {
  sampleRates: [44100, 48000],
  keyScales: ['C major', 'C minor', 'D major', 'D minor', 'E major', 'E minor', 'F major', 'F minor',
    'G major', 'G minor', 'A major', 'A minor', 'B major', 'B minor', 'N/A'],
  timeSignatures: ['2', '3', '4', '6', 'N/A'],
  vocalLanguages: ['unknown', 'zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt'],
};

const AUDIO_ROWS = [
  {
    sd_version: 'ACESTEP_XL', sub_version: 'ACESTEP_XL_SFT', label: 'Ace-Step', sub_label: 'acestep-v15-xl-sft',
    version_id: 141218, model: 'ACE-Step/acestep-v15-xl-sft',
    default_params: { basicDiffusionArgs: { audioCount: 1, bpm: 128, cfgScale: 4, duration: 160, keyScale: 'N/A', numInferenceSteps: 50, sampleRate: 48000, seed: -1, timeSignature: 'N/A', vocalLanguage: 'unknown' } },
    limits: { audioCount: { min: 1, max: 4 }, bpm: { min: 30, max: 300 }, cfgScale: { min: 1, max: 10 }, duration: { min: 1, max: 600 }, numInferenceSteps: { min: 32, max: 100 }, seed: { min: -1, max: 2147483647 }, promptMaxLength: 4000, lyricsMaxLength: 4000 },
  },
  {
    sd_version: 'ACESTEP_XL', sub_version: 'ACESTEP_XL_TURBO', label: 'Ace-Step', sub_label: 'acestep-v15-xl-turbo',
    version_id: 141217, model: 'ACE-Step/acestep-v15-xl-turbo',
    default_params: { basicDiffusionArgs: { audioCount: 1, bpm: 128, cfgScale: 1, duration: 160, keyScale: 'N/A', numInferenceSteps: 8, sampleRate: 48000, seed: -1, timeSignature: 'N/A', vocalLanguage: 'unknown' } },
    limits: { audioCount: { min: 1, max: 4 }, bpm: { min: 30, max: 300 }, cfgScale: { min: 1, max: 10 }, duration: { min: 1, max: 600 }, numInferenceSteps: { min: 1, max: 100 }, seed: { min: -1, max: 2147483647 }, promptMaxLength: 4000, lyricsMaxLength: 4000 },
  },
  {
    sd_version: 'MINIMAX_MUSIC3', sub_version: 'MINIMAX_MUSIC3', label: 'MiniMax-Music3', sub_label: 'MiniMax-Music3',
    version_id: 166195, model: 'MiniMax/MiniMax-Music3',
    default_params: { basicDiffusionArgs: { audioCount: 1, cfgScale: 1.7, numInferenceSteps: 40, sampleRate: 48000, seed: -1 } },
    limits: { audioCount: { min: 1, max: 4 }, cfgScale: { min: 1, max: 10 }, numInferenceSteps: { min: 30, max: 50 }, seed: { min: -1, max: 2147483647 }, promptMaxLength: 4000, lyricsMaxLength: 4000 },
  },
];

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * 与后端 server/registry.py::_alias_for 完全一致的别名规则：
 *   仓库名优先（保留 . - _）；仓库名带数字前缀（MusePublic/14_ckpt_SD_1_5 这类）
 *   时退回 sub_label。保证 mock 与真实 `GET /v1/models` 的 id 逐字相同。
 */
function aliasOf(model, subLabel) {
  const repo = String(model || '').split('/').pop() || '';
  const pick = (repo && !/^\d/.test(repo)) ? repo : String(subLabel || repo);
  return String(pick).toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

/** 生成完整模型条目（catalog/admin 共用） */
function buildModels() {
  const out = [];
  for (const [sd, sub, label, subLabel, versionId, model, trainable, maxPicSize, szKey, dp, samplers] of IMAGE_ROWS) {
    out.push({
      kind: 'image', alias: aliasOf(model, subLabel), label, sub_label: subLabel,
      sd_version: sd, sub_version: sub, version_id: versionId, model,
      model_url: `modelscope://${model}?revision=master`,
      trainable, max_pic_size: maxPicSize, support_sampler: samplers,
      sizes: SZ[szKey].map((s) => ({ ...s })),
      default_params: { basicDiffusionArgs: { ...dp } },
      enabled: true,
    });
  }
  for (const [sd, sub, label, subLabel, versionId, model, genType, supportType, lg, sm, dp] of VIDEO_ROWS) {
    out.push({
      kind: 'video', alias: aliasOf(model, subLabel), label, sub_label: subLabel,
      sd_version: sd, sub_version: sub, version_id: versionId, model,
      model_url: `modelscope://${model}?revision=master`,
      gen_type: genType, support_type: supportType,
      sizes: SZ[lg].map((s) => ({ ...s })),
      sizes_large: SZ[lg].map((s) => ({ ...s })),
      sizes_small: sm ? SZ[sm].map((s) => ({ ...s })) : [],
      default_params: { basicDiffusionArgs: { ...(dp || { guidanceScale: 7.5, height: 1280, numInferenceSteps: 50, width: 720 }) } },
      enabled: true,
    });
  }
  for (const row of AUDIO_ROWS) {
    out.push({
      kind: 'audio', alias: aliasOf(row.model, row.sub_label), ...row,
      model_url: `modelscope://${row.model}?revision=master`,
      sizes: [{ label: '1:1', width: 1024, height: 1024, value: 0 }],
      allowed: AUDIO_ALLOWED,
      enabled: true,
    });
  }
  // 默认关掉两个，用于检验置灰/开关状态（真实网关由 admin 开关控制）
  const off = new Set(['stable-diffusion-v1-5', 'minimax-music3']);
  for (const m of out) if (off.has(m.alias)) m.enabled = false;
  return out;
}

const MODELS = buildModels();
const MODEL_BY_ALIAS = new Map(MODELS.map((m) => [m.alias, m]));

function modelsOfKind(kind) { return MODELS.filter((m) => m.kind === kind); }

/* ---------------------------------------------------------------------------
 * 2. 假图片（内联 SVG data URI，离线也能渲染）
 * ------------------------------------------------------------------------ */

const PALETTES = [
  ['#A970FF', '#4760FF'], ['#FFBB98', '#C55AFA'], ['#624AFF', '#22D3EE'],
  ['#7646FA', '#FF7AB6'], ['#3DBE8B', '#624AFF'], ['#F0A93B', '#A970FF'],
];

function svgArt({ width = 1024, height = 1024, title = '', sub = '', caption = '', seed = 0, kind = 'image' }) {
  const pal = PALETTES[Math.abs(seed) % PALETTES.length];
  const fs = Math.max(13, Math.round(Math.min(width, height) * 0.042));
  const clean = (s, n) => String(s).replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
  // 简易折行：按显示宽度约 22 个半角字符切分，最多 3 行
  const wrap = (text, perLine, maxLines) => {
    const out = [];
    let buf = '';
    let w = 0;
    for (const ch of text) {
      const cw = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
      if (w + cw > perLine && buf) { out.push(buf); buf = ''; w = 0; if (out.length === maxLines) break; }
      buf += ch;
      w += cw;
    }
    if (buf && out.length < maxLines) out.push(buf);
    return out;
  };
  const cw = Math.min(width, height) / fs;
  const titleLines = wrap(clean(title, 90), cw * 0.92, 3);
  const lineH = fs * 1.34;
  const startY = height / 2 - ((titleLines.length - 1) * lineH) / 2;
  const titleSvg = titleLines.map((line, i) => (
    `<text x="${width / 2}" y="${startY + i * lineH}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" opacity="0.96">${line}</text>`
  )).join('');
  const subText = clean(sub, 44);
  const bars = kind === 'audio'
    ? Array.from({ length: 28 }, (_, i) => {
      const bh = 20 + ((i * 37 + seed * 13) % 60);
      const x = (i + 0.5) * (width / 28);
      return `<rect x="${x - width / 90}" y="${height / 2 - (bh / 100) * height / 2}" width="${width / 60}" height="${(bh / 100) * height}" rx="${width / 200}" fill="rgba(255,255,255,.45)"/>`;
    }).join('')
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${pal[0]}"/><stop offset="100%" stop-color="${pal[1]}"/>
</linearGradient>
<radialGradient id="r" cx="0.75" cy="0.2" r="0.8">
<stop offset="0%" stop-color="rgba(255,255,255,.38)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/>
</radialGradient>
</defs>
<rect width="${width}" height="${height}" fill="#0B0B12"/>
<rect width="${width}" height="${height}" fill="url(#g)" opacity="0.92"/>
<rect width="${width}" height="${height}" fill="url(#r)"/>
${bars}
<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.62}" ry="${height * 0.32}" fill="rgba(0,0,0,.28)"/>
<g font-family="PingFang SC, Helvetica Neue, sans-serif" fill="#fff">
${titleSvg}
<text x="${width / 2}" y="${startY + titleLines.length * lineH + fs * 0.4}" font-size="${fs * 0.66}" text-anchor="middle" opacity="0.7">${subText}</text>
</g>
<text x="${width - fs * 0.9}" y="${height - fs * 0.8}" font-size="${fs * 0.56}" text-anchor="end" fill="rgba(255,255,255,.55)" font-family="monospace">${clean(caption || `${width}x${height}`, 40)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* ---------------------------------------------------------------------------
 * 3. 可变状态
 * ------------------------------------------------------------------------ */

const nowSec = () => Math.floor(Date.now() / 1000);
const rnd = (min, max) => min + Math.random() * (max - min);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const HEX = 'abcdef0123456789';
const hex = (n) => Array.from({ length: n }, () => HEX[Math.floor(Math.random() * HEX.length)]).join('');

const state = {
  keys: [
    { id: 'key_1', name: 'cherry-studio', prefix: 'sk-civ-9f2a', last4: 'c41d', enabled: true, models: ['*'], rpm: 60, quota: 0, used: 1284, requests: 1284, created: nowSec() - 86400 * 12, note: '桌面客户端', last_used: nowSec() - 600 },
    { id: 'key_2', name: 'nextchat', prefix: 'sk-civ-3b71', last4: '9ae0', enabled: true, models: ['z-image-turbo', 'wan2.2-i2v-a14b-bf16', 'qwen-image-2.1'], rpm: 20, quota: 5000, used: 812, requests: 812, created: nowSec() - 86400 * 5, note: '前端演示站', last_used: nowSec() - 5400 },
    { id: 'key_3', name: 'batch-script', prefix: 'sk-civ-c08e', last4: '17bb', enabled: false, models: ['*'], rpm: 120, quota: 0, used: 42, requests: 42, created: nowSec() - 86400 * 2, note: '批处理任务，已停用', last_used: nowSec() - 86400 },
  ],
  accounts: [
    { id: 'acc_1', label: 'a***@gmail.com', email: 'aishadow@gmail.com', enabled: true, healthy: true, cooldown_sec: 0, requests: 142, failures: 2, quota: { image: 100, video: 10, balance: 1234 }, last_error: '', created: nowSec() - 86400 * 9, cookie_set: true },
    { id: 'acc_2', label: 'w***@googlemail.com', email: 'wrenfield@googlemail.com', enabled: true, healthy: true, cooldown_sec: 27, requests: 96, failures: 0, quota: { image: 78, video: 8, balance: 902 }, last_error: '', created: nowSec() - 86400 * 7, cookie_set: true },
    { id: 'acc_3', label: 'm***@gmail.com', email: 'mallow@gmail.com', enabled: true, healthy: false, cooldown_sec: 0, requests: 58, failures: 11, quota: { image: 0, video: 0, balance: 0 }, last_error: 'InvalidAuthentication: user not logged in (upstream 401)', created: nowSec() - 86400 * 6, cookie_set: true },
    { id: 'acc_4', label: 'k***@temp.tf', email: 'kite@temp.tf', enabled: true, healthy: true, cooldown_sec: 0, requests: 12, failures: 0, quota: { image: 100, video: 10, balance: 640 }, last_error: '', created: nowSec() - 3600 * 5, cookie_set: false },
    { id: 'acc_5', label: '手工号 · 备用', email: 'ops@example.com', enabled: false, healthy: false, cooldown_sec: 0, requests: 3, failures: 3, quota: { image: 0, video: 0, balance: 0 }, last_error: 'quota exhausted: magicubes balance 0', created: nowSec() - 3600 * 2, cookie_set: true },
  ],
  settings: {
    upstream_base: 'https://modelscope.ai',
    timeout: 180,
    pool_size: 3,
    cooldown: 90,
    strict_model: true,
    auto_refill: false,
    mail_provider: 'emailnator',
    proxy: '',
    default_kind: 'image',
  },
  tasks: new Map(),
  gallery: [],
  jobs: new Map(),
  logs: [],
};

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const LOG_TEMPLATES = [
  ['info', 'pipeline', 'task %s queued model=%s kind=%s'],
  ['info', 'upstream', 'POST /api/v1/aigc/agentic/image/generate -> 200 %sms account=%s'],
  ['info', 'pool', 'account %s healthy=true quota={image:%s,video:%s}'],
  ['warn', 'pool', 'account %s cooldown %ss (rate_limit_exceeded)'],
  ['error', 'upstream', 'account %s InvalidAuthentication: user not logged in (upstream 401)'],
  ['info', 'admin', 'GET /admin/api/overview 200 %sms'],
  ['debug', 'store', 'sqlite flush tasks=%s keys=%s'],
  ['info', 'studio', 'gallery +1 task=%s outputs=%s'],
];
function seedLogs() {
  const out = [];
  const base = nowSec() - 3600;
  for (let i = 0; i < 160; i++) {
    const [level, scope, tpl] = LOG_TEMPLATES[i % LOG_TEMPLATES.length];
    const args = [hex(6), pickOne(MODELS).alias, pickOne(['image', 'video', 'audio']), Math.round(rnd(80, 2400)), hex(4), Math.round(rnd(10, 400)), Math.round(rnd(20, 800)), Math.round(rnd(2, 60))];
    let msg = tpl;
    msg = msg.replace(/%s/g, () => String(args.shift() ?? ''));
    out.push({ at: base + i * 20, level, scope, message: `[${scope}] ${msg}`, request_id: hex(10) });
  }
  state.logs = out;
}
seedLogs();

function mkTask({ kind, model, prompt, params, mode = 'custom', outputs = [], status = 'succeeded', created = nowSec() }) {
  return {
    task_id: `tsk_${hex(10)}`,
    kind, status, created,
    finished: status === 'succeeded' ? created + 42 : null,
    model, prompt, params, mode,
    account: 'a***@gmail.com',
    outputs, error: null, star: false,
  };
}

function seedGallery() {
  const seeds = [
    { kind: 'image', model: 'z-image-turbo', prompt: '一只坐在月球表面的橘猫，背后是地球升起，摄影级细节，35mm', params: { width: 1024, height: 1024, steps: 30, guidance_scale: 4, quantity: 1, seed: -1 } },
    { kind: 'image', model: 'qwen-image-2.1', prompt: '赛博朋克重庆夜景，霓虹灯牌与轻轨，雨后有倒影', params: { width: 1104, height: 1472, steps: 40, guidance_scale: 1, quantity: 1, seed: 123456 } },
    { kind: 'image', model: 'flux-2-klein-9b', prompt: 'minimal product shot of a translucent glass cube on a purple gradient', params: { width: 1024, height: 1024, steps: 4, guidance_scale: 0, quantity: 2, seed: -1 } },
    { kind: 'video', model: 'wan2.2-i2v-a14b-bf16', prompt: '镜头缓慢推近，蒸汽从咖啡杯升起，暖色晨光', params: { width: 480, height: 848, steps: 50, guidance_scale: 5, total_seconds: 5, seed: -1 } },
    { kind: 'audio', model: 'acestep-v15-xl-turbo', prompt: 'lo-fi hip hop，雨声采样，128bpm，轻松氛围', params: { quantity: 1, steps: 8, guidance_scale: 1, total_seconds: 160, seed: -1 } },
    { kind: 'image', model: 'hidream-o1-image', prompt: '手绘水彩风格的沿海小城，清晨薄雾，宽幅构图', params: { width: 2048, height: 1152, steps: 30, guidance_scale: 4, quantity: 1, seed: -1 } },
  ];
  state.gallery = seeds.map((s, i) => {
    const mdl = MODEL_BY_ALIAS.get(s.model) || modelsOfKind(s.kind)[0];
    const created = nowSec() - (i + 1) * 1800;
    const outputs = buildOutputs(s.kind, mdl, s.prompt, s.params.quantity || 1, i * 7 + 3, s.params);
    const task = mkTask({ ...s, created, outputs, model: mdl.alias, params: s.params });
    if (i === 0) task.star = true;
    state.tasks.set(task.task_id, task);
    return task;
  });
}

function buildOutputs(kind, model, prompt, quantity, seedBase, params = {}) {
  const sizes = model.sizes || [];
  const scale = MODEL_BY_ALIAS.get(model.alias) ? 0.5 : 0.5;
  return Array.from({ length: Math.max(1, Math.min(4, quantity)) }, (_, i) => {
    const s = sizes[(i + seedBase) % Math.max(1, sizes.length)] || { width: 1024, height: 1024 };
    const width = params.width || s.width;
    const height = params.height || s.height;
    const url = svgArt({
      width: Math.round(width * scale), height: Math.round(height * scale),
      title: prompt, sub: `${model.label} · ${model.sub_label}`,
      caption: `${width}×${height}`,
      seed: seedBase + i, kind,
    });
    if (kind === 'video') {
      return { type: 'video', url, poster: url, width, height, duration: params.total_seconds || 5 };
    }
    if (kind === 'audio') {
      return { type: 'audio', url, poster: url, duration: params.total_seconds || 160, sample_rate: 48000 };
    }
    return { type: 'image', url, width, height };
  });
}

seedGallery();

/* ---------------------------------------------------------------------------
 * 4. 任务推进 / 补号任务推进（惰性时间推进，无定时器）
 * ------------------------------------------------------------------------ */

function advanceTask(task) {
  if (task.status === 'succeeded' || task.status === 'failed') return task;
  const elapsed = Date.now() - task._startMs;
  const ratio = elapsed / task._durationMs;
  if (ratio < 0.25) task.status = 'queued';
  else if (ratio < 1) task.status = 'processing';
  else {
    task.status = 'succeeded';
    task.finished = nowSec();
    task.outputs = buildOutputs(task.kind, MODEL_BY_ALIAS.get(task.model) || modelsOfKind(task.kind)[0],
      task.prompt, task.params.quantity || 1, Math.floor(rnd(1, 99)), task.params);
    if (!state.gallery.includes(task)) state.gallery = [task, ...state.gallery];
  }
  task.progress = Math.max(4, Math.min(100, Math.round(ratio * 100)));
  return task;
}

const REFILL_STAGES = [
  ['mailbox', 300, '已分配邮箱，等待收信'],
  ['sendEmail', 1200, 'POST /api/v1/auth/sendEmail 已发送激活邮件'],
  ['captcha', 2100, '等待阿里云验证码 captcha_verify（SceneId 49006ysb）'],
  ['confirm', 2600, '点击邮件确认链接，账号已激活'],
  ['loginRegister', 3100, 'POST /api/v1/auth/loginRegister 完成注册'],
  ['done', 3700, '会话 Cookie 入库，账号可用'],
];
const REFILL_SLOT_MS = 4200;

function advanceJob(job) {
  const now = Date.now();
  if (job._lastMs) job._elapsedMs += now - job._lastMs;
  job._lastMs = now;

  const emails = job._emails;
  const steps = [];
  let done = 0;
  let failed = 0;

  emails.forEach((email, idx) => {
    const local = job._elapsedMs - idx * REFILL_SLOT_MS;
    if (local < 0) return;
    const baseAt = job._startSec + Math.round((idx * REFILL_SLOT_MS) / 1000);
    REFILL_STAGES.forEach(([stage, at, message]) => {
      if (local < at) return;
      if (stage === 'captcha' && job.verify && !job._captchaGiven) return;
      steps.push({ email, stage, message, at: baseAt + Math.round(at / 1000) });
    });
    if (local >= REFILL_SLOT_MS - 200) {
      done += 1;
      if (!job.accounts.some((a) => a.email === email)) {
        job.accounts.push({ id: `acc_${hex(4)}`, email, label: email.replace(/^(.{2}).*(@.*)$/, '$1***$2') });
        state.accounts.push({
          id: `acc_${hex(4)}`, label: email.replace(/^(.{2}).*(@.*)$/, '$1***$2'), email, enabled: true,
          healthy: true, cooldown_sec: 0, requests: 0, failures: 0,
          quota: { image: 100, video: 10, balance: 200 }, last_error: '', created: nowSec(), cookie_set: true,
        });
      }
    }
  });

  // 第一个邮箱在 captcha 阶段暂停等待人工过码
  if (job.verify && !job._captchaGiven && job._elapsedMs > 1500) {
    job.status = 'waiting_captcha';
    job.need_captcha = { email: emails[0], scene_id: '49006ysb', prefix: '18o9k0' };
  } else if (done >= job.target) {
    job.status = 'done';
    job.need_captcha = null;
  } else if (failed >= job.target) {
    job.status = 'failed';
  } else {
    job.status = 'running';
    job.need_captcha = null;
  }

  job.steps = steps;
  job.done = done;
  return job;
}

function startJob({ count, provider, verify }) {
  const jobId = `job_${hex(8)}`;
  const emails = Array.from({ length: Math.max(1, Math.min(10, count)) }, () => {
    const user = `${hex(3)}${pickOne(['kite', 'wren', 'mallow', 'lumen', 'onyx', 'fern'])}${hex(2)}`;
    const domain = provider === 'emailnator' ? 'googlemail.com'
      : provider === 'temp.tf' ? 'temp.tf'
        : provider === 'boomlify' ? 'boomlify.com' : 'relay.firefox.com';
    return `${user}@${domain}`;
  });
  const job = {
    job: jobId,
    status: 'running',
    target: emails.length,
    done: 0,
    provider,
    verify: !!verify,
    steps: [],
    need_captcha: null,
    accounts: [],
    _emails: emails,
    _elapsedMs: 0,
    _lastMs: Date.now(),
    _startSec: nowSec(),
    _captchaGiven: false,
  };
  advanceJob(job);
  state.jobs.set(jobId, job);
  return job;
}

function jobView(job) {
  advanceJob(job);
  return {
    job: job.job, status: job.status, target: job.target, done: job.done,
    provider: job.provider, steps: job.steps, need_captcha: job.need_captcha,
    accounts: job.accounts,
  };
}

/* ---------------------------------------------------------------------------
 * 5. 路由处理
 * ------------------------------------------------------------------------ */

const ver = '1.0.0';
const startedAt = Date.now() - 1000 * 60 * 37;

function overviewView() {
  const keysEnabled = state.keys.filter((k) => k.enabled).length;
  const healthy = state.accounts.filter((a) => a.enabled && a.healthy).length;
  const cooldown = state.accounts.filter((a) => a.cooldown_sec > 0).length;
  const enabledModels = MODELS.filter((m) => m.enabled).length;
  return {
    version: ver,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    keys: { total: state.keys.length, enabled: keysEnabled },
    pool: { total: state.accounts.length, healthy, cooldown },
    models: { total: MODELS.length, enabled: enabledModels },
    requests: { total: 812, today: 120, failed: 7 },
    upstream: { reachable: true, latency_ms: 176 + Math.round(rnd(-40, 60)) },
  };
}

function catalogView() {
  const group = (kind) => modelsOfKind(kind).map((m) => ({
    alias: m.alias, label: m.label, sub_label: m.sub_label,
    sd_version: m.sd_version, sub_version: m.sub_version,
    version_id: m.version_id, model: m.model,
    sizes: m.sizes, support_sampler: m.support_sampler || [],
    default_params: m.default_params,
    support_type: m.support_type || null,
    gen_type: m.gen_type || null,
    limits: m.limits || null,
    allowed: m.allowed || null,
    max_pic_size: m.max_pic_size || null,
    trainable: !!m.trainable,
    enabled: m.enabled,
  }));
  return {
    image: group('image'),
    video: group('video'),
    audio: group('audio'),
    defaults: {
      image: 'z-image-turbo',
      video: 'wan2.2-i2v-a14b-bf16',
      audio: 'acestep-v15-xl-turbo',
      image_request: {
        basicDiffusionArgs: { guidanceScale: 4, height: 1472, numImagesPerPrompt: 1, numInferenceSteps: 30, sampler: 'Euler', seed: -1, width: 1104 },
        promptArgs: { negativePrompt: '', prompt: '' },
        imageInputFrontArgs: { strength: 0.7 },
      },
      video_request: {
        basicDiffusionArgs: { guidanceScale: 5, height: 848, numInferenceSteps: 50, seed: -1, totalSeconds: 5, width: 480 },
        promptArgs: { negativePrompt: 'Bright tones, overexposed, static, blurry details, subtitles, worst quality, low quality', prompt: '' },
      },
    },
    ratios: { image: SZ.A.slice(), video: SZ.VS.slice() },
    style_tags: [
      { name: '摄影', tag: 'photography' }, { name: '电影感', tag: 'cinematic' },
      { name: '插画', tag: 'illustration' }, { name: '3D 渲染', tag: 'render' },
      { name: '国风', tag: 'chinese-style' }, { name: '像素', tag: 'pixel-art' },
    ],
    loras: [
      { model_version_id: 123, name: 'Detail Tweaker XL', weight: 0.8 },
      { model_version_id: 456, name: 'Film Grain', weight: 0.5 },
    ],
  };
}

function logsView({ limit = 200, level = '' } = {}) {
  const items = state.logs
    .filter((l) => !level || l.level === level)
    .slice(-Number(limit || 200))
    .reverse();
  return { items, total: state.logs.length };
}

function selftestView() {
  const checks = [
    ['上游可达', 'GET /api/v1/muse/predict/unauth/defaultTemplateV2 -> 200', 176],
    ['模型目录', `注册表 ${MODELS.length} 个模型（图片 ${modelsOfKind('image').length} / 视频 ${modelsOfKind('video').length} / 音频 ${modelsOfKind('audio').length}）`, 12],
    ['号池可用', `健康账号 ${state.accounts.filter((a) => a.healthy).length}/${state.accounts.length}`, 8],
    ['一次真实出图', 'z-image-turbo 1024x1024 steps=8 -> 1 张（耗时 6.4s）', 6420],
    ['存储可写', 'sqlite: tasks/gallery/keys 表写入正常', 4],
  ];
  return {
    ok: true,
    started: nowSec() - 7,
    finished: nowSec(),
    items: checks.map(([name, message, ms]) => ({ name, ok: true, ms, message })),
  };
}

/* ---------------------------------------------------------------------------
 * 6. 请求分派
 * ------------------------------------------------------------------------ */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errRes(message, { status = 400, type = 'invalid_request_error', code = '' } = {}) {
  return json({ error: { message, type, code, upstream_status: status, request_id: `req_${hex(8)}` } }, status);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failNextCount = 0;

async function dispatch(method, path, query, body) {
  if (failNextCount > 0) {
    failNextCount -= 1;
    return errRes('mock: 注入的失败响应（用于检查错误态）', { status: 502, type: 'upstream_error', code: 'UpstreamError' });
  }
  const forced = new URLSearchParams(location.search).get('mock_error') === '1' && path.startsWith('/admin/') && Math.random() < 0.34;

  await sleep(rnd(90, 320));
  if (forced) return errRes('mock: 随机注入的上游 502（?mock_error=1）', { status: 502, type: 'upstream_error', code: 'UpstreamError' });

  /* ---------------- Studio ---------------- */
  if (method === 'GET' && path === '/studio/api/catalog') return json(catalogView());

  if (method === 'GET' && path === '/studio/api/health') {
    return json({
      pool: { total: state.accounts.length, healthy: state.accounts.filter((a) => a.healthy).length },
      upstream: { reachable: true, latency_ms: Math.round(rnd(120, 260)) },
    });
  }

  if (method === 'POST' && path === '/studio/api/generate') {
    const kind = body.kind || 'image';
    const model = body.model || (modelsOfKind(kind)[0] || {}).alias;
    const mdl = MODEL_BY_ALIAS.get(model);
    if (!mdl) return errRes(`模型不存在或未启用：${model}`, { status: 404, type: 'model_not_found', code: 'model_not_found' });
    if (!mdl.enabled) return errRes(`模型已关闭：${model}（admin 模型开关）`, { status: 404, type: 'model_not_found', code: 'model_not_found' });
    if (!body.prompt || !String(body.prompt).trim()) {
      return errRes('prompt 不能为空', { status: 400, type: 'invalid_request_error' });
    }
    const task = mkTask({
      kind, model, prompt: body.prompt, params: body, mode: body.mode || 'custom',
      status: 'queued', created: nowSec(), outputs: [],
    });
    task._startMs = Date.now();
    task._durationMs = kind === 'video' ? rnd(9000, 14000) : kind === 'audio' ? rnd(7000, 11000) : rnd(4200, 8000);
    task.progress = 4;
    state.tasks.set(task.task_id, task);
    return json({ task_id: task.task_id, status: 'queued' }, 200);
  }

  const taskMatch = path.match(/^\/studio\/api\/tasks\/(.+)$/);
  if (method === 'GET' && taskMatch) {
    const task = state.tasks.get(decodeURIComponent(taskMatch[1]));
    if (!task) return errRes('task not found', { status: 404, type: 'not_found_error' });
    advanceTask(task);
    const { _startMs, _durationMs, ...view } = task;
    return json(view);
  }

  const starMatch = path.match(/^\/studio\/api\/gallery\/(.+)\/star$/);
  if (method === 'POST' && starMatch) {
    const task = state.tasks.get(decodeURIComponent(starMatch[1]));
    if (!task) return errRes('task not found', { status: 404, type: 'not_found_error' });
    task.star = !!body.star;
    return json({ ok: true, star: task.star });
  }

  if (method === 'GET' && path === '/studio/api/gallery') {
    const limit = Number(query.get('limit') || 60);
    const kind = query.get('kind') || '';
    const star = query.get('star');
    let items = state.gallery.filter((t) => t.status === 'succeeded');
    if (kind) items = items.filter((t) => t.kind === kind);
    if (star === '1') items = items.filter((t) => t.star);
    items = items.slice(0, limit);
    return json({ items: items.map(({ _startMs, _durationMs, ...v }) => v) });
  }

  /* ---------------- Admin ---------------- */
  if (method === 'GET' && path === '/admin/api/overview') return json(overviewView());

  if (method === 'GET' && path === '/admin/api/keys') {
    return json({ items: state.keys.map((k) => ({ ...k })) });
  }
  if (method === 'POST' && path === '/admin/api/keys') {
    const id = `key_${hex(4)}`;
    const plain = `sk-civ-${hex(32)}`;
    const item = {
      id, name: body.name || '未命名', prefix: plain.slice(0, 14), last4: plain.slice(-4),
      enabled: true, models: body.models && body.models.length ? body.models : ['*'],
      rpm: Number(body.rpm) || 60, quota: Number(body.quota) || 0, used: 0, requests: 0,
      created: nowSec(), note: body.note || '', last_used: 0,
    };
    state.keys.unshift(item);
    return json({ ...item, key: plain }, 201);
  }
  const keyMatch = path.match(/^\/admin\/api\/keys\/([^/]+)(?:\/(reset))?$/);
  if (keyMatch) {
    const key = state.keys.find((k) => k.id === keyMatch[1]);
    if (!key) return errRes('key not found', { status: 404, type: 'not_found_error' });
    if (method === 'GET' && !keyMatch[2]) return json({ ...key });
    if (method === 'PATCH' && !keyMatch[2]) {
      Object.assign(key, body, { id: key.id });
      return json({ ...key });
    }
    if (method === 'DELETE' && !keyMatch[2]) {
      state.keys = state.keys.filter((k) => k.id !== key.id);
      return json({ ok: true }, 200);
    }
    if (method === 'POST' && keyMatch[2] === 'reset') {
      key.used = 0;
      key.requests = 0;
      return json({ ...key });
    }
  }

  if (method === 'GET' && path === '/admin/api/accounts') {
    // 冷却倒计时实时递减
    const out = state.accounts.map((a) => ({
      ...a,
      cooldown_sec: a.cooldown_sec > 0 ? Math.max(0, a.cooldown_sec - 3) : 0,
    }));
    out.forEach((a, i) => { state.accounts[i].cooldown_sec = a.cooldown_sec; });
    return json({ items: out });
  }
  if (method === 'POST' && path === '/admin/api/accounts') {
    const cookie = body.cookie || '';
    const email = body.email || `manual-${hex(4)}@example.com`;
    const acc = {
      id: `acc_${hex(4)}`, label: body.label || email, email, enabled: true, healthy: true,
      cooldown_sec: 0, requests: 0, failures: 0,
      quota: { image: 100, video: 10, balance: 200 }, last_error: '', created: nowSec(),
      cookie_set: !!cookie,
    };
    state.accounts.unshift(acc);
    return json(acc, 201);
  }
  if (method === 'POST' && path === '/admin/api/accounts/import') {
    const lines = String(body.text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const created = lines.map((line) => {
      const acc = {
        id: `acc_${hex(4)}`, label: body.label || `批量-${hex(3)}`, email: line.length > 40 ? `${hex(6)}@cookie` : line,
        enabled: true, healthy: true, cooldown_sec: 0, requests: 0, failures: 0,
        quota: { image: 100, video: 10, balance: 200 }, last_error: '', created: nowSec(), cookie_set: true,
      };
      state.accounts.unshift(acc);
      return acc;
    });
    return json({ imported: created.length, items: created }, 201);
  }
  const accMatch = path.match(/^\/admin\/api\/accounts\/([^/]+)\/(check|enable)$/);
  if (method === 'POST' && accMatch) {
    const acc = state.accounts.find((a) => a.id === accMatch[1]);
    if (!acc) return errRes('account not found', { status: 404, type: 'not_found_error' });
    if (accMatch[2] === 'check') {
      acc.healthy = Math.random() > 0.25;
      acc.quota = { image: Math.round(rnd(20, 100)), video: Math.round(rnd(0, 10)), balance: Math.round(rnd(0, 2000)) };
      if (!acc.healthy) acc.last_error = 'InvalidAuthentication: user not logged in (upstream 401)';
      else acc.last_error = '';
      acc.cooldown_sec = acc.healthy ? 0 : acc.cooldown_sec;
      return json({ ...acc });
    }
    acc.enabled = body.enabled !== false;
    return json({ ...acc });
  }
  const accDelMatch = path.match(/^\/admin\/api\/accounts\/([^/]+)$/);
  if (method === 'DELETE' && accDelMatch) {
    state.accounts = state.accounts.filter((a) => a.id !== accDelMatch[1]);
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/admin/api/mail/providers') {
    return json({
      items: [
        { id: 'emailnator', label: 'emailnator', note: 'Google 邮箱别名，无需验证', available: true },
        { id: 'temp.tf', label: 'temp.tf', note: '临时邮箱 API', available: true },
        { id: 'boomlify', label: 'boomlify', note: '临时邮箱（限速较严）', available: true },
        { id: 'relay.firefox.com', label: 'relay.firefox.com', note: 'Firefox Relay 别名', available: false },
      ],
    });
  }
  if (method === 'POST' && path === '/admin/api/pool/refill') {
    const job = startJob({ count: Number(body.count) || 1, provider: body.provider || 'emailnator', verify: body.verify !== false });
    return json(jobView(job), 202);
  }
  const refillMatch = path.match(/^\/admin\/api\/pool\/refill\/([^/]+)(?:\/(captcha))?$/);
  if (refillMatch) {
    const job = state.jobs.get(refillMatch[1]);
    if (!job) return errRes('job not found', { status: 404, type: 'not_found_error' });
    if (method === 'POST' && refillMatch[2] === 'captcha') {
      const val = String(body.captcha_verify || '').trim();
      if (!val) return errRes('captcha_verify 不能为空', { status: 400, type: 'invalid_request_error' });
      job._captchaGiven = true;
      job.need_captcha = null;
      job.status = 'running';
      job.steps.push({ email: job._emails[0], stage: 'captcha', message: `captcha_verify 已回填（${val.slice(0, 12)}…）`, at: nowSec() });
      return json(jobView(job));
    }
    if (method === 'GET') return json(jobView(job));
  }

  if (method === 'GET' && path === '/admin/api/models') {
    return json({
      items: MODELS.map((m) => ({
        alias: m.alias, label: m.label, sub_label: m.sub_label, kind: m.kind,
        model: m.model, version_id: m.version_id, sd_version: m.sd_version,
        sub_version: m.sub_version, enabled: m.enabled, note: '',
      })),
      total: MODELS.length,
      enabled: MODELS.filter((m) => m.enabled).length,
    });
  }
  if (method === 'PATCH' && path.startsWith('/admin/api/models/')) {
    const alias = decodeURIComponent(path.slice('/admin/api/models/'.length));
    const m = MODEL_BY_ALIAS.get(alias);
    if (!m) return errRes('model not found', { status: 404, type: 'not_found_error' });
    if (body.enabled !== undefined) m.enabled = !!body.enabled;
    if (body.alias && body.alias !== alias) {
      MODEL_BY_ALIAS.delete(alias);
      m.alias = body.alias;
      MODEL_BY_ALIAS.set(m.alias, m);
    }
    if (body.note !== undefined) m.note = body.note;
    return json({ alias: m.alias, enabled: m.enabled, note: m.note || '' });
  }
  if (method === 'POST' && path === '/admin/api/models/bulk') {
    const kind = body.kind || '';
    const enabled = body.enabled !== false;
    const except = new Set(body.except || []);
    let changed = 0;
    for (const m of MODELS) {
      if (kind && m.kind !== kind) continue;
      if (except.has(m.alias)) continue;
      m.enabled = enabled;
      changed += 1;
    }
    return json({ changed, enabled, kind });
  }

  if (method === 'GET' && path === '/admin/api/settings') return json({ ...state.settings });
  if (method === 'PUT' && path === '/admin/api/settings') {
    Object.assign(state.settings, body);
    return json({ ...state.settings });
  }

  if (method === 'GET' && path === '/admin/api/logs') {
    return json(logsView({ limit: query.get('limit') || 200, level: query.get('level') || '' }));
  }
  if (method === 'POST' && path === '/admin/api/selftest') {
    await sleep(400);
    return json(selftestView());
  }

  /* ---------------- OpenAI 兼容面（少量） ---------------- */
  if (method === 'GET' && path === '/v1/models') {
    return json({
      object: 'list',
      data: MODELS.filter((m) => m.enabled).map((m) => ({
        id: m.alias, object: 'model', created: nowSec() - 86400, owned_by: 'civision',
        meta: {
          kind: m.kind, sd_version: m.sd_version, sub_version: m.sub_version,
          version_id: m.version_id, model: m.model, enabled: m.enabled, sizes: m.sizes,
        },
      })),
    });
  }

  return errRes(`mock 未实现该路由：${method} ${path}`, { status: 404, type: 'not_found_error', code: 'mock_route_missing' });
}

/* ---------------------------------------------------------------------------
 * 7. 安装拦截
 * ------------------------------------------------------------------------ */

export function installMock() {
  if (!MOCK || window.__CIVISION_MOCK_INSTALLED__) return;
  window.__CIVISION_MOCK_INSTALLED__ = true;

  const realFetch = window.fetch.bind(window);

  window.fetch = async function mockFetch(input, init = {}) {
    let url = '';
    let method = 'GET';
    let rawBody = init && init.body;

    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else if (input && typeof input === 'object') {
      url = input.url;
      method = input.method || method;
    }
    if (init && init.method) method = init.method;

    let parsed;
    try { parsed = new URL(url, location.origin); } catch { return realFetch(input, init); }

    // 非 API 请求（静态资源 / 外部）交回真实 fetch
    if (!/^\/(studio|admin|v1)\//.test(parsed.pathname)) return realFetch(input, init);

    let body = {};
    if (rawBody && typeof rawBody === 'string') { try { body = JSON.parse(rawBody); } catch { body = {}; } }

    try {
      return await dispatch(method.toUpperCase(), parsed.pathname, parsed.searchParams, body);
    } catch (err) {
      console.error('[mock] dispatch failed', err);
      return errRes(`mock 内部错误：${err && err.message}`, { status: 500, type: 'mock_error' });
    }
  };

  window.__civisionMock = {
    state,
    models: MODELS,
    failNext(n = 1) { failNextCount = n; },
    reset() { state.gallery = []; state.tasks.clear(); seedLogs(); },
  };

  console.info('[civision] mock 模式已启用：拦截 /studio/* /admin/* /v1/* 请求，返回离线夹具数据');
}
