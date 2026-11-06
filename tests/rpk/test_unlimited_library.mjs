// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { moduleUrl, harness } from './player_harness.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = 'internal://files/'
const tag = 'haptic.music.v1'

for (const model of ['10p', '9p', '10']) {
  test(
    model + ': restores more than ten songs and pages catalog without dropping rows',
    async () => {
      const { createMusicReceiver } = await import(
        moduleUrl(path.join(root, model, 'rpk/src/common/music.js'))
      )
      const songs = Array.from({ length: 137 }, (_, i) => ({
        id: (i + 1).toString(16).padStart(32, '0'),
        title: '歌曲' + i,
        bytes: 12000,
        crc32: i,
        rate: 12000,
        encoding: 's8',
        peak: 64,
      }))
      const mem = { [base + 'music_library.json']: JSON.stringify({ version: 2, items: songs }) }
      let restored = []
      const file = {
        readText: o => (o.uri in mem ? o.success({ text: mem[o.uri] }) : o.fail('missing', 301)),
        get: o => o.success({ length: 12000 }),
        writeArrayBuffer: o => {
          mem[o.uri] = o.buffer
          o.success()
        },
        writeText: o => {
          mem[o.uri] = o.text
          o.success()
        },
        move: o => {
          mem[o.dstUri] = mem[o.srcUri]
          delete mem[o.srcUri]
          o.success()
        },
      }
      const receiver = createMusicReceiver(file, {
        library: rows => {
          restored = rows
        },
      })
      try {
        await receiver.restore()
        assert.equal(restored.length, 137)
        const id = 'f'.repeat(32),
          rows = []
        let offset = 0,
          seq = 0,
          token
        do {
          const reply = await receiver.handle({
            tag,
            id,
            seq: seq++,
            op: 'catalog',
            catalogPageRevision: 1,
            catalogOffset: offset,
            catalogToken: token,
          })
          assert.equal(reply.ok, true, reply.error)
          assert.equal(reply.catalogTotal, 137)
          assert.ok(reply.songs.length <= 20)
          rows.push(...reply.songs)
          token = reply.catalogToken
          offset = reply.catalogNext
        } while (offset !== null)
        assert.deepEqual(
          rows.map(x => x.id),
          songs.map(x => x.id)
        )
        const begin = await receiver.handle({
          tag,
          id: 'e'.repeat(32),
          seq: 0,
          op: 'begin',
          title: '第138首',
          bytes: 12000,
          crc32: 7,
          rate: 12000,
          encoding: 's8',
          peak: 64,
        })
        assert.equal(begin.ok, true, begin.error)
        assert.equal(begin.songCountUnlimited, true)
        assert.equal(JSON.parse(mem[base + 'music_library.json']).items.length, 137)
      } finally {
        receiver.close()
      }
    }
  )
  test(
    model + ': bounded library rows and page navigation preserve absolute song indices',
    async () => {
      const h = await harness(model, 43)
      try {
        assert.equal(h.page.phoneSongCount, 43)
        assert.ok(h.page.songs.length <= 8)
        assert.equal(h.page.libraryPageCount, 6)
        h.page.nextLibraryPage()
        assert.equal(h.page.songs[0].index, 8)
        h.page.previousLibraryPage()
        assert.equal(h.page.songs[0].index, 0)
      } finally {
        h.close()
      }
    }
  )
}

const crc = bytes => {
  let c = 0xffffffff
  for (const v of bytes) {
    c ^= v
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
  }
  return (c ^ 0xffffffff) >>> 0
}
async function storageFixture(model, count = 137) {
  const { createMusicReceiver } = await import(
    moduleUrl(path.join(root, model, 'rpk/src/common/music.js'))
  )
  const data = new Uint8Array([1, 2, 3, 4]),
    songs = Array.from({ length: count }, (_, i) => ({
      id: (i + 1).toString(16).padStart(32, '0'),
      title: '歌' + i,
      bytes: 4,
      crc32: crc(data),
      rate: 12000,
      encoding: 's8',
      peak: 64,
    }))
  const mem = { [base + 'music_library.json']: JSON.stringify({ version: 2, items: songs }) },
    options = {}
  for (const m of songs) mem[base + 'music_' + m.id + '.bin'] = data.slice()
  const file = {
    readText: o => (o.uri in mem ? o.success({ text: mem[o.uri] }) : o.fail('missing', 301)),
    get: o => (o.uri in mem ? o.success({ length: mem[o.uri].length }) : o.fail('missing', 301)),
    writeText: o => {
      mem[o.uri] = o.text
      o.success()
    },
    delete: o => {
      delete mem[o.uri]
      o.success()
    },
    writeArrayBuffer: o => {
      mem[o.uri] = new Uint8Array([...(o.append ? mem[o.uri] : []), ...o.buffer])
      o.success()
    },
    readArrayBuffer: o =>
      o.success({ buffer: mem[o.uri].slice(o.position, o.position + o.length) }),
    move: o => {
      if (options.failPublish && o.dstUri.endsWith('music_library.json')) {
        o.fail('full', 300)
        return
      }
      mem[o.dstUri] = mem[o.srcUri]
      delete mem[o.srcUri]
      o.success()
    },
  }
  const receiver = createMusicReceiver(file)
  await receiver.restore()
  return { receiver, songs, data, mem, options }
}
for (const model of ['10p', '9p', '10']) {
  test(
    model +
      ': 138th song commits without replacing existing songs; failed index publication preserves catalog',
    async () => {
      for (const failPublish of [false, true]) {
        const h = await storageFixture(model)
        try {
          const id = 'e'.repeat(32),
            m = { ...h.songs[0], id, title: '新歌', tag, seq: 0, op: 'begin' }
          assert.equal((await h.receiver.handle(m)).ok, true)
          assert.equal(
            (await h.receiver.handle({ tag, id, op: 'chunk', seq: 1, offset: 0, hex: '01020304' }))
              .ok,
            true
          )
          h.options.failPublish = failPublish
          const reply = await h.receiver.handle({ tag, id, op: 'commit', seq: 2 })
          assert.equal(reply.saved === true, !failPublish, reply.error)
          const stored = JSON.parse(h.mem[base + 'music_library.json']).items
          assert.equal(stored.length, failPublish ? 137 : 138)
          assert.deepEqual(stored.slice(0, 137), h.songs)
        } finally {
          h.receiver.close()
        }
      }
    }
  )
  test(model + ': deleting during paged reading invalidates the old snapshot', async () => {
    const h = await storageFixture(model)
    try {
      const id = 'd'.repeat(32),
        first = await h.receiver.handle({ tag, id, op: 'catalog', seq: 0, catalogPageRevision: 1 })
      await h.receiver.deleteSong(h.songs[0].id)
      const reply = await h.receiver.handle({
        tag,
        id,
        op: 'catalog',
        seq: 1,
        catalogPageRevision: 1,
        catalogOffset: 20,
        catalogToken: first.catalogToken,
      })
      assert.equal(reply.ok, false)
      assert.match(reply.error, /已改变/)
      assert.equal(JSON.parse(h.mem[base + 'music_library.json']).items.length, 136)
    } finally {
      h.receiver.close()
    }
  })
}
for (const model of ['10p', '10'])
  test(model + ': compact reorder supports a long list and repeats safely', async () => {
    const h = await storageFixture(model)
    try {
      const ids = h.songs.map(x => x.id),
        next = ids.slice()
      next.splice(130, 0, next.splice(129, 1)[0])
      const digest = rows => crc(Buffer.from(rows.join(''), 'ascii'))
      const message = {
        tag,
        id: 'c'.repeat(32),
        op: 'reorder',
        seq: 0,
        catalogPageRevision: 1,
        moveRevision: 1,
        moveFrom: 129,
        moveTo: 130,
        moveSongId: ids[129],
        expectedOrderCrc: digest(ids),
        desiredOrderCrc: digest(next),
      }
      for (let i = 0; i < 2; i++) {
        const reply = await h.receiver.handle(message)
        assert.equal(reply.ok, true, reply.error)
        assert.equal(reply.catalogRefresh, true)
        assert.ok(JSON.stringify(reply).length < 1024)
        assert.deepEqual(
          JSON.parse(h.mem[base + 'music_library.json']).items.map(x => x.id),
          next
        )
      }
      const wrong = await h.receiver.handle({
        ...message,
        id: 'b'.repeat(32),
        desiredOrderCrc: 1,
        expectedOrderCrc: 2,
      })
      assert.equal(wrong.ok, false)
      assert.deepEqual(
        JSON.parse(h.mem[base + 'music_library.json']).items.map(x => x.id),
        next
      )
    } finally {
      h.receiver.close()
    }
  })

for (const model of ['10p', '9p', '10'])
  test(model + ': telemetry reuses the visible page while playback progresses', async () => {
    const h = await harness(model, 43)
    try {
      await h.page.play()
      for (let i = 0; i < 4; i++) await h.reply()
      const rows = h.page.songs
      await h.heartbeat({ sent: 12000 })
      assert.equal(h.page.songs, rows)
      assert.equal(h.page.playing, true)
      assert.equal(h.page.phoneSongCount, 43)
    } finally {
      h.close()
    }
  })
