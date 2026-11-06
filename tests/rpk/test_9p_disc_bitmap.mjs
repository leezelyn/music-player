// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, drain } from './player_harness.mjs'

const angle = page => JSON.parse(page.uiDiscStyle.transform).rotate
const rotationTicks = h => [...h.timersPending.values()].filter(t => t.ms === 100)

for (const cover of ['', 'internal://files/custom-cover.jpg']) {
  test(`9p: ${cover ? 'custom cover' : 'default vinyl'} rotates and retains its phase across pause`, async () => {
    const h = await harness('9p')
    try {
      h.page.onReady()
      await h.page.play()
      for (let i = 0; i < 4; i++) await h.reply()
      h.page.uiDiscCoverUri = cover
      h.page.uiDisc()
      await drain()
      assert.equal(h.page.uiScreen, 'disc')
      assert.equal(rotationTicks(h).length, 1)
      rotationTicks(h)[0].f()
      assert.equal(angle(h.page), '9deg')

      const stale = rotationTicks(h)[0].f
      await h.heartbeat({ state: 7, pausing: false })
      assert.equal(rotationTicks(h).length, 0)
      stale()
      assert.equal(angle(h.page), '9deg')
      await h.heartbeat({ state: 3, resuming: false })
      assert.equal(rotationTicks(h).length, 1)
      rotationTicks(h)[0].f()
      assert.equal(angle(h.page), '18deg')

      h.page.uiHome()
      assert.equal(h.page.uiScreen, 'home')
      assert.equal(rotationTicks(h).length, 0)
      h.page.uiDisc()
      assert.equal(rotationTicks(h).length, 1)
      h.page.onHide()
      assert.equal(rotationTicks(h).length, 0)
      assert.deepEqual(h.ops(), ['ping', 'player', 'stage', 'start'])
    } finally {
      h.close()
    }
  })
}
