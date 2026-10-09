/**
 * 上游 github-readme-stats 依赖的两个 npm 包的本地替身。
 *
 * 目的：保持本仓库「零依赖」——不需要 npm install 就能跑。
 *
 * 为什么可以安全替换：
 *   - word-wrap      只被 src/common/fmt.js 的 wrapTextMultiline 使用
 *   - emoji-name-map 只被 src/common/ops.js 的 emoji 辅助函数使用
 *   统计卡（src/cards/stats.js）的渲染路径不调用这两个函数，
 *   因此对卡片输出没有任何影响。
 *
 * 本文件由 scripts/vendor-sync.mjs 下载上游代码后配合使用，切勿与上游同名文件混淆。
 */

/**
 * 替身：word-wrap —— 按宽度把长文本折行。
 *
 * @param {string} text 待折行文本
 * @param {{width?: number, indent?: string, newline?: string}} [options] 折行选项
 * @returns {string} 折行后的文本
 */
function wrap(text, options = {}) {
  const width = options.width || 80;
  const indent = options.indent || '';
  const newline = options.newline || '\n';

  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);

  return lines.join(newline + indent);
}

/**
 * 替身：emoji-name-map 的默认导出。
 *
 * 用空 Map 顶替：查不到名字时返回 undefined，与上游
 * `toEmoji.get(name) || ""` 的兜底行为一致。统计卡不会走到这里。
 */
const toEmoji = new Map();

export { wrap, toEmoji };
