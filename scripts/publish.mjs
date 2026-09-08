#!/usr/bin/env node
/**
 * dsh-liuli-ui-enhance 一键发布脚本（master 为唯一发布源）。
 *
 * 流程：校验分支 → 校验工作区 → 构建 → bump 版本 + 打 git tag → 推送 → npm publish。
 *
 * 用法：
 *   node scripts/publish.mjs --bump patch          # 升 patch 并发布（默认）
 *   node scripts/publish.mjs --bump minor
 *   node scripts/publish.mjs --bump major
 *   node scripts/publish.mjs --bump 0.2.0          # 指定精确版本号
 *   node scripts/publish.mjs --bump patch --dry-run  # 只到构建+版本预览，不推送不发布
 *
 * 认证（三选一，脚本不会把 token 写进仓库）：
 *   - 环境变量 NPM_TOKEN=<your token>            （推荐；用于官方 registry）
 *   - --userconfig <path/to/npmrc>               （指向含 _authToken 的临时 npmrc）
 *   - 已通过 npm login 登录（脚本直接调 npm publish）
 *
 * 注意：账号若启用 2FA，请用带 bypass 2fa 权限的 granular token，或提供 --otp。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as joinPath, resolve as resolvePath } from 'node:path'
import process from 'node:process'

const REGISTRY = 'https://registry.npmjs.org'
const ALLOWED_BUMPS = new Set(['patch', 'minor', 'major'])

function parseArgs(argv) {
  const args = {}
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') { args.help = true; continue }
    if (arg === '--dry-run') { dryRun = true; continue }
    if (arg === '--otp') { args.otp = argv[++index]; continue }
    if (arg === '--userconfig') { args.userconfig = argv[++index]; continue }
    if (arg === '--bump') {
      args.bump = argv[++index]
      if (args.bump === undefined) throw new Error('--bump 缺少参数值（patch|minor|major|版本号）')
      continue
    }
    throw new Error(`未知参数：${arg}`)
  }
  return { args, dryRun }
}

/** Windows 下 npm/pnpm 是 .cmd（npm.cmd / pnpm.cmd），execFileSync 直接 spawn 会
 *  EINVAL；node/git 等 .exe 保持原名。 */
const CMD_ONLY = new Set(['npm', 'pnpm'])

/** PowerShell/cmd 参数引号转义：双引号包裹，内部双引号转义。 */
function quote(arg) {
  return `"${String(arg).replaceAll('"', '\\"')}"`
}

/**
 * 统一执行：
 * - node/git 等 .exe：直接 spawn（无 shell，无注入面）。
 * - npm/pnpm（.cmd）：经 cmd.exe /d /s /c 显式启动，逐个参数引号转义，无 shell 拼接歧义。
 * 全程参数均来自本脚本字面量，无用户输入。
 */
function execCMD(cmd, args, opts = {}) {
  const { capture, ...rest } = opts
  const stdio = capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  if (process.platform === 'win32' && CMD_ONLY.has(cmd)) {
    // cmd.exe /d /s /c ""npm.cmd" "arg1" "arg2"" —— 整体用引号包住命令串。
    const command = [quote(`${cmd}.cmd`), ...args.map(quote)].join(' ')
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
      encoding: 'utf8',
      stdio,
      windowsVerbatimArguments: true,
      ...rest,
    })
    if (result.error) throw result.error
    return capture ? (result.stdout ?? '').toString('utf8').trim() : result
  }
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio,
    ...rest,
  })
  if (result.error) throw result.error
  return capture ? (result.stdout ?? '').toString('utf8').trim() : result
}

function run(cmd, args, opts = {}) {
  return execCMD(cmd, args, { capture: true, ...opts })
}

function runLive(cmd, args, opts = {}) {
  execCMD(cmd, args, opts)
}

function log(step) {
  console.log(`\n\x1b[36m[dsh-liuli release]\x1b[0m ${step}`)
}

function fail(message) {
  console.error(`\x1b[31m[dsh-liuli release] 错误：\x1b[0m${message}`)
  process.exit(1)
}

async function main() {
  const { args, dryRun } = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`用法：
  node scripts/publish.mjs [--bump patch|minor|major|<semver>] [--dry-run] [--otp <code>] [--userconfig <npmrc>]

--bump      版本增量（默认 patch），或直接给精确版本号（如 0.2.0）
--dry-run   只执行到「构建 + 版本预览」，不推送、不发布
--otp       两步验证一次性码（账号启用 2FA 时）
--userconfig 指向含 _authToken 的临时 npmrc（认证用）
环境变量 NPM_TOKEN 亦可提供 registry token。`)
    return
  }

  const root = resolvePath(process.cwd())
  const pkgPath = joinPath(root, 'package.json')
  if (!existsSync(pkgPath)) fail('当前目录找不到 package.json，请在仓库根目录运行')

  const pkg = JSON.parse(run('node', ['-e', "console.log(JSON.stringify(require('./package.json')))"]))
  console.log(`当前版本：${pkg.version}`)

  // 1. 校验分支：master 为唯一发布源。
  const branch = run('git', ['branch', '--show-current'])
  if (!dryRun && branch !== 'master') {
    fail(`发布源必须是 master，当前在「${branch}」。请先合并到 master 再从 master 发布。`)
  }
  log(`分支校验通过：${branch}`)

  // 2. 校验工作区干净（发布前不应有未提交改动）。
  const status = run('git', ['status', '--porcelain'])
  if (!dryRun && status !== '') {
    fail('工作区有未提交/未跟踪的改动，请先提交（或 --dry-run 预览）。')
  }
  log('工作区校验通过')

  // 3. 构建（prepare 也会在 publish 时再跑一次，这里确保 lib/ 最新为已提交产物）。
  log('构建中（pnpm build）…')
  runLive('pnpm', ['build'])
  log('构建完成')

  // 4. 计算目标版本。
  const bump = args.bump ?? 'patch'

  // dry-run：只预览下一个版本号，绝不改 package.json，也绝不推送/发布。
  if (dryRun) {
    if (!ALLOWED_BUMPS.has(bump) && !/^\d+\.\d+\.\d+$/.test(bump)) {
      fail(`--bump 只接受 patch|minor|major 或形如 0.2.0 的版本号，收到「${bump}」`)
    }
    const [major, minor, patch] = pkg.version.split('.').map(Number)
    let next
    if (bump === 'major') next = `${major + 1}.0.0`
    else if (bump === 'minor') next = `${major}.${minor + 1}.0`
    else if (bump === 'patch') next = `${major}.${minor}.${patch + 1}`
    else next = bump
    console.log(`当前版本：${pkg.version} → 目标版本：${next}`)
    log('dry-run：到这里为止，未改文件、未推送、未发布。')
    return
  }

  // 实际执行：npm version 只改 package.json，不打 tag（tag 由下方单独打）。
  let targetVersion
  if (ALLOWED_BUMPS.has(bump)) {
    targetVersion = run('npm', ['version', bump, '--no-git-tag-version'])
  } else if (/^\d+\.\d+\.\d+$/.test(bump)) {
    targetVersion = run('npm', ['version', bump, '--no-git-tag-version'])
  } else {
    fail(`--bump 只接受 patch|minor|major 或形如 0.2.0 的版本号，收到「${bump}」`)
  }
  console.log(`目标版本：${targetVersion}`)

  // 5. 提交版本变更 + 打 git tag。
  log('提交版本变更并打 tag…')
  runLive('git', ['add', 'package.json', 'pnpm-lock.yaml'])
  runLive('git', ['commit', '-m', `chore(release): ${targetVersion}`])
  try {
    runLive('git', ['tag', '-a', `v${targetVersion}`, '-m', `release ${targetVersion}`])
  } catch {
    log('tag 可能已存在，跳过创建')
  }
  log('推送 master 与 tag…')
  runLive('git', ['push', 'origin', 'master'])
  runLive('git', ['push', 'origin', `v${targetVersion}`])
  log('推送完成')

  // 6. 发布到 npm。
  log('发布 npm（认证走 NPM_TOKEN / --userconfig）…')
  const publishArgs = ['publish', '--registry', REGISTRY, '--access', 'public']
  let cleanupNpmrc = null
  if (args.otp) publishArgs.push('--otp', args.otp)
  if (args.userconfig) {
    publishArgs.push('--userconfig', args.userconfig)
  } else if (process.env.NPM_TOKEN) {
    // 临时 npmrc（不落进仓库），完事即删。
    const dir = mkdtempSync(joinPath(tmpdir(), 'dshliuli-'))
    const npmrc = joinPath(dir, '.npmrc')
    writeFileSync(npmrc, `registry=${REGISTRY}/\n//${REGISTRY.slice('https://'.length)}/:_authToken=${process.env.NPM_TOKEN}\n`, 'utf8')
    cleanupNpmrc = dir
    publishArgs.push('--userconfig', npmrc)
  }
  try {
    runLive('pnpm', publishArgs, { env: { ...process.env } })
  } finally {
    if (cleanupNpmrc) rmSync(cleanupNpmrc, { recursive: true, force: true })
  }
  log(`\x1b[32m发布成功：${targetVersion}（npm 已更新 dist-tags.latest）\x1b[0m`)
  log('目录市场会自动检测到新版 npm（含 dsh.bundle），无需再发目录 PR。')
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error))
})
