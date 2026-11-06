// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// Dependency injection permits host tests with the same code used in the RPK.
export function createBridge(file, now = () => Date.now(), timers = {}) {
  const base = 'internal://files/'
  const nativeOps = [
    'ping',
    'load',
    'stage',
    'start',
    'pause',
    'resume',
    'stop',
    'player',
    'status',
    'clear',
  ]
  const prefix = op => (nativeOps.includes(op) ? 'haptic_native_' : 'haptic_')
  const later = timers.setTimeout || setTimeout,
    cancelLater = timers.clearTimeout || clearTimeout
  const session = now().toString(16) + '_' + Math.floor(Math.random() * 0xffffffff).toString(16)
  let sessionExpires = 0,
    nativeExpires = 0,
    renewing = null
  let sequence = 0,
    pending = null,
    pollBusy = false,
    initialized = false,
    sending = false
  let closed = false,
    closePromise = null
  const active = []
  const diagnostics = {
    session: '尚未创建',
    tx: '尚未发送请求',
    heartbeat: '尚未读取',
    result: '尚未读取',
    error: '',
  }
  function message(e) {
    return String((e && e.message) || e)
  }
  function track(p) {
    active.push(p)
    const remove = () => {
      const i = active.indexOf(p)
      if (i >= 0) active.splice(i, 1)
    }
    p.then(remove, remove)
    return p
  }
  const call = (method, args, timeoutMs = 5000) =>
    new Promise((resolve, reject) => {
      let settled = false
      const uri = args.uri || args.dstUri
      const finish = (error, value) => {
        if (settled) return
        settled = true
        cancelLater(timeout)
        if (error) reject(error)
        else resolve(value)
      }
      const timeout = later(() => {
        const e = new Error(
          method + ' ' + uri + '：' + timeoutMs / 1000 + ' 秒未收到文件回调；结果未确认'
        )
        e.unconfirmed = true
        finish(e)
      }, timeoutMs)
      try {
        if (!file || typeof file[method] !== 'function')
          throw new Error('文件 API 不可用：' + method)
        file[method](
          Object.assign({}, args, {
            success: value => finish(null, value),
            fail: (data, code) =>
              finish(
                new Error(
                  method +
                    ' ' +
                    uri +
                    ': ' +
                    code +
                    ' ' +
                    (typeof data === 'object' ? JSON.stringify(data) : String(data))
                )
              ),
          })
        )
      } catch (e) {
        finish(e)
      }
    })
  const read = (name, timeoutMs = 5000) =>
    call(
      'readText',
      {
        uri: base + name,
      },
      timeoutMs
    ).then(r => {
      try {
        return JSON.parse(r.text)
      } catch (e) {
        throw new Error(name + '：JSON 无效 · ' + message(e))
      }
    })
  const atomic = (name, text, allowClosed = false) =>
    call('writeText', {
      uri: base + name + '.tmp',
      text,
      append: false,
    }).then(() => {
      if (closed && !allowClosed) throw new Error('应用已退出，停止发布请求')
      return call('move', {
        srcUri: base + name + '.tmp',
        dstUri: base + name,
      })
    })
  function writeLease(expires, allowClosed = false) {
    const shortLease = expires ? Math.min(expires, Math.floor(now() / 1000) + 15) : 0
    return atomic(
      'haptic_native_session.txt',
      'HBR1\n' + session + '\n' + shortLease + '\nEND\n',
      allowClosed
    ).then(() => {
      nativeExpires = shortLease
    })
  }
  function waitNative(attempt = 0, deadline = now() + 3500) {
    requireOpen()
    return read('haptic_native_heartbeat.json', 1000).then(
      h => {
        requireOpen()
        if (!h || h.abi !== 1 || h.native_revision !== 1) diagnostics.heartbeat = '心跳版本不匹配'
        else if (h.session !== session) diagnostics.heartbeat = '心跳会话不匹配'
        else if (!h.player || h.player.build !== 0x91750003 || typeof h.tick !== 'number')
          diagnostics.heartbeat = '心跳原生构建号或计数不匹配'
        else {
          diagnostics.heartbeat = '匹配本会话 · tick ' + h.tick
          return
        }
        if (attempt >= 12 || now() >= deadline)
          throw new Error('9 Pro 原生服务未连接：' + diagnostics.heartbeat)
        return new Promise(resolve => later(resolve, 250)).then(() =>
          waitNative(attempt + 1, deadline)
        )
      },
      e => {
        requireOpen()
        diagnostics.heartbeat = '心跳读取失败：' + message(e)
        if (attempt >= 12 || now() >= deadline)
          throw new Error('9 Pro 原生服务未连接：' + diagnostics.heartbeat)
        return new Promise(resolve => later(resolve, 250)).then(() =>
          waitNative(attempt + 1, deadline)
        )
      }
    )
  }
  function renewLease() {
    if (renewing) return renewing
    if (
      sessionExpires >= Math.floor(now() / 1000) + 360 &&
      nativeExpires >= Math.floor(now() / 1000) + 5
    )
      return Promise.resolve()
    const expires = Math.floor(now() / 1000) + 600
    renewing = track(
      writeLease(expires).then(() => {
        sessionExpires = expires
      })
    ).then(
      () => {
        renewing = null
      },
      e => {
        renewing = null
        throw e
      }
    )
    return renewing
  }
  function requireOpen() {
    if (closed) throw new Error('应用已退出')
  }
  function prepareSample(sample) {
    requireOpen()
    if (
      !sample ||
      !Number.isInteger(sample.bytes) ||
      sample.bytes < 1 ||
      sample.bytes > 3600000 ||
      !Number.isInteger(sample.crc32) ||
      sample.crc32 < 0 ||
      sample.crc32 > 0xffffffff
    )
      throw new Error('歌曲元数据无效')
    const volume = sample.volumePercent === undefined ? 100 : sample.volumePercent
    if (!Number.isInteger(volume) || volume < 0 || volume > 100)
      throw new Error('音量必须为 0–100 的整数')
    if (!sample.streamFile) throw new Error('9 Pro 原生服务不支持文件流')
    let sourceId = 'b'
    if (sample.group === 'phone') {
      const match = /^internal:\/\/files\/music_([a-f0-9]{32})\.bin$/.exec(sample.uri)
      if (!match) throw new Error('手机歌曲路径无效')
      sourceId = match[1]
    } else if (sample.uri !== '/common/sample.bin' || sample.bytes !== 96000)
      throw new Error('未知内置试听')
    diagnostics.tx = '打开已保存音频'
    return Promise.resolve(
      Object.assign({}, sample, {
        volumePercent: volume,
        sourceId,
      })
    )
  }
  const api = {
    session,
    get pending() {
      return pending
    },
    get busy() {
      return !!pending || sending
    },
    cancelPublishedPending() {
      // Stop may supersede an acknowledged file publication whose receipt was lost.
      // Never race an unresolved/uncertain move callback with a newer command.
      if (sending || !pending || !pending.published) return false
      pending = null
      return true
    },
    get diagnostics() {
      return Object.assign({}, diagnostics)
    },
    readSavedResult() {
      if (closed) return Promise.resolve(null)
      // Historical evidence only. Never consume pending or advance an operation here.
      return read('haptic_native_result.json').then(
        r => {
          if (
            r &&
            r.abi === 1 &&
            r.terminal === true &&
            typeof r.ok === 'boolean' &&
            typeof r.session === 'string' &&
            typeof r.seq === 'number' &&
            nativeOps.includes(r.op)
          )
            return r
          return null
        },
        () => null
      )
    },
    init() {
      if (closed) return Promise.reject(new Error('会话已关闭'))
      diagnostics.session = '正在写入会话标记'
      const expires = Math.floor(now() / 1000) + 600
      return track(
        writeLease(expires)
          .then(() => waitNative())
          .then(
            () => {
              if (!closed) {
                sessionExpires = expires
                initialized = true
                diagnostics.session = '会话标记已写入'
                diagnostics.error = ''
              }
            },
            e => {
              diagnostics.session = nativeExpires ? '会话标记已写入 · 等待心跳' : '会话写入失败'
              diagnostics.error = message(e)
              throw e
            }
          )
      )
    },
    close() {
      if (closePromise) return closePromise
      closed = true
      initialized = false
      pending = null
      diagnostics.session = '正在关闭会话'
      // Wait for in-flight publications, then invalidate the marker last.
      closePromise = Promise.all(active.slice().map(p => p.catch(() => {})))
        .then(() => writeLease(0, true))
        .then(() => atomic('haptic_session.txt', 'HBR1\n' + session + '\n0\nEND\n', true))
        .then(
          () => {
            diagnostics.session = '会话已关闭'
          },
          e => {
            diagnostics.session = '关闭结果未确认'
            diagnostics.error = message(e)
            throw e
          }
        )
      return closePromise
    },
    send(op, sample) {
      if (closed) return Promise.reject(new Error('会话已关闭'))
      if (!initialized) return Promise.reject(new Error('请先建立连接'))
      if (pending || sending) return Promise.reject(new Error('上一条请求尚未结束'))
      if (!nativeOps.includes(op)) return Promise.reject(new Error('未知操作'))
      sending = true
      diagnostics.tx = op === 'stage' ? '正在准备样本' : '正在写入 ' + op
      diagnostics.error = ''
      let stagedSample
      const prepare =
        op === 'stage' ? Promise.resolve().then(() => prepareSample(sample)) : Promise.resolve()
      return track(
        prepare
          .then(prepared => {
            stagedSample = prepared
            requireOpen()
            // Replays skip staging. Renew a short lease before any command, so a
            // long listening session does not lose its mailbox after ten minutes.
            return renewLease().then(() =>
              nativeOps.includes(op)
                ? null
                : atomic(
                    'haptic_session.txt',
                    'HBR1\n' + session + '\n' + (Math.floor(now() / 1000) + 600) + '\nEND\n'
                  )
            )
          })
          .then(() => {
            requireOpen()
            const id = ++sequence,
              expires = Math.floor(now() / 1000) + 30
            const bytes = op === 'stage' ? stagedSample.bytes : 0,
              crc = op === 'stage' ? stagedSample.crc32 : 0
            const fields = ['HBR1', session, id, op, expires, bytes, crc]
            if (op === 'stage' && stagedSample.sourceId)
              fields.push(stagedSample.sourceId, stagedSample.volumePercent)
            const text = fields.concat(['END', '']).join('\n')
            // Retain uncertainty even if move reports an error after it actually succeeded.
            // The 30s TTL gates when the native service may START a request, not when it must finish.
            // Allow a full clip after the latest permissible start plus receipt grace.
            const validSize =
              sample &&
              Number.isInteger(sample.bytes) &&
              sample.bytes > 0 &&
              sample.bytes <= 3600000
            const workSeconds =
              op === 'play' ? (validSize ? Math.ceil(sample.bytes / 12000) : 300) : 0
            const request = {
              seq: id,
              op,
              expires,
              responseDeadline: expires + workSeconds + 10,
              sampleCrc: crc,
              sampleBytes: bytes,
            }
            pending = request
            diagnostics.tx = '正在发布 #' + id + ' ' + op
            return atomic(prefix(op) + 'request.txt', text).then(() => {
              request.published = true
              return request
            })
          })
          .then(
            r => {
              sending = false
              diagnostics.tx = '已写入 #' + r.seq + ' ' + op + '，等待回执'
              return r
            },
            e => {
              sending = false
              diagnostics.tx = '写入失败或结果未确认'
              diagnostics.error = message(e)
              throw e
            }
          )
      )
    },
    poll() {
      if (pollBusy || closed) return Promise.resolve(null)
      pollBusy = true
      const out = {}
      return (initialized ? renewLease() : Promise.resolve())
        .then(() =>
          Promise.all([
            read('haptic_native_heartbeat.json').then(
              h => {
                if (
                  h &&
                  h.abi === 1 &&
                  h.native_revision === 1 &&
                  h.session === session &&
                  h.player &&
                  h.player.build === 0x91750003 &&
                  typeof h.tick === 'number'
                ) {
                  out.heartbeat = h
                  diagnostics.heartbeat = '匹配本会话 · tick ' + h.tick
                } else diagnostics.heartbeat = '心跳版本、会话或构建号不匹配，忽略'
              },
              e => {
                diagnostics.heartbeat = message(e)
              }
            ),
            read((pending ? prefix(pending.op) : 'haptic_native_') + 'result.json').then(
              r => {
                if (
                  r &&
                  r.abi === 1 &&
                  r.session === session &&
                  pending &&
                  r.seq === pending.seq &&
                  r.op === pending.op &&
                  typeof r.ok === 'boolean' &&
                  r.terminal === true &&
                  (!nativeOps.includes(r.op) || r.native_revision === 1)
                ) {
                  out.result = r
                  pending = null
                  diagnostics.result = '#' + r.seq + ' ' + r.op + ' · ' + (r.ok ? '成功' : '失败')
                } else diagnostics.result = '无匹配当前请求的回执'
              },
              e => {
                diagnostics.result = message(e)
              }
            ),
          ])
        )
        .then(
          () => {
            // TTL expiry is not a cancellation of an already-running native call.
            if (pending && now() / 1000 > pending.responseDeadline) {
              out.timeout = pending
              pending = null
              diagnostics.tx = '请求 #' + out.timeout.seq + ' ' + out.timeout.op + ' 回执超时'
            }
            pollBusy = false
            return out
          },
          e => {
            pollBusy = false
            throw e
          }
        )
    },
  }
  return api
}
