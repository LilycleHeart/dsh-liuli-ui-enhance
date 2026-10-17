import type { SupplierQuotaData } from './supplier-quota.ts'

interface Wallet { currency: string; balance: string }
export type AccountBalanceOutcome =
  | { status: 'ready'; value: readonly Wallet[]; bonusWallets: readonly Wallet[] }
  | { status: 'failed' }
  | null

/** Account auth stays in the Host; this is the same safe wallet view as Settings. */
export interface DeepSeekAccountQuotaRemote {
  getBalance(): Promise<{ ok: boolean; value?: AccountBalanceOutcome; error?: { message?: string } }>
}

function walletsText(wallets: readonly Wallet[]): string {
  return wallets.filter(wallet => Number.isFinite(Number(wallet.balance))).map(wallet => {
    const amount = Number(wallet.balance)
    const text = amount > 0 && amount < 0.01 ? '<0.01' : amount.toFixed(2)
    return `${wallet.currency === 'CNY' ? '¥' : wallet.currency === 'USD' ? '$' : wallet.currency} ${text}`
  }).join(' · ')
}

/** Keep recharge and bonus wallets separate, matching the official account view. */
export function deepSeekAccountQuota(outcome: AccountBalanceOutcome): SupplierQuotaData {
  const provider = 'deepseek-account'
  if (outcome === null) return { kind: 'unavailable', provider }
  if (outcome.status !== 'ready') throw new Error('DeepSeek 账号余额暂时不可用')
  const balance = walletsText(outcome.value)
  const bonus = walletsText(outcome.bonusWallets.filter(wallet => Number(wallet.balance) > 0))
  if (!balance && !bonus) return { kind: 'unavailable', provider }
  return {
    kind: 'package', provider, title: 'DeepSeek 账号余额（充值与赠送分别显示）',
    items: [
      ...(balance ? [{ key: 'credits' as const, label: '余额', value: balance }] : []),
      ...(bonus ? [{ key: 'bonus' as const, label: '赠送', value: bonus }] : []),
    ],
  }
}
