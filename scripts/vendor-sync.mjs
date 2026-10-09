#!/usr/bin/env node
/**
 * 从上游同步 github-readme-stats 的渲染层代码到 scripts/vendor/github-readme-stats/。
 *
 * 为什么有这个东西：
 *   本仓库的统计卡要「和 github-readme-stats 源码生成的效果一模一样」，
 *   唯一的办法就是用它本人的渲染代码。渲染层是纯函数，不依赖服务器，
 *   因此可以搬到 Node 脚本里直接调用。
 *
 * 用法：
 *   node scripts/vendor-sync.mjs
 *
 * 它做三件事：
 *   1. 下载渲染所需的文件（保持上游目录结构）
 *   2. 把上游依赖的两个 npm 包替换成本地 shim（保持本仓库零依赖）
 *   3. 校验：确认没有任何没被替换掉的「裸模块导入」
 *
 * 注意：scripts/vendor/github-readme-stats/src/shims.js 是本仓库新增的文件，
 *       不在下载列表里，因此不会被覆盖。
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(HERE, 'vendor/github-readme-stats');
const UPSTREAM = 'https://raw.githubusercontent.com/anuraghazra/github-readme-stats/master';

/** 渲染统计卡所需的全部文件（相对上游仓库根目录） */
const FILES = [
  'LICENSE',
  'themes/index.js',
  'src/calculateRank.js',
  'src/translations.js',
  'src/cards/stats.js',
  'src/common/Card.js',
  'src/common/render.js',
  'src/common/color.js',
  'src/common/I18n.js',
  'src/common/fmt.js',
  'src/common/ops.js',
  'src/common/error.js',
  'src/common/icons.js',
  'src/common/html.js',
];

/** 上游用的 npm 包 → 本地 shim */
const PATCHES = [
  {
    file: 'src/common/fmt.js',
    from: 'import wrap from "word-wrap";',
    to: 'import { wrap } from "../shims.js";',
  },
  {
    file: 'src/common/ops.js',
    from: 'import toEmoji from "emoji-name-map";',
    to: 'import { toEmoji } from "../shims.js";',
  },
];

async function fetchText(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      console.log(`    …第 ${attempt} 次失败（${err.message}），重试`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`下载失败（已重试 5 次）：${url}\n  ${lastErr.message}`);
}

async function main() {
  console.log(`下载上游文件 → ${DEST}`);

  let done = 0;
  for (const file of FILES) {
    const text = await fetchText(`${UPSTREAM}/${file}`);
    const out = resolve(DEST, file);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, text, 'utf8');
    console.log(`  ✓ ${file}  (${(text.length / 1024).toFixed(1)} KB)`);
    done += 1;
  }
  console.log(`下载完成：${done}/${FILES.length}`);

  console.log('替换 npm 依赖为本地 shim');
  for (const patch of PATCHES) {
    const path = resolve(DEST, patch.file);
    const src = await readFile(path, 'utf8');
    if (!src.includes(patch.from)) {
      throw new Error(`补丁目标未找到，上游可能已改动：${patch.file}\n  期望内容：${patch.from}`);
    }
    await writeFile(path, src.replace(patch.from, patch.to), 'utf8');
    console.log(`  ✎ ${patch.file}`);
  }

  console.log('校验是否还有裸模块导入');
  const problems = [];
  for (const file of FILES) {
    if (!file.endsWith('.js')) continue;
    const src = await readFile(resolve(DEST, file), 'utf8');
    for (const line of src.split('\n')) {
      const m = line.match(/^\s*import\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/);
      if (m && !m[1].startsWith('.') && !m[1].startsWith('node:')) {
        problems.push(`${file} → ${m[1]}`);
      }
    }
  }

  if (problems.length) {
    console.error('⚠ 仍存在裸模块导入（会导致缺少依赖时报错）：');
    problems.forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }
  console.log('  ✓ 全部 import 都是相对路径或 node: 内置模块');
  console.log('同步结束。');
}

main().catch((err) => {
  console.error('同步失败:', err.message);
  process.exit(1);
});
