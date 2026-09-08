# 版本发布与分支约定

本插件的发布遵循一条核心规则：**`beta` 开发，`master` 唯一发布源**。

- `beta`：日常开发分支。新功能在这里改、构建、提交，**不发 npm**。
- `master`：发布分支。只有把 `beta` 合并到 `master` 之后，才从 `master` 发布 npm。
- npm 只从 `master` 上的版本号发布。**市场端（deepseek1024.com / 1024 Store）会自动检测 npm 最新版并更新安装命令，无需为版本号额外提交目录 PR。**

## 一、日常开发（beta）

在 `beta` 上改代码、构建、提交、推送：

```bash
git checkout beta
# ...改代码...
pnpm build                         # 本地构建验证
git add -A && git commit -m "feat: ..."
git push origin beta
```

> `beta` 上不做 `npm version`、不打 `v*` 标签、不 `npm publish`。版本号保持在开发中的递增状态即可，发布时由 `master` 统一 bump。

---

## 二、发布到 npm（master）

当 `beta` 的功能确定要发布时，合并到 `master` 再从 master 发布。

### 方式 A：一键脚本（推荐）

仓库自带 `scripts/publish.mjs`，通过 `pnpm release` 调用。它会校验「当前在 master、工作区干净 → 构建 → bump 版本 + 提交 + 打 tag → 推送 → npm publish」。

```bash
git checkout master
git merge --ff-only beta            # 把 beta 并入 master（ff 或手动合并均可）
git push origin master

# 升 patch 并发布：
pnpm release -- --bump patch
# 或升 minor / major / 指定版本：
pnpm release -- --bump minor
pnpm release -- --bump 0.3.0

# 只预览不发布：
pnpm release -- --bump patch --dry-run
```

> 认证：脚本从环境变量 `NPM_TOKEN` 读取 registry token，或用 `--userconfig <npmrc>` 指向带 `_authToken` 的临时 npmrc；token 不会写进仓库。若账号启用两因素，请使用**带 bypass 2fa 权限的 granular token**，或加 `--otp <code>`。

> 若当前不在 `master` 或工作区不干净，脚本会拒绝执行（`--dry-run` 除外）。

### 方式 B：手动

```bash
git checkout master
git merge --ff-only beta
git push origin master

pnpm build                          # 确保 lib/ 为最新（prepare 也会自动跑）
npm version patch                   # 或 minor / major；改 package.json
git add package.json pnpm-lock.yaml
git commit -m "chore(release): <新版本>"
git tag -a v<新版本> -m "release <新版本>"
git push origin master --follow-tags

# 发布（token 用环境变量或临时 npmrc，避免进仓库）
npm publish --registry=https://registry.npmjs.org --access public
```

---

## 三、市场端自动更新

- 目录仓库的静态校验读取 **npm latest** 的 `dsh.bundle`。
- 只要发布到 npm 的版本声明了 `dsh.bundle.patch`，目录就会展示安装命令
  （`dsh1024 plugin --profile web add dsh-liuli-ui-enhance`）。
- **升级版本无需改目录条目**；只有插件元数据（中英文描述、分类、仓库地址）发生
  变化时才需要更新 `catalog/plugins/lilycleheart--dsh-liuli-ui-enhance.json`，
  此类 PR 由目录维护者人工审核。

## 四、需要注意的点

- **`lib/` 被 `.gitignore`**，但 `npm files` 字段包含它 —— 发布取决于本地构建产物，
  所以发布前务必 `pnpm build` 跑通（`prepare` 脚本已自动执行）。
- **不能覆盖已存在的版本号** —— 每次发布版本号必须严格递增。
- **`npm version` 只用于 master**；在 beta 上执行会让分支版本号与 master 脱节。
- 发布后建议检查官方 registry（`--registry=https://registry.npmjs.org`）确认
  `dist-tags.latest` 已更新；本机若配置了镜像源（`registry.npmmirror.com`）会短时间
  显示旧版本，属镜像缓存滞后。
