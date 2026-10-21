import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateGroupLabel, groupActivities } from '../src/client/activity-grouping.ts'

const at = (day, hour = 12, month = 9, year = 2026) => new Date(year, month, day, hour, 0, 0).getTime()
const NOW = at(21, 22)
const ids = group => group.map(section => section.items.map(item => item.id))

const entry = (id, kind, updatedAt) => ({ id, kind, updatedAt, title: id, cwd: undefined })

test('date groups are named today, yesterday, then the day before, then by date', () => {
  const today = new Date(2026, 9, 21, 9, 0)
  assert.equal(dateGroupLabel(new Date(2026, 9, 21, 1, 0), today), '今天')
  assert.equal(dateGroupLabel(new Date(2026, 9, 20, 23, 59), today), '昨天')
  assert.equal(dateGroupLabel(new Date(2026, 9, 19, 0, 1), today), '前天')
  assert.equal(dateGroupLabel(new Date(2026, 9, 18, 12, 0), today), '10 月 18 日')
  assert.equal(dateGroupLabel(new Date(2025, 11, 31, 12, 0), today), '2025 年 12 月 31 日')
})

test('date labels follow calendar days, not elapsed hours', () => {
  // 23:30 yesterday is "1 hour ago" but still belongs to yesterday's group.
  const late = new Date(2026, 9, 20, 23, 30)
  assert.equal(dateGroupLabel(late, new Date(2026, 9, 21, 0, 30)), '昨天')
})

test('active sessions are pinned above every date group, attention first', () => {
  const groups = groupActivities([
    entry('idle-today', 'idle', at(21, 20)),
    entry('running-yesterday', 'running', at(20, 23)),
    entry('attention-old', 'attention', at(18, 9)),
    entry('idle-yesterday', 'idle', at(20, 10)),
  ], NOW)
  assert.deepEqual(groups.map(group => group.key), ['active', '2026-10-21', '2026-10-20'])
  assert.deepEqual(ids(groups), [['attention-old', 'running-yesterday'], ['idle-today'], ['idle-yesterday']])
})

test('the active block disappears when nothing is running or waiting', () => {
  const groups = groupActivities([
    entry('done', 'completed', at(21, 8)),
    entry('old', 'idle', at(19, 8)),
  ], NOW)
  assert.deepEqual(groups.map(group => group.key), ['2026-10-21', '2026-10-19'])
  assert.deepEqual(groups.map(group => group.label), ['今天', '前天'])
})

test('settled sessions keep newest-first order inside and across day groups', () => {
  const groups = groupActivities([
    entry('older', 'idle', at(19, 8)),
    entry('newest', 'idle', at(21, 21)),
    entry('yesterday', 'idle', at(20, 18)),
    entry('today-morning', 'idle', at(21, 7)),
  ], NOW)
  assert.deepEqual(groups.map(group => group.label), ['今天', '昨天', '前天'])
  assert.deepEqual(ids(groups), [['newest', 'today-morning'], ['yesterday'], ['older']])
})

test('sessions from different years never share a group and keep their year label', () => {
  const groups = groupActivities([
    entry('last-year', 'idle', at(31, 12, 11, 2025)),
    entry('this-year', 'idle', at(2, 12, 0, 2026)),
  ], NOW)
  assert.deepEqual(groups.map(group => group.label), ['1 月 2 日', '2025 年 12 月 31 日'])
})

test('identical timestamps fall back to a stable id order', () => {
  const groups = groupActivities([
    entry('b', 'idle', at(21, 9)),
    entry('a', 'idle', at(21, 9)),
  ], NOW)
  assert.deepEqual(ids(groups), [['a', 'b']])
})
