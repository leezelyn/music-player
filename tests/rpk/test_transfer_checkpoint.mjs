// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moduleUrl } from './player_harness.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
for (const model of ['10p', '10']) {
  const { createMusicReceiver } = await import(
    moduleUrl(path.join(root, model, 'rpk/src/common/music.js'))
  )
  const base = 'internal://files/',
    tag = 'haptic.music.v1',
    id = '1'.repeat(32),
    bytes = Uint8Array.from({ length: 513 }, (_, i) => i % 60)
  const crc = b => {
    let c = 0xffffffff
    for (const v of b) {
      c ^= v
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0)
    }
    return (c ^ 0xffffffff) >>> 0
  }
  const begin = {
    tag,
    id,
    seq: 0,
    op: 'begin',
    title: '恢复测试',
    bytes: bytes.length,
    crc32: crc(bytes),
    rate: 12000,
    encoding: 's8',
    peak: 64,
    resumeRevision: 1,
    transport: { chunkBytes: 256, intervalMs: 0, payloadEncoding: 'base64' },
  }
  const msg = (op, seq, extra = {}) => ({ tag, id, op, seq, ...extra })
  const block = (offset, seq) =>
    msg('chunk', seq, {
      offset,
      data_b64: Buffer.from(bytes.slice(offset, offset + 256)).toString('base64'),
      crc32: crc(bytes.slice(offset, offset + 256)),
    })
  function setup(mem = {}, opts = {}) {
    let held = null
    const writes = [],
      reads = [],
      clock = new Map()
    let n = 0
    const file = {
      readText: o => (o.uri in mem ? o.success({ text: mem[o.uri] }) : o.fail('missing', 301)),
      writeText: o => {
        writes.push('metadata')
        mem[o.uri] = o.text
        o.success()
      },
      get: o => (o.uri in mem ? o.success({ length: mem[o.uri].length }) : o.fail('missing', 301)),
      delete: o => {
        delete mem[o.uri]
        o.success()
      },
      move: o => {
        writes.push('move')
        mem[o.dstUri] = mem[o.srcUri]
        delete mem[o.srcUri]
        o.success()
      },
      readArrayBuffer: o => {
        reads.push([o.position, o.length])
        o.success({ buffer: mem[o.uri].slice(o.position, o.position + o.length) })
      },
      writeArrayBuffer: o => {
        writes.push('audio')
        const finish = () => {
          mem[o.uri] = Uint8Array.from([...(o.append ? mem[o.uri] : []), ...o.buffer])
          o.success()
        }
        if (opts.holdAppend && o.append) held = finish
        else finish()
      },
    }
    const receiver = createMusicReceiver(
      file,
      { diagnostics: () => ({ rpkVersion: 'test' }) },
      {
        setTimeout: (f, ms) => {
          clock.set(++n, { f, ms })
          return n
        },
        clearTimeout: i => clock.delete(i),
      }
    )
    return {
      receiver,
      mem,
      writes,
      reads,
      clock,
      opts,
      release() {
        opts.holdAppend = false
        held?.()
      },
    }
  }
  const ok = async (h, m) => {
    const r = await h.receiver.handle(m)
    assert.equal(r.ok, true, r.error)
    return r
  }
  async function partial() {
    const h = setup()
    await ok(h, begin)
    await ok(h, block(0, 1))
    return h
  }
  async function finish(h) {
    await ok(h, block(256, 2))
    await ok(h, block(512, 3))
    return ok(h, msg('commit', 4))
  }
  test(
    model + ': new receiver resumes confirmed bytes across close without reading whole audio',
    async () => {
      const h = await partial()
      h.receiver.close()
      await Promise.resolve()
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 256)
      assert.equal(ready.nextSeq, 2)
      assert.deepEqual(next.reads, [[0, 256]])
      assert.equal((await finish(next)).saved, true)
      assert.deepEqual(next.mem[base + 'music_' + id + '.bin'], bytes)
      assert.equal(next.mem[base + 'music_pending.json'], undefined)
    }
  )
  test(
    model + ': complete short final block survives restart then receives genuine saved receipt',
    async () => {
      const h = await partial()
      await ok(h, block(256, 2))
      await ok(h, block(512, 3))
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 513)
      assert.equal(ready.nextSeq, 4)
      assert.equal((await ok(next, msg('commit', 4))).saved, true)
      const last = setup(h.mem),
        receipt = await ok(last, begin)
      assert.equal(receipt.saved, true)
      assert.equal(receipt.receipt.verified, true)
      assert.equal(Object.keys(h.mem).filter(x => x.endsWith('.bin')).length, 1)
    }
  )
  test(
    model + ': native append complete before checkpoint recovers only pending block',
    async () => {
      const h = await partial(),
        r = JSON.parse(h.mem[base + 'music_pending.json'])
      r.offset = 256
      r.seq = 2
      r.pending = { bytes: 256, crc32: crc(bytes.slice(256, 512)) }
      h.mem[base + 'music_pending.json'] = JSON.stringify(r)
      h.mem[base + 'music_' + id + '.bin.tmp'] = bytes.slice(0, 512)
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 512)
      assert.equal(ready.nextSeq, 3)
      assert.deepEqual(next.reads, [[256, 256]])
      await ok(next, block(512, 3))
      assert.equal((await ok(next, msg('commit', 4))).saved, true)
    }
  )
  test(
    model + ': partial native append repairs acknowledged prefix with bounded reads',
    async () => {
      const h = await partial(),
        r = JSON.parse(h.mem[base + 'music_pending.json'])
      r.offset = 256
      r.seq = 2
      r.pending = { bytes: 256, crc32: crc(bytes.slice(256, 512)) }
      h.mem[base + 'music_pending.json'] = JSON.stringify(r)
      h.mem[base + 'music_' + id + '.bin.tmp'] = bytes.slice(0, 333)
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 256)
      assert.equal(h.mem[base + 'music_' + id + '.bin.tmp'].length, 256)
      assert.ok(next.reads.every(x => x[1] <= 16384))
      assert.equal((await finish(next)).saved, true)
    }
  )
  test(
    model +
      ': same id different metadata and another pending task are rejected without deleting checkpoint',
    async () => {
      const h = await partial(),
        before = h.mem[base + 'music_pending.json'],
        next = setup(h.mem)
      for (const m of [
        { ...begin, title: 'changed' },
        { ...begin, crc32: 1 },
        { ...begin, id: '2'.repeat(32) },
      ])
        assert.equal((await next.receiver.handle(m)).ok, false)
      assert.equal(h.mem[base + 'music_pending.json'], before)
      assert.equal((await ok(next, begin)).next, 256)
    }
  )
  test(
    model +
      ': idle timeout retains resumable checkpoint and explicit cancel after restart deletes staging',
    async () => {
      const h = await partial()
      for (const timer of [...h.clock.values()]) if (timer.ms === 60000) timer.f()
      assert.ok(h.mem[base + 'music_pending.json'])
      assert.equal(h.receiver.busy, false)
      const next = setup(h.mem),
        ack = await ok(next, msg('cancel', 0))
      assert.equal(ack.cancelled, true)
      assert.equal(h.mem[base + 'music_pending.json'], undefined)
      assert.equal(Object.keys(h.mem).filter(x => x.endsWith('.bin.tmp')).length, 0)
    }
  )
  test(
    model + ': cancel after commit restart does not delete saved audio despite stale checkpoint',
    async () => {
      const h = await partial(),
        stale = h.mem[base + 'music_pending.json']
      await finish(h)
      h.mem[base + 'music_pending.json'] = stale
      const next = setup(h.mem),
        ack = await ok(next, msg('cancel', 0))
      assert.equal(ack.saved, true)
      assert.deepEqual(h.mem[base + 'music_' + id + '.bin'], bytes)
    }
  )
  test(
    model + ': rename delete and reorder are persistent and repeated operation is idempotent',
    async () => {
      const h = await partial()
      await finish(h)
      const rename = msg('rename', 0, {
        id: 'a'.repeat(32),
        songId: id,
        bytes: 513,
        crc32: crc(bytes),
        expectedTitle: begin.title,
        title: '新名称',
      })
      assert.equal((await ok(h, rename)).songs[0].title, '新名称')
      const next = setup(h.mem)
      assert.equal((await ok(next, rename)).songs[0].title, '新名称')
      const order = msg('reorder', 0, { id: 'b'.repeat(32), ids: [id], expectedIds: [id] })
      assert.equal((await ok(next, order)).applied, true)
      const deletion = msg('delete', 0, {
        id: 'c'.repeat(32),
        songId: id,
        bytes: 513,
        crc32: crc(bytes),
      })
      assert.equal((await ok(next, deletion)).songs.length, 0)
      assert.equal((await ok(setup(h.mem), deletion)).deleted, true)
    }
  )
  test(model + ': diagnostics reports hook values only', async () => {
    const h = setup(),
      r = await ok(h, msg('diagnostics', 0))
    assert.deepEqual(r.diagnostics, { rpkVersion: 'test' })
  })

  test(
    model +
      ': late successful append after timeout forces checkpoint recovery before resuming same receiver',
    async () => {
      const h = await partial()
      h.opts.holdAppend = true
      const writing = h.receiver.handle(block(256, 2))
      for (let i = 0; i < 30; i++) await Promise.resolve()
      for (const timer of [...h.clock.values()]) if (timer.ms === 15000) timer.f()
      assert.equal((await writing).unconfirmed, true)
      assert.equal((await h.receiver.handle(begin)).unconfirmed, true)
      h.release()
      for (let i = 0; i < 30; i++) await Promise.resolve()
      const ready = await ok(h, begin)
      assert.equal(ready.next, 512)
      assert.equal(ready.nextSeq, 3)
      await ok(h, block(512, 3))
      assert.equal((await ok(h, msg('commit', 4))).saved, true)
      assert.deepEqual(h.mem[base + 'music_' + id + '.bin'], bytes)
    }
  )

  test(
    model +
      ': nonfinal chunk uses one durable intent and one append; duplicate ACK never appends twice',
    async () => {
      const h = setup()
      await ok(h, begin)
      h.writes.length = 0
      await ok(h, block(0, 1))
      assert.deepEqual(h.writes, ['metadata', 'move', 'audio'])
      const pending = JSON.parse(h.mem[base + 'music_pending.json'])
      assert.equal(pending.offset, 0)
      assert.equal(pending.pending.bytes, 256)
      await ok(h, block(0, 1))
      assert.equal(h.writes.length, 3)
      assert.deepEqual(h.mem[base + 'music_' + id + '.bin.tmp'], bytes.slice(0, 256))
      await ok(h, block(256, 2))
      h.writes.length = 0
      await ok(h, block(512, 3))
      assert.deepEqual(h.writes, ['metadata', 'move', 'audio', 'metadata', 'move'])
      assert.equal(JSON.parse(h.mem[base + 'music_pending.json']).offset, 513)
      h.receiver.close()
    }
  )
  test(
    model + ': corrupted pending block is rolled back and cannot produce a saved receipt',
    async () => {
      const h = await partial()
      h.mem[base + 'music_' + id + '.bin.tmp'][1] ^= 1
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 0)
      assert.equal(ready.nextSeq, 1)
      assert.equal((await next.receiver.handle(msg('commit', 1))).ok, false)
      assert.equal(h.mem[base + 'music_' + id + '.bin'], undefined)
      h.receiver.close()
      next.receiver.close()
    }
  )
  test(
    model +
      ': audio rename before failed catalog publication resumes without losing final short block',
    async () => {
      const h = await partial()
      await ok(h, block(256, 2))
      await ok(h, block(512, 3))
      // Crash after commit renames PCM, before the library points to it.
      h.mem[base + 'music_' + id + '.bin'] = h.mem[base + 'music_' + id + '.bin.tmp']
      delete h.mem[base + 'music_' + id + '.bin.tmp']
      const next = setup(h.mem),
        ready = await ok(next, begin)
      assert.equal(ready.next, 513)
      assert.equal((await ok(next, msg('commit', 4))).saved, true)
      assert.deepEqual(h.mem[base + 'music_' + id + '.bin'], bytes)
      h.receiver.close()
      next.receiver.close()
    }
  )
}
