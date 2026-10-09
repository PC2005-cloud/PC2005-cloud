#!/usr/bin/env node
/**
 * 生成 GitHub 统计卡片 SVG（浅色 + 深色两版）。
 *
 * 本脚本不做任何自绘：
 *   渲染 → 直接调用上游 github-readme-stats 的 renderStatsCard
 *   取数 → 逐项对齐上游 src/fetchers/stats.js 的口径
 * 因此输出与该项目源码生成的效果一致。
 *
 * 上游代码由 scripts/vendor-sync.mjs 同步到 scripts/vendor/，
 * 两个 npm 依赖已被本地 shim 顶替，本仓库保持零依赖。
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node scripts/gen-stats.mjs       取真实数据并写入 SVG
 *   node scripts/gen-stats.mjs --mock                  用示例数据渲染，验证排版
 *
 * 环境变量：
 *   GITHUB_TOKEN  或 GH_TOKEN   必填（--mock 模式除外）
 *   GITHUB_LOGIN                可选，默认 PC2005-cloud
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderStatsCard } from './vendor/github-readme-stats/src/cards/stats.js';
import { calculateRank } from './vendor/github-readme-stats/src/calculateRank.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CONFIG = {
  login: process.env.GITHUB_LOGIN || 'PC2005-cloud',
  outDir: resolve(ROOT, 'assets/stats'),
};

const MOCK = process.argv.includes('--mock');

/**
 * 渲染选项。
 * include_all_commits=true 时中位数与提交数口径都按「全时段」处理，
 * 与参考卡片使用的参数一致。
 */
const RENDER_OPTIONS = {
  show_icons: true,
  include_all_commits: true,
  hide_border: false,
  hide_rank: false,
  // 上游默认标题是 `{user.name}'s GitHub Stats`，而本账号的 name 字段是空的，
  // 回退到 login 会渲染成 `PC2005-cloud's GitHub Stats`。这里显式指定标题，
  // 与 README 自我介绍里的称呼保持一致。
  custom_title: "Ppc's GitHub Stats",
  // 上游默认宽度是 450 + 图标宽 = 467；这里显式指定 450，
  // 给 README 右侧浮动留出更多空间（该值会被上游 clamp 到 437~500）。
  card_width: 450,
};

/* ------------------------------------------------------------------ */
/* 取数：口径对齐上游 src/fetchers/stats.js                             */
/* ------------------------------------------------------------------ */

async function gql(query, variables, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-stats-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (json.errors) throw new Error(`GraphQL 返回错误: ${JSON.stringify(json.errors)}`);
  return json.data;
}

/** 上游用的查询字段，仅去掉本卡片不需要的可选部分（merged PR / discussions） */
const Q_USER_STATS = `
  query userInfo($login: String!) {
    user(login: $login) {
      name
      login
      reviews: contributionsCollection {
        totalPullRequestReviewContributions
      }
      repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) {
        totalCount
      }
      pullRequests(first: 1) {
        totalCount
      }
      openIssues: issues(states: OPEN) {
        totalCount
      }
      closedIssues: issues(states: CLOSED) {
        totalCount
      }
      followers {
        totalCount
      }
      repositories(first: 100, ownerAffiliations: OWNER, orderBy: {direction: DESC, field: STARGAZERS}) {
        totalCount
        nodes {
          name
          stargazers {
            totalCount
          }
        }
      }
    }
  }
`;

/**
 * 全时段提交数：上游在 include_all_commits=true 时走 REST 搜索接口取 total_count。
 *
 * @param {string} login GitHub 用户名
 * @param {string} token 访问令牌
 * @returns {Promise<number>} 该作者的提交总数
 */
async function fetchAllCommits(login, token) {
  const url = `https://api.github.com/search/commits?q=author:${encodeURIComponent(login)}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'profile-stats-generator',
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`搜索提交数失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.total_count ?? 0;
}

async function collect(token) {
  const { login } = CONFIG;
  const data = await gql(Q_USER_STATS, { login }, token);
  const user = data.user;

  if (user.repositories.totalCount > user.repositories.nodes.length) {
    console.warn(
      `  注意：仓库数 ${user.repositories.totalCount} 超过单页 100，` +
        `star 统计可能偏低（上游会翻页，本脚本暂未实现）`,
    );
  }

  const stats = {
    name: user.name || user.login,
    totalCommits: await fetchAllCommits(login, token),
    totalPRs: user.pullRequests.totalCount,
    totalIssues: user.openIssues.totalCount + user.closedIssues.totalCount,
    totalReviews: user.reviews.totalPullRequestReviewContributions,
    contributedTo: user.repositoriesContributedTo.totalCount,
    totalStars: user.repositories.nodes.reduce((sum, n) => sum + n.stargazers.totalCount, 0),
  };

  stats.rank = calculateRank({
    all_commits: true,
    commits: stats.totalCommits,
    prs: stats.totalPRs,
    reviews: stats.totalReviews,
    issues: stats.totalIssues,
    repos: user.repositories.totalCount,
    stars: stats.totalStars,
    followers: user.followers.totalCount,
  });

  return stats;
}

/** --mock 用的示例数据，字段形状与真实取数一致 */
function mockStats() {
  const stats = {
    // 与真实取数路径的 `user.name || user.login` 结果保持一致（本账号 name 为空）
    name: 'PC2005-cloud',
    totalStars: 1172,
    totalCommits: 2341,
    totalPRs: 44,
    totalIssues: 4,
    totalReviews: 0,
    contributedTo: 8,
  };
  stats.rank = calculateRank({
    all_commits: true,
    commits: stats.totalCommits,
    prs: stats.totalPRs,
    reviews: stats.totalReviews,
    issues: stats.totalIssues,
    repos: 7,
    stars: stats.totalStars,
    followers: 8,
  });
  return stats;
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  let stats;
  if (MOCK) {
    stats = mockStats();
    console.log('[mock] 使用示例数据，未请求 GitHub API');
  } else {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      console.error('错误：缺少 GITHUB_TOKEN（或 GH_TOKEN）。想预览排版请加 --mock。');
      process.exit(1);
    }
    console.log(`取数中，账号 ${CONFIG.login}`);
    stats = await collect(token);
  }

  console.log('统计结果：', stats);
  console.log(
    `等级：${stats.rank.level}  百分位 ${stats.rank.percentile.toFixed(2)}` +
      `  （环填充 ${(100 - stats.rank.percentile).toFixed(1)}%）`,
  );

  await mkdir(CONFIG.outDir, { recursive: true });
  const themes = [
    ['light', 'default'],
    ['dark', 'dark'],
  ];
  for (const [file, theme] of themes) {
    const svg = renderStatsCard(stats, { ...RENDER_OPTIONS, theme });
    const out = resolve(CONFIG.outDir, `stats-${file}.svg`);
    await writeFile(out, svg, 'utf8');
    console.log(`已写入 ${out}  (${(svg.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error('生成失败:', err.message);
  process.exit(1);
});
