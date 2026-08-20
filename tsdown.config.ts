import { clientBundle } from './scripts/tsdown.client.ts'

/**
 * denpa-runtime 引用 src/vendor/material-color-utilities.js（tsc 不会把纯 JS
 * vendor 复制进 lib/types），client 面必须直接从 src 编译入口打包。官方
 * clientBundle 没有 clientEntry 选项，这里复用其完整 client 配置（CSS 内联、
 * purity gate、banner/footer），只覆盖入口。
 */
export default ((env: { env?: { DSH_BUILD_FACE?: string } }) =>
  clientBundle('@deepseek-ai/liuli-theme', ['lib/types/index.js', 'lib/types/invariant.js'])(env)
    .map(config => config.name === '@deepseek-ai/liuli-theme/client'
      ? { ...config, entry: { client: 'src/client/index.ts' } }
      : config))
