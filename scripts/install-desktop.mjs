#!/usr/bin/env node
// 琉璃主题 · DSH Desktop desktop profile 安装器
//
// 作用：解决全新 DSH Desktop 安装后只改 cordis.patch.yml 仍报
//   Cannot find package '@deepseek-ai/liuli-theme'
// 的问题。
//
// 它会：
//   1. 把 @deepseek-ai/liuli-theme 写入 ~/.dsh/profiles/desktop/package.json
//      dependencies（默认 link 到当前源码目录；--from-npm 则写版本号）。
//   2. 确保 ~/.dsh/profiles/desktop/cordis.patch.yml 里注册了 liuli-theme。
//   3. 在 profile 目录执行 pnpm install。
//
// 用法：
//   node scripts/install-desktop.mjs                 # 本地源码安装（link）
//   node scripts/install-desktop.mjs --from-npm      # 从 npm 安装（需已发布）
//   node scripts/install-desktop.mjs --no-install    # 只改配置，不执行 pnpm install
//   DSH_PROFILE_DIR=... node scripts/install-desktop.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fromNpm = args.includes('--from-npm');
const noInstall = args.includes('--no-install');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const pluginName = '@deepseek-ai/liuli-theme';

const profileDir = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop');
const packagePath = join(profileDir, 'package.json');
const patchPath = join(profileDir, 'cordis.patch.yml');

const depValue = fromNpm
  ? `^${repoPkg.version}`
  : `link:${repoRoot.replaceAll('\\', '/')}`;

function fail(message) {
  console.error(`[liuli-theme] ${message}`);
  process.exit(1);
}

if (!existsSync(profileDir)) {
  fail(`找不到 DSH Desktop profile 目录：${profileDir}`);
}
if (!existsSync(packagePath)) {
  fail(`找不到 profile package.json：${packagePath}`);
}

// 1. 声明插件依赖
const profilePkg = JSON.parse(readFileSync(packagePath, 'utf8'));
profilePkg.dependencies ??= {};
profilePkg.dependencies[pluginName] = depValue;
writeFileSync(packagePath, `${JSON.stringify(profilePkg, null, 2)}\n`);
console.log(`[liuli-theme] 已写入 ${pluginName}: ${depValue} -> ${packagePath}`);

// 2. 确保 cordis.patch.yml 注册插件
const patchBlock = [
  '',
  '# 琉璃主题插件（由 scripts/install-desktop.mjs 写入）',
  '- insert:',
  '    - id: liuli-theme',
  `      name: '${pluginName}'`,
  '',
].join('\n');

if (!existsSync(patchPath)) {
  writeFileSync(patchPath, patchBlock.trimStart());
  console.log(`[liuli-theme] 已创建 ${patchPath} 并注册插件`);
} else {
  const patch = readFileSync(patchPath, 'utf8');
  if (patch.includes(`id: liuli-theme`) || patch.includes(`name: '${pluginName}'`)) {
    console.log(`[liuli-theme] ${patchPath} 已包含插件注册，跳过`);
  } else {
    writeFileSync(patchPath, `${patch.trimEnd()}\n${patchBlock}\n`);
    console.log(`[liuli-theme] 已在 ${patchPath} 追加插件注册`);
  }
}

// 3. 安装依赖
if (noInstall) {
  console.log('[liuli-theme] 已跳过 pnpm install（--no-install）');
  console.log(`[liuli-theme] 请手动执行：cd "${profileDir}" && pnpm install`);
} else {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpm, ['install'], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) {
    fail(`pnpm install 失败，请手动执行：cd "${profileDir}" && pnpm install`);
  }
  console.log('[liuli-theme] 安装完成，可重新启动 DSH Desktop');
}
