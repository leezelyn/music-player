// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// Xiaomi Vela JS adapter. Native rendering runs on the module's UI loop.
export const transitionEffects = {
  enter: 'enter',
  forward: 'forward',
  back: 'back',
  spring: 'spring',
  shrink: 'shrink',
}
const wireEffects = { enter: 0, forward: 1, back: 2, spring: 4, shrink: 9 }
const BUILD = 0x10433a01,
  STATUS = 0x31535441
const signed = n => (n >= 0x80000000 ? n - 0x100000000 : n)
function failure(message, properties = {}) {
  return Object.assign(new Error(message), properties)
}
export function decodeTransitionStatus(value, packageName) {
  if (
    !value ||
    value.abi !== 1 ||
    value.build !== BUILD ||
    value.package !== packageName ||
    !Array.isArray(value.words) ||
    value.words.length !== 32
  )
    throw failure('转场模块版本或应用身份不符')
  const w = value.words
  if (
    w.some(n => !Number.isInteger(n) || n < 0 || n > 0xffffffff) ||
    w[0] !== STATUS ||
    w[1] !== 1 ||
    w[2] !== BUILD ||
    w[3] !== 256 ||
    w[9] > 7 ||
    w[8] > 1 ||
    w[11] > 1 ||
    w[25] > 255 ||
    w[14] > 2 ||
    !Number.isInteger(value.request) ||
    !Number.isInteger(value.write) ||
    value.write > 192 ||
    value.write < -4096
  )
    throw failure('转场回执字段无效')
  return {
    sequence: w[4],
    error: signed(w[5]),
    launches: w[6],
    bound: w[7] === 1,
    active: w[8] === 1,
    phase: w[9],
    generation: w[10],
    pending: w[11],
    started: w[12],
    ended: w[13],
    readyCount: w[14],
    content: w[15] === 1,
    source: w[16] === 1,
    commandError: signed(w[21]),
    expected: w[25],
    processed: w[26],
    binding: w[27],
    nonce: w[28],
    operation: w[29],
    effect: w[30],
    request: value.request,
    write: value.write,
    package: packageName,
  }
}
export function createNativeTransitions(file, options = {}) {
  const packageName = options.packageName,
    clock = options.now || (() => Date.now())
  if (
    typeof packageName !== 'string' ||
    packageName.length > 96 ||
    !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)
  )
    throw failure('应用包名无效')
  const timers = options.timers || {},
    later = timers.setTimeout || setTimeout,
    clear = timers.clearTimeout || clearTimeout
  const every = timers.setInterval || setInterval,
    clearEvery = timers.clearInterval || clearInterval
  const timeout = options.timeoutMs || 8000,
    poll = options.pollMs || 100
  const nonce = options.nonce || 1 + Math.floor(Math.random() * 0x7ffffffe)
  if (!Number.isInteger(nonce) || nonce < 1 || nonce > 0x7fffffff) throw failure('会话编号无效')
  let connected = false,
    closed = false,
    rpcBusy = false,
    transactionBusy = false,
    binding = 0,
    epoch = 0,
    token = 0,
    heartbeat = null,
    inflight = null,
    connecting = null,
    cancelling = null,
    exitDetached = false
  let lastReceipt = null
  let lastIssued = 0
  const sleep = ms => new Promise(resolve => later(resolve, ms))
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clear(timer)
        error ? reject(error) : resolve(value)
      }
      const timer = later(() => finish(failure('文件回调未确认', { unconfirmed: true })), 1200)
      try {
        if (!file || typeof file[method] !== 'function')
          throw failure('文件 API 不可用', { noSideEffects: true })
        file[method](
          Object.assign({}, args, {
            success: value => finish(null, value),
            fail: (value, code) => finish(failure(method + '：' + code + ' ' + String(value))),
          })
        )
      } catch (e) {
        finish(e)
      }
    })
  async function read() {
    const result = await call('readText', { uri: 'internal://files/native_transition_status.json' })
    let value
    try {
      value = JSON.parse(result.text)
    } catch (e) {
      throw failure('转场回执 JSON 无效')
    }
    const status = decodeTransitionStatus(value, packageName)
    lastReceipt = status
    return status
  }
  async function initialStatus(allowClosed = false) {
    const deadline = clock() + timeout
    while (clock() < deadline) {
      if (closed && !allowClosed)
        throw failure('转场客户端已关闭', { cancelled: true, noSideEffects: true })
      try {
        const s = await read()
        if (s.bound) return s
      } catch (e) {
        if (e.cancelled) throw e
      }
      await sleep(poll)
    }
    throw failure('转场模块未连接，请先加载配套 FACE', { noSideEffects: true })
  }
  async function rpc(op, style = 0, generation = 0, allowClosed = false) {
    if (rpcBusy) throw failure('上一条模块请求尚未结束', { noSideEffects: true })
    if (closed && !allowClosed)
      throw failure('转场客户端已关闭', { cancelled: true, noSideEffects: true })
    rpcBusy = true
    let published = false
    const work = (async () => {
      let before = await initialStatus(allowClosed)
      if (op === 6 && before.active && before.nonce !== nonce) {
        const idleDeadline = clock() + timeout
        while (before.active && clock() < idleDeadline) {
          await sleep(poll)
          before = await read()
        }
        if (before.active) throw failure('前一段转场尚未收尾', { noSideEffects: true })
      }
      if (binding && before.binding !== binding)
        throw failure('模块已重新绑定，请重新连接', { noSideEffects: true })
      if ((op === 3 || op === 7) && before.active)
        throw failure('转场模块忙', { noSideEffects: true })
      if (Math.max(before.sequence, lastIssued) >= 0x7fffffff)
        throw failure('模块序号已满，请重启', { noSideEffects: true })
      const seq = Math.max(before.sequence, lastIssued) + 1,
        expires = Math.floor(clock() / 1000) + 6
      lastIssued = seq
      const fields = [
        'ATR1',
        BUILD,
        seq,
        op,
        style,
        generation,
        options.pivotX === undefined ? 168 : options.pivotX,
        options.pivotY === undefined ? 240 : options.pivotY,
        nonce,
        expires,
        'END',
        '',
      ]
      const uri = 'internal://files/native_transition_' + (op === 2 ? 'cancel' : 'request') + '.txt'
      const temporary = uri + '.' + nonce + '.' + seq + '.tmp'
      await call('writeText', { uri: temporary, text: fields.join('\n'), append: false })
      if (closed && !allowClosed)
        throw failure('请求发布前客户端已关闭', { cancelled: true, noSideEffects: true })
      published = true // move may succeed even when its callback fails; never resend.
      await call('move', { srcUri: temporary, dstUri: uri })
      const deadline = clock() + timeout
      while (clock() < deadline) {
        let s
        try {
          s = await read()
        } catch (e) {
          await sleep(poll)
          continue
        }
        if (s.binding !== before.binding)
          throw failure('转场期间模块重新绑定', { unconfirmed: true })
        if (s.request === seq && s.write < 0)
          throw failure('模块未接收请求：' + s.write, { noSideEffects: true, receipt: s })
        if (s.processed === seq) {
          if (s.commandError)
            throw failure('模块拒绝请求：' + s.commandError, {
              noSideEffects: op === 3 || op === 7,
              receipt: s,
            })
          if (op !== 2 && s.nonce !== nonce)
            throw failure('模块会话不符', { unconfirmed: true, receipt: s })
          if (op === 6) return s
          if ((op === 3 || op === 7) && s.phase === 7 && !s.pending) {
            token = s.generation
            return s
          }
          if (op === 8 && s.phase === 2 && !s.pending && s.source) return s
          if (op === 2 && !s.active) return s
          if (s.phase === 6) {
            if (s.error) throw failure('转场未完成：' + s.error, { receipt: s, cleaned: true })
            if (
              op === 4 &&
              s.started === s.expected &&
              s.ended === s.expected &&
              s.readyCount === 2 &&
              s.content &&
              s.source
            )
              return s
            throw failure('转场完成回执不完整', { receipt: s, cleaned: true })
          }
        }
        await sleep(poll)
      }
      throw failure('转场回执未确认；不会自动重试', { unconfirmed: true })
    })()
    inflight = work
    try {
      return await work
    } catch (e) {
      if (published && !e.noSideEffects && !e.cleaned) e.unconfirmed = true
      throw e
    } finally {
      rpcBusy = false
      if (inflight === work) inflight = null
    }
  }
  function stopHeartbeat() {
    if (heartbeat !== null) clearEvery(heartbeat)
    heartbeat = null
  }
  function startHeartbeat() {
    const owner = epoch
    stopHeartbeat()
    heartbeat = every(() => {
      if (closed || owner !== epoch || !connected || transactionBusy || rpcBusy) return
      rpc(6).catch(() => {
        if (owner === epoch) {
          connected = false
          stopHeartbeat()
        }
      })
    }, 10000)
  }
  async function connect() {
    const owner = epoch
    if (cancelling) await cancelling // Revoke the previous session before registering again.
    if (owner !== epoch) throw failure('页面已经离开', { cancelled: true })
    if (exitDetached) throw failure('退出已交接给模块', { cancelled: true })
    if (closed) throw failure('转场客户端已关闭', { noSideEffects: true })
    if (connected) return lastReceipt
    if (connecting) return connecting
    const work = rpc(6).then(s => {
      if (closed || owner !== epoch) throw failure('页面已经离开', { cancelled: true })
      binding = s.binding
      connected = true
      startHeartbeat()
      return s
    })
    connecting = work
    try {
      return await work
    } finally {
      if (connecting === work) connecting = null
    }
  }
  function cancel() {
    ++epoch
    connected = false
    exitDetached = false
    stopHeartbeat()
    if (cancelling) return cancelling
    const work = (async () => {
      const running = inflight
      if (running)
        try {
          await running
        } catch (e) {}
      let current
      try {
        current = await read()
      } catch (e) {
        return null
      }
      if (current.nonce !== nonce) {
        // A lost cancellation callback can be resolved by a later published terminal status.
        // Require this binding and consumption through every issued request, never just active=0.
        if (
          !current.active &&
          binding &&
          current.binding === binding &&
          current.processed >= lastIssued
        )
          return Object.assign({ cancelConfirmed: true }, current)
        return current
      }
      return rpc(2, 0, 0, true).then(s => Object.assign({ cancelConfirmed: true }, s)) // revoke nonce, prove own cleanup.
    })()
    const settled = work.finally(() => {
      connected = false
      stopHeartbeat()
      if (cancelling === settled) cancelling = null
    })
    cancelling = settled
    return settled
  }
  async function transition(config) {
    if (exitDetached) throw failure('退出已交接给模块', { cancelled: true })
    if (transactionBusy) throw failure('上一段转场尚未结束', { noSideEffects: true })
    if (!config || typeof config.apply !== 'function')
      throw failure('需要提供内容切换函数', { noSideEffects: true })
    if (
      typeof config.effect === 'number' &&
      (!Number.isInteger(config.effect) || config.effect < 0 || config.effect > 12)
    )
      throw failure('转场效果无效', { noSideEffects: true })
    let style =
      typeof config.effect === 'number'
        ? config.effect + 1
        : wireEffects[config.effect || 'forward']
    if (!Number.isInteger(style) || style < 0 || style > 13)
      throw failure('转场效果无效', { noSideEffects: true })
    const owner = epoch
    transactionBusy = true
    let attempted = false,
      completed = false,
      applied = false,
      problem = null
    try {
      await connect()
      if (closed || owner !== epoch)
        throw failure('页面已经离开', { cancelled: true, noSideEffects: true })
      attempted = true
      const s = await rpc(3, style)
      token = s.generation
      if (closed || owner !== epoch) throw failure('页面已经离开', { cancelled: true })
      applied = true
      await config.apply()
      if (typeof config.ready === 'function') await config.ready()
      if (closed || owner !== epoch) throw failure('页面已经离开', { cancelled: true })
      const result = await rpc(4, 0, token)
      completed = true
      token = 0
      return result
    } catch (e) {
      problem = e
      e.applied = applied
      throw e
    } finally {
      if (attempted && !completed)
        try {
          const r = await cancel()
          if (problem && r && r.cancelConfirmed) problem.cleaned = true
        } catch (e) {}
      transactionBusy = false
    }
  }
  async function exit(config) {
    if (exitDetached) throw failure('退出已交接给模块', { cancelled: true })
    if (transactionBusy) throw failure('上一段转场尚未结束', { noSideEffects: true })
    if (!config || typeof config.apply !== 'function')
      throw failure('需要提供退出函数', { noSideEffects: true })
    const owner = epoch
    transactionBusy = true
    let attempted = false,
      completed = false,
      applied = false,
      problem = null
    try {
      await connect()
      if (closed || owner !== epoch)
        throw failure('页面已经离开', { cancelled: true, noSideEffects: true })
      attempted = true
      const prepared = await rpc(7, 14)
      token = prepared.generation
      if (closed || owner !== epoch) throw failure('页面已经离开', { cancelled: true })
      const handed = await rpc(8, 0, token)
      if (closed || owner !== epoch) throw failure('页面已经离开', { cancelled: true })
      // Ownership transfers BEFORE apply: synchronous onHide/onDestroy must not cancel it.
      exitDetached = true
      connected = false
      stopHeartbeat()
      applied = true
      await config.apply()
      completed = true
      token = 0
      return Object.assign({ handedOff: true }, handed)
    } catch (e) {
      problem = e
      exitDetached = false
      e.applied = applied
      throw e
    } finally {
      if (attempted && !completed)
        try {
          const r = await cancel()
          if (problem && r && r.cancelConfirmed) problem.cleaned = true
        } catch (e) {}
      transactionBusy = false
    }
  }
  function suspend() {
    epoch++
    connected = false
    stopHeartbeat()
    return exitDetached ? Promise.resolve(lastReceipt) : cancel()
  }
  function dispose() {
    closed = true
    return suspend()
  }
  return {
    connect,
    transition,
    exit,
    cancel,
    suspend,
    dispose,
    status: read,
    get ready() {
      return connected && !closed
    },
    get busy() {
      return transactionBusy || rpcBusy
    },
    get receipt() {
      return lastReceipt
    },
  }
}
