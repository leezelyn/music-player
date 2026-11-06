// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = 'internal://files/'
const models = { '10p': [0x10430012, 16], '9p': [0x91750003, 16], 10: [0x31280019, 19] }
const modules = new Map()
export function moduleUrl(filename) {
  if (modules.has(filename)) return modules.get(filename)
  let source = fs.readFileSync(filename, 'utf8')
  if (filename.endsWith('.json')) source = 'export default ' + source
  else
    source = source.replace(
      /from '(\.\.?\/[^']+)'/g,
      (_, relative) =>
        'from ' + JSON.stringify(moduleUrl(path.resolve(path.dirname(filename), relative)))
    )
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  modules.set(filename, url)
  return url
}
export const drain = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve()
}

// Only the wearable file API, clock and native replies are simulated. The
// controller, presentation, receiver and mailbox bridge are production code.
export async function harness(model, count = 3) {
  const rpk = path.join(root, model, 'rpk')
  const [build, backend] = models[model]
  const songs = Array.from({ length: count }, (_, i) => i + 1).map(n => ({
    id: String(n).padStart(32, '0'),
    title: '歌曲 ' + n,
    bytes: 120000 * (n <= 3 ? n : (n % 3) + 1),
    crc32: 100 + n,
    rate: 12000,
    encoding: 's8',
    peak: 64,
  }))
  const mem = {
    [base + 'music_library.json']: JSON.stringify({
      version: 2,
      items: songs,
      builtinRemoved: true,
    }),
  }
  for (const song of songs) mem[base + 'music_' + song.id + '.bin'] = new Uint8Array(song.bytes)
  const requests = [],
    timersPending = new Map()
  let clock = 1700000000000,
    timerId = 0,
    tick = 0,
    page
  let state = {
    player: true,
    build,
    state: 0,
    error: 0,
    total: 0,
    loaded: 0,
    sent: 0,
    rate: 12000,
    active: false,
    stopping: false,
    pausing: false,
    resuming: false,
    run_id: 0,
    crc32: 0,
    volume_percent: 100,
    source_id: '',
  }
  const timers = {
    now: () => clock,
    setTimeout: (f, ms) => {
      timersPending.set(++timerId, { f, ms })
      return timerId
    },
    clearTimeout: id => timersPending.delete(id),
    setInterval: (f, ms) => {
      timersPending.set(++timerId, { f, ms })
      return timerId
    },
    clearInterval: id => timersPending.delete(id),
  }
  function writeHeartbeat() {
    const session = (mem[base + 'haptic_native_session.txt'] || '').split('\n')[1]
    mem[base + 'haptic_native_heartbeat.json'] = JSON.stringify({
      abi: 1,
      native_revision: 1,
      session,
      tick: ++tick,
      player: state,
    })
  }
  const file = {
    readText: o => (o.uri in mem ? o.success({ text: mem[o.uri] }) : o.fail('missing', 301)),
    writeText: o => {
      mem[o.uri] = o.text
      o.success()
    },
    get: o => (o.uri in mem ? o.success({ length: mem[o.uri].length }) : o.fail('missing', 301)),
    delete: o => {
      delete mem[o.uri]
      o.success()
    },
    move: o => {
      mem[o.dstUri] = mem[o.srcUri]
      delete mem[o.srcUri]
      if (o.dstUri === base + 'haptic_native_request.txt') requests.push(mem[o.dstUri].split('\n'))
      if (o.dstUri === base + 'haptic_native_session.txt') writeHeartbeat()
      o.success()
    },
    readArrayBuffer: o =>
      o.uri in mem
        ? o.success({ buffer: mem[o.uri].slice(o.position, o.position + o.length) })
        : o.fail('missing', 301),
  }
  const connection = { send: o => o.success?.() },
    interconnect = { instance: () => connection }
  const app = {
    terminate() {
      page.onDestroy()
    },
  }
  const common = path.join(rpk, 'src/common')
  const { createPlayer } = await import(moduleUrl(path.join(common, 'player.js')))
  const { createBridge } = await import(moduleUrl(path.join(common, 'bridge.js')))
  const { createMusicReceiver } = await import(moduleUrl(path.join(common, 'music.js')))
  const sample = JSON.parse(fs.readFileSync(path.join(common, 'sample.json')))
  page = createPlayer(file, app, sample, f => createBridge(f, timers.now, timers), timers, {
    interconnect,
    createMusicReceiver,
  })
  Object.assign(page, page.private)
  page.onInit()
  page.onShow()
  await drain()
  async function heartbeat(patch) {
    state = { ...state, ...patch }
    writeHeartbeat()
    await page.refresh()
    await drain()
  }
  async function reply(patch, ok = true) {
    const r = requests.at(-1),
      op = r[3]
    let data
    if (op === 'ping')
      data = {
        pong: true,
        backend_revision: backend,
        native_revision: 1,
        async_player: true,
        max_samples: 3600000,
        stage_stream_revision: 2,
        stage_file_revision: 1,
      }
    else if (op === 'stage') {
      state = {
        ...state,
        state: 2,
        total: Number(r[5]),
        loaded: Number(r[5]),
        sent: 0,
        crc32: Number(r[6]),
        source_id: r[7],
        volume_percent: Number(r[8]),
      }
      data = { error: 0, state: 2, total: state.total, loaded: state.loaded }
    } else {
      if (op === 'start')
        state = {
          ...state,
          active: true,
          state: 3,
          sent: 0,
          stopping: false,
          run_id: state.run_id + 1,
        }
      if (op === 'stop') state = { ...state, stopping: state.active }
      if (op === 'pause') state = { ...state, pausing: true }
      if (op === 'resume') state = { ...state, resuming: true }
      state = { ...state, ...patch }
      data = state
    }
    mem[base + 'haptic_native_result.json'] = JSON.stringify({
      abi: 1,
      native_revision: 1,
      session: r[1],
      seq: Number(r[2]),
      op,
      terminal: true,
      ok,
      error: 'native command -16',
      data,
    })
    await page.refresh()
    await drain()
  }
  return {
    page,
    requests,
    songs,
    heartbeat,
    reply,
    timersPending,
    get state() {
      return state
    },
    ops: () => requests.map(r => r[3]),
    advance: ms => {
      clock += ms
    },
    close: () => page.onDestroy(),
  }
}
