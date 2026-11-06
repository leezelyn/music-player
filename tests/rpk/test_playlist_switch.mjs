// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './player_harness.mjs'

async function playing(model) {
  const h = await harness(model)
  await h.page.chooseSong(0)
  await h.page.play()
  for (let i = 0; i < 4; i++) await h.reply()
  assert.equal(h.page.playing, true)
  await h.heartbeat({ sent: 12000 }) // Only one second of a ten-second song.
  return h
}
for (const model of ['10p', '9p', '10']) {
  test(model + ': playlist click switches before the old song finishes', async () => {
    const h = await playing(model)
    h.page.openSongs()
    await h.page.chooseSong(1)
    assert.deepEqual(h.ops(), ['ping', 'player', 'stage', 'start', 'stop'])
    assert.equal(h.page.switching, true)
    assert.equal(h.page.uiScreen, 'home')
    await h.reply() // Acknowledging stop does not confirm the motor has stopped.
    assert.equal(h.requests.length, 5)
    assert.equal(h.page.trackTitle, '歌曲 1')
    await h.heartbeat({ active: false, state: 6, stopping: false })
    assert.equal(h.page.trackTitle, '歌曲 2')
    for (let i = 0; i < 3; i++) await h.reply()
    assert.deepEqual(h.ops(), [
      'ping',
      'player',
      'stage',
      'start',
      'stop',
      'player',
      'stage',
      'start',
    ])
    assert.equal(h.state.source_id, '00000000000000000000000000000002')
    assert.equal(h.page.playing, true)
    assert.equal(h.page.elapsedText, '0:00')
    h.close()
  })
  test(model + ': repeated playlist clicks do not publish competing switches', async () => {
    const h = await playing(model)
    await h.page.chooseSong(1)
    await h.page.chooseSong(2)
    assert.equal(h.ops().filter(op => op === 'stop').length, 1)
    await h.reply()
    await h.heartbeat({ active: false, state: 6, stopping: false })
    for (let i = 0; i < 3; i++) await h.reply()
    assert.equal(h.state.source_id, '00000000000000000000000000000002')
    h.close()
  })
  test(model + ': an unconfirmed stop never starts the requested song', async () => {
    const h = await playing(model)
    await h.page.chooseSong(1)
    await h.reply()
    h.advance(11000)
    await h.heartbeat({ sent: 24000 })
    assert.equal(h.requests.length, 5)
    assert.equal(h.page.switching, false)
    assert.ok(h.page.errorText)
    h.close()
  })
  test(model + ': hidden page cancels the queued switch', async () => {
    const h = await playing(model)
    await h.page.chooseSong(1)
    h.page.onHide()
    await h.reply()
    await h.heartbeat({ active: false, state: 6, stopping: false })
    assert.equal(h.requests.length, 5)
    assert.equal(h.page.switching, false)
    h.close()
  })
  test(model + ': idle playlist selection does not start playback', async () => {
    const h = await harness(model)
    h.page.openSongs()
    await h.page.chooseSong(1)
    assert.equal(h.page.trackTitle, '歌曲 2')
    assert.equal(h.page.uiScreen, 'home')
    assert.deepEqual(h.ops(), [])
    h.close()
  })
  if (model !== '10')
    test(model + ': switching while paused keeps the next song idle', async () => {
      const h = await playing(model)
      await h.heartbeat({ state: 7, active: true })
      h.page.openSongs()
      await h.page.chooseSong(1)
      await h.reply()
      await h.heartbeat({ state: 6, active: false, stopping: false })
      assert.equal(h.page.trackTitle, '歌曲 2')
      assert.equal(h.page.playing, false)
      assert.deepEqual(h.ops(), ['ping', 'player', 'stage', 'start', 'stop'])
      h.close()
    })
}
