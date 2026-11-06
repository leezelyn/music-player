// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { harness } from './player_harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

for (const model of ['10', '10p', '9p']) {
  test(
    model + ': public player exposes playback controls without hardware research controls',
    async () => {
      const h = await harness(model)
      try {
        assert.equal(typeof h.page.play, 'function')
        assert.equal(typeof h.page.pause, 'function')
        assert.equal(typeof h.page.stop, 'function')
        assert.equal(typeof h.page.uiLicense, 'function')
        h.page.uiLicense()
        assert.equal(h.page.uiScreen, 'reader')
        assert.match(h.page.uiReaderText, /GPL-3\.0-only/)
        const research = Object.keys(h.page).filter(key => /gain|param|envelope|trial/i.test(key))
        assert.deepEqual(research, [])
        const template = fs.readFileSync(
          path.join(root, model, 'rpk/src/pages/index/player.ux'),
          'utf8'
        )
        assert.doesNotMatch(template, /gain|param|envelope|trial/i)
      } finally {
        h.close()
      }
    }
  )
}

test('public source excludes review attachments and device register definitions', () => {
  assert.equal(fs.existsSync(path.join(root, 'review')), false)
  for (const model of ['10', '10p', '9p']) {
    const common = path.join(root, model, 'rpk/src/common')
    for (const name of fs.readdirSync(common)) {
      if (!name.endsWith('.js')) continue
      const source = fs.readFileSync(path.join(common, name), 'utf8')
      assert.doesNotMatch(source, /\b(?:sih|fs|aw|gh)\d{4,5}\b|寄存器|PGA|PWM|FIFO|包络/i, name)
    }
  }
})
