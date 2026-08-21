#!/usr/bin/env node
// 琉璃主题 · DSH Desktop desktop profile 安装器
//
// 作用：解决全新 DSH Desktop 安装后只改 cordis.patch.yml 仍报
//   Cannot find package 'dsh-liuli-ui-enhance'
// 的问题。
//
// 它会：
//   1. 把 dsh-liuli-ui-enhance 写入 ~/.dsh/profiles/desktop/package.json
//      dependencies（默认把当前源码 pack 成 tarball 后以 file: 安装；
//      --from-npm 则写版本号）。
//   2. 确保 ~/.dsh/profiles/desktop/cordis.patch.yml 里注册了 dsh-liuli-ui-enhance。
//   3. 在 profile 目录执行 pnpm install。
//
// 为什么不用 link:：pnpm 对 link: 本地目录不会自动安装插件自身的
// dependencies（如 iconv-lite），全新机器上会报 Cannot find package
// 'iconv-lite'。因此本地安装改为 pnpm pack + file:<tarball>。
//
// 用法：
//   node scripts/install-desktop.mjs                 # 本地源码安装（pack tarball）
//   node scripts/install-desktop.mjs --from-npm      # 从 npm 安装（需已发布）
//   node scripts/install-desktop.mjs --no-install    # 只改配置，不执行 pnpm install
//   DSH_PROFILE_DIR=... node scripts/install-desktop.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const fromNpm = args.includes('--from-npm');
const noInstall = args.includes('--no-install');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const pluginName = 'dsh-liuli-ui-enhance';

const profileDir = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop');
const packagePath = join(profileDir, 'package.json');
const patchPath = join(profileDir, 'cordis.patch.yml');

function pnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function run(command, args, cwd) {
  // Windows 下经 cmd 执行时，参数里的空格会被拆开；这里手动为含空格参数加引号。
  const result = process.platform === 'win32'
    ? spawnSync(`${command} ${args.map((arg) => (arg.includes(' ') ? `"${arg.replaceAll('"', '\\"')}"` : arg)).join(' ')}`, {
        cwd,
        stdio: 'inherit',
        shell: true,
      })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    fail(`${command} ${args.join(' ')} 失败（cwd: ${cwd}）`);
  }
}

/** 查询 npm registry 上已发布的版本；未发布时直接给出可操作的错误。 */
function resolveNpmVersion() {
  const command = pnpmCommand();
  const result = process.platform === 'win32'
    ? spawnSync(`${command} view ${pluginName} version`, {
        cwd: repoRoot,
        stdio: 'pipe',
        shell: true,
        timeout: 30000,
      })
    : spawnSync(command, ['view', pluginName, 'version'], {
        cwd: repoRoot,
        stdio: 'pipe',
        timeout: 30000,
      });
  const version = String(result.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop();
  if (result.error !== undefined || result.status !== 0 || version === undefined) {
    fail(
      `${pluginName} 尚未发布到 npm（npm view 失败：${result.error?.message ?? `exit ${result.status}`}）。`
      + '目前唯一受支持的安装路径是本仓库手动安装：请改用 pnpm install:desktop（本地 tarball）。',
    );
  }
  return `^${version}`;
}

let depValue;
if (fromNpm) {
  depValue = resolveNpmVersion();
} else {
  // 本地源码安装：先 pack 成 tarball，确保插件 dependencies 能装进 profile。
  const packDir = mkdtempSync(join(repoRoot, '.tmp-pack-'));
  run(pnpmCommand(), ['pack', '--pack-destination', packDir], repoRoot);
  const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (tarball === undefined) fail('pnpm pack 未生成 tarball');
  depValue = `file:${join(packDir, tarball).replaceAll('\\', '/')}`;
}

function fail(message) {
  console.error(`[dsh-liuli-ui-enhance] ${message}`);
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
console.log(`[dsh-liuli-ui-enhance] 已写入 ${pluginName}: ${depValue} -> ${packagePath}`);

// 2. 确保 cordis.patch.yml 注册插件
const patchBlock = [
  '',
  '# 琉璃主题插件（由 scripts/install-desktop.mjs 写入）',
  '- insert:',
  '    - id: dsh-liuli-ui-enhance',
  `      name: '${pluginName}'`,
  '',
].join('\n');

if (!existsSync(patchPath)) {
  writeFileSync(patchPath, patchBlock.trimStart());
  console.log(`[dsh-liuli-ui-enhance] 已创建 ${patchPath} 并注册插件`);
} else {
  const patch = readFileSync(patchPath, 'utf8');
  if (patch.includes(`id: dsh-liuli-ui-enhance`) || patch.includes(`name: '${pluginName}'`)) {
    console.log(`[dsh-liuli-ui-enhance] ${patchPath} 已包含插件注册，跳过`);
  } else {
    const lines = patch.split(/\r?\n/);
    const emptyListIndex = lines.findIndex((line) => line.trim() === '[]');
    if (emptyListIndex !== -1) {
      // 全新 profile 默认是 `[]`，直接原位替换为注册块，避免 YAML 双文档/流式与块式混用。
      lines[emptyListIndex] = patchBlock.trim();
      writeFileSync(patchPath, `${lines.join('\n')}\n`);
      console.log(`[dsh-liuli-ui-enhance] 已在 ${patchPath} 写入插件注册（替换空列表）`);
    } else {
      writeFileSync(patchPath, `${patch.trimEnd()}\n${patchBlock}\n`);
      console.log(`[dsh-liuli-ui-enhance] 已在 ${patchPath} 追加插件注册`);
    }
  }
}

// 3. 安装依赖
if (noInstall) {
  console.log('[dsh-liuli-ui-enhance] 已跳过 pnpm install（--no-install）');
  console.log(`[dsh-liuli-ui-enhance] 请手动执行：cd "${profileDir}" && pnpm install`);
} else {
  run(pnpmCommand(), ['install'], profileDir);
  console.log('[dsh-liuli-ui-enhance] 安装完成，可重新启动 DSH Desktop');
}
