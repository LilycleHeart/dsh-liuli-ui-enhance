/**
 * 琉璃主题 · 2.0.4 兼容聚合面。
 *
 * DSH 2.0.4（@deepseek-ai 0.1.2-alpha.1）移除了 `@deepseek-ai/dsh-client-runtime`，
 * 其符号拆分到各新包。本模块把插件用到的旧符号按新位置重新导出，让四十余个
 * 源文件的 import 面最小改动：
 *
 * - `defineStore` / `EngineStoreHandle` / `ObservableSnapshot` / `createSnapshotStore`
 *   → `@deepseek-ai/dsh-client-store`
 * - `ClientContext` → cordis `Context`（各 client 面声明合并后等价于旧别名）
 * - `SessionId` → `@deepseek-ai/dsh-api-session-controller/client`
 * - `WorkspaceId` → `@deepseek-ai/dsh-api-workspace-controller/client`
 * - `SessionFace` / `SessionListState` → `@deepseek-ai/dsh-api-session-controller/client`
 * - `ConversationNodeDefinition` / `ConversationLocation` / `ConversationNodeContext`
 *   → `@deepseek-ai/dsh-client-ui-conversation/client`
 * - `isAppendSurfaceEvent` → `@deepseek-ai/dsh-session/surface`（browser-safe 子路径）
 * - 旧 `ConversationSnapshot`（nodes/partial/running 顶层面板）→ `dsh-client-ui-chat/client`
 *   的 `ChatSnapshot`；对话内容在 `ChatSnapshot.legacy.nodes/partial`（兼容投影）。
 *
 * 注意：值导入（isAppendSurfaceEvent）经本模块会内联进插件 bundle——surface
 * 是纯函数层（INLINE_SAFE），无共享运行时身份，内联合法。
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { Context } from '@deepseek-ai/cordis'
import type {
  EngineStoreHandle,
  ObservableSnapshot,
} from '@deepseek-ai/dsh-client-store'
import type {
  SessionFace,
  SessionListState,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export { isAppendSurfaceEvent }
export type {
  EngineStoreHandle,
  ObservableSnapshot,
  SessionFace,
  SessionId,
  SessionListState,
  WorkspaceId,
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
}

/** 各 client 面声明合并后的 cordis Context，等价于旧 ClientContext 别名。 */
export type ClientContext = Context
