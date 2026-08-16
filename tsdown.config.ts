import { clientBundle } from '../tsdown.client.ts'

export default clientBundle('@deepseek-ai/liuli-theme', ['lib/types/index.js', 'lib/types/invariant.js'], {
  // denpa-runtime 引用 src/vendor/material-color-utilities.js（tsc 不会把
  // 纯 JS vendor 复制进 lib/types），client 面必须直接从 src 编译入口打包。
  clientEntry: 'src/client/index.ts',
})
