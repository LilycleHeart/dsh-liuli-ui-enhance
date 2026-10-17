import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deepSeekAccountQuota } from '../src/client/deepseek-account-quota.ts'
import {
  initSupplierQuota, setDeepSeekAccountRemote, setSupplierQuotaSession,
  refreshSupplierQuota, getSupplierQuotaSnapshot, disposeSupplierQuota,
} from '../src/client/supplier-quota.ts'

test('account wallets show recharge and bonus separately, including zero and sub-cent balances', () => {
  const result = deepSeekAccountQuota({ status: 'ready', value: [{currency:'CNY',balance:'1.26'}], bonusWallets:[{currency:'CNY',balance:'0.002'}] })
  assert.deepEqual(result.items.map(x => [x.label,x.value]), [['余额','¥ 1.26'],['赠送','¥ <0.01']])
  const zero = deepSeekAccountQuota({status:'ready',value:[{currency:'CNY',balance:'0'}],bonusWallets:[]})
  assert.equal(zero.items[0].value, '¥ 0.00')
})

test('account currencies remain separate and sign-out does not become a zero balance', () => {
  const result=deepSeekAccountQuota({status:'ready',value:[{currency:'CNY',balance:'2'},{currency:'USD',balance:'3'}],bonusWallets:[]})
  assert.equal(result.items[0].value,'¥ 2.00 · $ 3.00')
  assert.deepEqual(deepSeekAccountQuota(null),{kind:'unavailable',provider:'deepseek-account'})
  assert.throws(()=>deepSeekAccountQuota({status:'failed'}),/暂时不可用/)
})

test('selecting an account model reads the account Remote rather than API-key settings, then clears on deselection', async t => {
  t.after(disposeSupplierQuota)
  let current={provider:'deepseek-account',model:'deepseek-v4.1-flash-1017'}
  let calls=0
  const api={llm:{providers:()=>{throw Error('must not read provider credentials')}},settings:{describe:()=>{throw Error('must not read settings')}}}
  const store={getSnapshot:()=>({current}),subscribe:()=>()=>{}}
  initSupplierQuota(api,{directoryFor:()=>({store})})
  setDeepSeekAccountRemote({getBalance:async()=>{calls++;return{ok:true,value:{status:'ready',value:[{currency:'CNY',balance:'1.26'}],bonusWallets:[]}}}})
  setSupplierQuotaSession('test-account-session')
  await refreshSupplierQuota()
  assert.equal(calls,1,'concurrent model publications share the in-flight read')
  assert.equal(getSupplierQuotaSnapshot().data.items[0].value,'¥ 1.26')
  current=null
  await refreshSupplierQuota()
  assert.equal(getSupplierQuotaSnapshot().data,null)
  assert.equal(getSupplierQuotaSnapshot().status,'idle')
})

test('late account results cannot replace the newly selected model', async t => {
  t.after(disposeSupplierQuota)
  let current={provider:'deepseek-account',model:'first'}
  let finish
  initSupplierQuota({}, {directoryFor:()=>({store:{getSnapshot:()=>({current}),subscribe:()=>()=>{}}})})
  setDeepSeekAccountRemote({getBalance:()=>new Promise(resolve=>{finish=resolve})})
  setSupplierQuotaSession('test-late-session')
  const old=refreshSupplierQuota()
  current=null
  await refreshSupplierQuota()
  finish({ok:true,value:{status:'ready',value:[{currency:'CNY',balance:'99'}],bonusWallets:[]}})
  await old
  assert.equal(getSupplierQuotaSnapshot().data,null)
  assert.equal(getSupplierQuotaSnapshot().provider,null)
})
