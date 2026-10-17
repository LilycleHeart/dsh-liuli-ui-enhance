import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 从一段文本里提取 git commit 号（短哈希，7-40 位 hex）。 */
function extractCommitHashes(raw: string): string[] {
  const hashes: string[] = []
  const push = (hash: string | undefined): void => {
    if (hash !== undefined && /^[0-9a-f]{7,40}$/i.test(hash)) hashes.push(hash.toLowerCase())
  }
  const field = raw.match(/"(?:commitHash|commit_id|sha|hash)"\s*:\s*"([0-9a-f]{7,40})"/i)
  push(field?.[1])
  const commit = raw.match(/\bcommit\s+([0-9a-f]{7,40})/i)
  push(commit?.[1])
  const bracket = raw.match(/\[[^\]]*?\b([0-9a-f]{7,40})\b[^\]]*\]/i)
  push(bracket?.[1])
  const contextual = raw.match(/(?:^|\n)[^\n]*?(?:commit|HEAD|master|main)[^\n]*?\b([0-9a-f]{7,40})\b/i)
  push(contextual?.[1])
  return hashes
}

/** 把工具结果 content 块拼成纯文本，用于提取 commit 号。 */
function contentText(content: readonly { type?: string; text?: string }[] | undefined): string {
  if (content === undefined) return ''
  return content
    .map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('\n')
}

/** 递归收集一个 tool 子树里的 git commit 号。 */
export function collectToolCommits(block: ToolCallBlock, hashes: string[]): void {
  const name = block.name
  const argsRaw = 'kind' in block
    ? block.call?.argsRaw
    : block.phase === 'start' ? block.argsRaw : undefined
  const haystack = `${name ?? ''} ${argsRaw ?? ''}`
  const isGitTool = name?.toLowerCase() === 'git' || /git/i.test(name ?? '')
  const looksLikeCommit = /git commit\b/i.test(haystack)
    || (isGitTool && /"commit"|commit/i.test(argsRaw ?? ''))
  if (looksLikeCommit) hashes.push(...extractCommitHashes(argsRaw ?? ''))
  if ('content' in block && block.content !== undefined) {
    const text = contentText(block.content)
    if (looksLikeCommit || /git commit|commit\b/i.test(text)) {
      hashes.push(...extractCommitHashes(text))
    }
  }
  for (const child of block.subCalls ?? []) collectToolCommits(child, hashes)
}
