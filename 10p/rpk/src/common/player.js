// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// D16 player: receipts acknowledge commands; native telemetry confirms playback.
import manifest from '../manifest.json'
import { attachPlayerView, PLAYER_COLORS, displaySongTitle } from './player_view.js'
export function createPlayer(
  file,
  app,
  sample,
  createBridge,
  timers = {},
  phone = null,
  brightness = null
) {
  const builtinTracks = (sample.variants || [sample]).slice()
  let tracks = builtinTracks.slice(),
    libraryRevision = 0,
    renderedLibraryKey = '',
    libraryPage = 0,
    phoneTracks = [],
    trackIndices = new Map(),
    indexedRevision = -1
  const emptyTrack = {
    uri: '',
    bytes: 0,
    crc32: 0,
    title: '暂无歌曲',
    tone: '从手机传入歌曲',
    group: 'empty',
  }
  let directFileAvailable = false,
    streamStageAvailable = false
  let music = null,
    connection = null,
    notificationWanted = null,
    notificationId = null,
    receiptTimer = null,
    finalReceipt = null,
    receiptGeneration = 0
  const every = timers.setInterval || setInterval,
    cancel = timers.clearInterval || clearInterval
  const later = timers.setTimeout || setTimeout,
    cancelLater = timers.clearTimeout || clearTimeout
  const now = timers.now || (() => Date.now())
  let b,
    alive = false,
    visible = false,
    closing = false,
    ready = false,
    initializing = null,
    timer = null
  let selected = 0,
    volume = 100,
    queue = [],
    purpose = '',
    sending = false,
    stagedKey = null,
    stagedCrc = null,
    stageRequest = null
  let device = null,
    tick = null,
    lastHeartbeat = 0,
    stopWanted = false,
    lastTelemetry = 0
  let exitPromise = null
  let pendingSwitch = null,
    autoRun = null,
    order = 'sequential'
  const orderLabels = {
    sequential: '顺序播放',
    list: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放',
  }
  function clearReceiptRetry() {
    receiptGeneration++
    if (receiptTimer !== null) cancelLater(receiptTimer)
    receiptTimer = null
  }
  function sendPhone(p, reply) {
    if (!connection || !alive || closing) return
    if (reply.op === 'begin' && reply.ok) {
      clearReceiptRetry()
      finalReceipt = null
    }
    if (!reply.saved) {
      try {
        connection.send({
          data: reply,
        })
      } catch (e) {}
      return
    }
    clearReceiptRetry()
    finalReceipt = reply
    const epoch = receiptGeneration
    const attempt = n => {
      if (!alive || closing || epoch !== receiptGeneration) return
      let settled = false
      const finish = failed => {
        if (settled || epoch !== receiptGeneration) return
        settled = true
        if (receiptTimer !== null) cancelLater(receiptTimer)
        receiptTimer = null
        if (!alive || closing) return
        if (failed && n < 2) receiptTimer = later(() => attempt(n + 1), 500)
        else if (failed) p.phoneText = '歌曲已保存，回执发送未确认；重连后自动补发'
      }
      receiptTimer = later(() => finish(true), 2000)
      try {
        connection.send({
          data: reply,
          success: () => finish(false),
          fail: () => finish(true),
        })
      } catch (e) {
        finish(true)
      }
    }
    attempt(0)
  }
  const track = () =>
    Object.assign({}, tracks[selected] || emptyTrack, {
      volumePercent: volume,
      directFile: directFileAvailable,
      streamFile: streamStageAvailable,
    })
  const startOp = () => 'start'
  const sourceId = () =>
    track().group === 'phone'
      ? String(track().uri).replace(/^internal:\/\/files\/music_([a-f0-9]{32})\.bin$/, '$1')
      : 'b'
  const key = () => track().uri + '@' + volume
  const time = n => Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0')
  const active = () => !!(device && device.active)
  // Lyrics follow recording identity. Volume-scaled CRC is only for audio staging/reuse.
  const recordingMatches = (s, t) =>
    !!(
      s &&
      t &&
      s.total > 0 &&
      s.total === t.bytes &&
      s.source_id === (t.group === 'phone' ? t.id : 'b') &&
      (s.volume_percent !== 100 || s.crc32 === t.crc32)
    )
  const labels = {
    ping: '连接原生服务',
    load: '加载播放器',
    player: '读取播放状态',
    stage: '准备音频',
    start: '启动播放',
    pause: '请求暂停',
    resume: '请求继续',
    stop: '请求停止',
    clear: '清空缓冲',
    status: '模块状态',
  }
  Object.assign(labels, {
    notifications: '验证通知栏桥接',
  })
  function selection(p) {
    if (indexedRevision !== libraryRevision) {
      phoneTracks = tracks.filter(t => t.group === 'phone')
      trackIndices = new Map()
      tracks.forEach((t, i) => trackIndices.set(t.group === 'phone' ? t.id : 'b', i))
      indexedRevision = libraryRevision
    }
    if (active()) {
      const candidate = trackIndices.get(device.source_id),
        index =
          device.source_id === 'b'
            ? tracks.slice(0, builtinTracks.length).findIndex(t => recordingMatches(device, t))
            : candidate !== undefined && recordingMatches(device, tracks[candidate])
              ? candidate
              : -1
      if (index >= 0) {
        selected = index
        volume = device.volume_percent
      }
    }
    const imported = phoneTracks[phoneTracks.length - 1]
    p.hasPhoneSong = !!imported
    p.phoneSongTitle = imported ? imported.title : ''
    p.phoneSongDuration = imported ? time(imported.bytes / 12000) : ''
    p.phoneSongCount = phoneTracks.length
    p.hasSelectedSong = !!tracks[selected]
    p.builtinSelected = p.hasSelectedSong && track().group !== 'phone'
    p.phoneSelected = track().group === 'phone'
    const pages = Math.max(1, Math.ceil(tracks.length / 8))
    libraryPage = Math.min(libraryPage, pages - 1)
    p.libraryPage = libraryPage
    p.libraryPageCount = pages
    p.libraryPageText = libraryPage + 1 + ' / ' + pages
    const rowsKey = libraryRevision + '|' + selected + '|' + libraryPage
    if (renderedLibraryKey !== rowsKey) {
      const rows = tracks.slice(libraryPage * 8, libraryPage * 8 + 8).map((t, i) => {
        const index = libraryPage * 8 + i
        return {
          id: t.id || t.uri,
          index,
          title: t.title || '内置试听',
          displayTitle: displaySongTitle(t.title || '内置试听'),
          deletable: t.group === 'phone' || t.uri === '/common/sample.bin',
          selected: index === selected,
          cardStyle:
            'background-color:' +
            (index === selected ? PLAYER_COLORS.selected : PLAYER_COLORS.surface) +
            ';',
          caption: (t.group === 'phone' ? '手机音乐' : '内置试听') + ' · ' + time(t.bytes / 12000),
          subtitle:
            (index === selected ? '已选择 · ' : '') +
            (t.group === 'phone' ? '手机传入' : '内置') +
            ' · ' +
            time(t.bytes / 12000),
        }
      })
      p.songs = rows
      renderedLibraryKey = rowsKey
    }
    p.lyricsRaw = track().lyrics || ''
    p.lyricsTrackId = track().id || track().uri
    p.uiDiscCoverUri = track().coverUri || ''
    p.trackTitle = track().title || '未选择歌曲'
    p.trackSubtitle = track().tone || track().label
    p.trackNumber =
      String(tracks.length ? selected + 1 : 0).padStart(2, '0') +
      ' / ' +
      String(tracks.length).padStart(2, '0')
    p.durationText = time(track().bytes / 12000)
    p.volumeText = volume + '%'
    const matches = recordingMatches(device, tracks[selected])
    p.lyricsMatched = !active() || matches
    p.lyricsElapsedMs = matches ? Math.floor(device.sent / 12) : 0
    const progress = matches || active() ? device : null
    p.elapsedText = time(progress ? progress.sent / 12000 : 0)
    p.durationText = time(progress ? progress.total / 12000 : track().bytes / 12000)
    p.progressStyle =
      'width: ' +
      (progress && progress.total
        ? Math.floor(Math.min(1, progress.sent / progress.total) * 272)
        : 0) +
      'px;'
    if (active() && !matches) {
      p.trackTitle = '设备播放'
      p.trackSubtitle = '当前片段信息未确认'
    }
  }
  function diagnostics(p) {
    if (!b) return
    const d = b.diagnostics,
      age = tick === null ? null : Math.floor((now() - lastHeartbeat) / 1000)
    p.bridgeText =
      age === null ? '等待原生服务' : age > 5 ? '连接停滞 ' + age + ' 秒' : '原生服务已连接'
    p.diagnosticText = d.session + '\n' + d.tx + '\n' + d.result + '\n' + (d.error || '')
    p.receiving = !!(music && music.busy)
    p.libraryLoading = !!(music && music.restoring)
    p.busy = sending || b.busy || queue.length > 0 || !!pendingSwitch
    p.switching = !!pendingSwitch
    p.playOrder = order
    p.playOrderText = orderLabels[order]
    p.playLabel = active() ? '播放中' : p.busy ? '准备中' : '播放'
    if (sending && purpose === 'play' && d.tx) p.statusText = d.tx
    if (active() && now() - lastTelemetry > 5000) p.statusText = '进度未更新 · 可请求停止'
    p.updatePresentation()
  }
  function fail(p, e) {
    pendingSwitch = null
    autoRun = null
    p.switching = false
    queue = []
    purpose = ''
    p.errorText = String((e && e.message) || e || '操作失败')
    p.statusText = '操作未完成'
    diagnostics(p)
  }
  function applyState(p, s) {
    if (
      !s ||
      s.player !== true ||
      s.build !== 0x10430012 ||
      !Number.isInteger(s.sent) ||
      !Number.isInteger(s.total) ||
      s.sent < 0 ||
      s.sent > s.total ||
      s.total > 3600000 ||
      s.total < 0 ||
      s.rate !== 12000 ||
      !Number.isInteger(s.volume_percent) ||
      s.volume_percent < 0 ||
      s.volume_percent > 100 ||
      !Number.isInteger(s.state) ||
      s.state < 0 ||
      s.state > 7 ||
      typeof s.active !== 'boolean'
    )
      return false
    device = s
    lastTelemetry = now()
    p.paused = s.active && s.state === 7
    p.pausing = s.active && s.pausing === true
    p.resuming = s.active && s.resuming === true
    p.stopping = s.active && s.stopping === true
    p.playing = s.active && !p.paused
    selection(p)
    const matches = recordingMatches(s, tracks[selected])
    p.progressHint = s.active ? '原生发送进度' : '已发送 / 总时长'
    if (!purpose && !sending) {
      p.statusText = s.active
        ? s.stopping
          ? '正在停止'
          : p.resuming
            ? '正在继续'
            : p.pausing
              ? '正在暂停'
              : p.paused
                ? '已暂停 · 点击继续'
                : '正在播放'
        : s.error < 0
          ? '播放错误 ' + s.error
          : !matches
            ? '当前片段待播放'
            : s.state === 6
              ? '已停止 · 可从头重播'
              : s.state === 4
                ? '播放完成'
                : '准备就绪'
      if (s.error < 0) p.errorText = 'native error ' + s.error
    }
    if (
      visible &&
      !closing &&
      !pendingSwitch &&
      purpose !== 'stop' &&
      !stopWanted &&
      matches &&
      Number.isInteger(s.run_id)
    ) {
      if (s.active && s.state === 3 && !s.stopping) autoRun = s.run_id
      if (
        !s.active &&
        s.state === 4 &&
        s.error === 0 &&
        s.sent === s.total &&
        autoRun === s.run_id
      ) {
        autoRun = null
        let next = order === 'single' ? selected : selected + 1
        if (order === 'list') next = (selected + 1) % tracks.length
        if (order === 'shuffle')
          next =
            tracks.length > 1
              ? (selected + 1 + Math.floor(Math.random() * (tracks.length - 1))) % tracks.length
              : selected
        if (next < tracks.length)
          pendingSwitch = {
            uri: tracks[next].uri,
            play: true,
            deadline: now() + 10000,
          }
      }
    }
    if (s.error < 0 || s.state === 6) autoRun = null
    return true
  }
  function finishSwitch(p) {
    if (!pendingSwitch || !visible || closing) return Promise.resolve()
    if (now() > pendingSwitch.deadline) {
      fail(p, '切歌超时，未启动下一曲；请重新操作')
      return Promise.resolve()
    }
    if (active() || sending || b.busy || queue.length || (music && (music.busy || music.restoring)))
      return Promise.resolve()
    const wanted = pendingSwitch
    pendingSwitch = null
    p.switching = false
    const index = tracks.findIndex(t => t.uri === wanted.uri)
    if (index < 0) {
      fail(p, '歌曲已不在清单中，请重新选择')
      return Promise.resolve()
    }
    if (device && device.error < 0) {
      fail(p, '原生播放错误，请检查播放状态')
      return Promise.resolve()
    }
    selected = index
    stagedKey = null
    autoRun = null
    selection(p)
    p.errorText = ''
    p.statusText = wanted.play ? '正在切换歌曲' : '已选歌曲，点击播放'
    return wanted.play ? p.play() : Promise.resolve()
  }
  function connect(p) {
    if (ready) return Promise.resolve()
    if (initializing) return initializing
    initializing = b.init().then(
      () => {
        initializing = null
        if (alive && !closing) {
          ready = true
          diagnostics(p)
        }
      },
      e => {
        initializing = null
        throw e
      }
    )
    return initializing
  }
  function pump(p) {
    if (!alive || closing || !visible || !b || sending || b.busy) return Promise.resolve()
    if (stopWanted) {
      queue = ['stop']
      purpose = 'stop'
      stopWanted = false
    }
    if (!queue.length) {
      diagnostics(p)
      return Promise.resolve()
    }
    const op = queue.shift()
    sending = true
    p.busy = true
    p.errorText = ''
    p.statusText = labels[op]
    const selectedKey = key(),
      spec = track()
    return connect(p)
      .then(() => {
        if (!alive || closing) throw new Error('页面已关闭')
        if (stopWanted && op !== 'stop') {
          queue = []
          return null
        }
        return b.send(op, spec)
      })
      .then(
        r => {
          sending = false
          if (!alive || closing) return
          if (op === 'stage' && r)
            stageRequest = {
              key: selectedKey,
              crc: r.sampleCrc,
            }
          diagnostics(p)
          if (!r) return pump(p)
        },
        e => {
          sending = false
          if (alive && !closing) {
            if (op === 'notifications')
              receive(p, {
                op,
                ok: false,
                error: String(e.message || e),
              })
            else fail(p, e)
            if (stopWanted) pump(p)
          }
        }
      )
  }
  function begin(p, ops, reason) {
    if (closing) return Promise.resolve()
    if (music && music.busy) {
      p.statusText = music.phase + '，请稍候'
      return Promise.resolve()
    }
    if (sending || b.busy || queue.length) {
      p.statusText = '上一条操作尚未结束'
      return Promise.resolve()
    }
    queue = ops
    purpose = reason
    p.errorText = ''
    return pump(p)
  }
  function receive(p, r) {
    const s = r.data || {}
    if (r.op === 'notifications') {
      if (
        r.ok &&
        !(s.notifications === true && s.called === true && s.action === 'open' && s.error === 0)
      ) {
        r = Object.assign({}, r, {
          ok: false,
          error: '通知回执无效，结果未确认',
        })
      }
      p.phoneText = r.ok ? '通知栏展开调用已返回 · 请观察手环' : '音乐已保存 · 通知失败：' + r.error
      if (connection)
        try {
          connection.send({
            data: {
              tag: 'haptic.music.v1',
              type: 'notification',
              id: notificationId,
              ok: r.ok,
              data: s,
              error: r.error || '',
            },
            fail: () => {},
          })
        } catch (e) {}
      notificationId = null
    }
    if (!r.ok) {
      const messages = {
        'native command -104': '原生会话已重建，旧请求未执行；请重新操作',
        'native command -16': '原生模块忙，请等待当前操作完成后重试',
        'native command -110': '命令已过期，未执行；请重新操作',
      }
      fail(p, messages[r.error] || r.error)
      return
    }
    if (r.op === 'ping') {
      directFileAvailable = s.stage_file_revision === 1
      streamStageAvailable = s.stage_stream_revision === 2 && s.native_revision === 1
      if (purpose === 'play' && !streamStageAvailable) {
        fail(p, '播放需要 D16 / N1 配套表盘，请更新并完成首次初始化')
        return
      }
    }
    if (
      r.op === 'ping' &&
      (s.backend_revision !== 16 || s.async_player !== true || s.max_samples < track().bytes)
    ) {
      fail(p, '需要 D16 配套表盘；更新后重启手环')
      return
    }
    if (['stage', 'start', 'stop', 'pause', 'resume'].includes(r.op) && s.error < 0) {
      fail(p, 'native error ' + s.error)
      return
    }
    if (r.op === 'stage' && stageRequest) {
      stagedKey = stageRequest.key
      stagedCrc = stageRequest.crc
    }
    if (['start', 'stop', 'pause', 'resume', 'player'].includes(r.op) && !applyState(p, s)) {
      fail(p, '无效原生播放状态，请重新读取')
      return
    }
    if (r.op === 'player' && purpose === 'play') {
      if (s.active) {
        queue = []
        purpose = ''
        p.statusText = '设备正在播放'
        return
      }
      if (
        s.source_id === sourceId() &&
        s.volume_percent === volume &&
        ((stagedKey === key() && stagedCrc === s.crc32) ||
          (volume === 100 && track().crc32 === s.crc32)) &&
        s.total === track().bytes &&
        [2, 4, 6].includes(s.state)
      )
        queue = [startOp()]
      else queue = ['stage', startOp()]
    }
    if (!queue.length) {
      purpose = ''
      if (['start', 'stop', 'pause', 'resume'].includes(r.op)) {
        if (s.player) applyState(p, s)
        else fail(p, '缺少原生播放状态，请读取状态确认')
      } else if (r.op === 'clear') {
        stagedKey = null
        p.statusText = '缓冲已清空'
      } else if (r.op === 'stock') p.statusText = '系统振动已返回'
      else if (!s.player) p.statusText = '操作完成'
    }
  }
  function restoreLibrary(p) {
    if (!music) return Promise.resolve()
    const result = music.restore()
    p.libraryLoading = music.restoring
    p.updatePresentation()
    return result.then(() => {
      if (alive && !closing) {
        selection(p)
        diagnostics(p)
      }
    })
  }
  return attachPlayerView(
    {
      private: {
        hasSelectedSong: true,
        deletingSong: false,
        deleteNote: '',
        lyricsRaw: '',
        lyricsTrackId: '',
        lyricsElapsedMs: 0,
        lyricsMatched: true,
        appVersion: manifest.versionName,
        copyrightText: '© 2026 Leon · 作者：Leon',
        phoneSongCount: 0,
        deleteSongId: '',
        deleteSongTitle: '',
        songs: [],
        libraryPage: 0,
        libraryPageCount: 1,
        libraryPageText: '1 / 1',
        songList: false,
        hasPhoneSong: false,
        phoneSongTitle: '',
        phoneSongDuration: '',
        builtinSelected: true,
        phoneSelected: false,
        phoneText: '手机选曲后发送到这里',
        phoneReceiptText: '',
        details: false,
        trackTitle: '未选择歌曲',
        trackSubtitle: '试听 · 8秒',
        trackNumber: '01 / 05',
        statusText: '选择歌曲，点击播放',
        bridgeText: '等待原生服务',
        errorText: '',
        elapsedText: '0:00',
        durationText: '0:08',
        progressHint: '原生发送进度',
        progressStyle: 'width: 0px;',
        volumeText: '100%',
        playLabel: '播放',
        playOrder: 'sequential',
        playOrderText: '顺序播放',
        switching: false,
        playing: false,
        paused: false,
        pausing: false,
        resuming: false,
        stopping: false,
        busy: false,
        diagnosticText: '等待建立会话',
      },
      onInit() {
        alive = true
        visible = false
        closing = false
        ready = false
        selected = 0
        volume = 100
        queue = []
        purpose = ''
        device = null
        tick = null
        stagedKey = null
        stagedCrc = null
        stopWanted = false
        pendingSwitch = null
        autoRun = null
        b = createBridge(file)
        selection(this)
        this.phoneText = '手机选曲后发送到这里'
        this.phoneReceiptText = ''
        if (phone) {
          music = phone.createMusicReceiver(
            file,
            {
              diagnostics: () => ({
                revision: 1,
                rpkVersion: manifest.versionName,
                rpkVersionCode: manifest.versionCode,
                targetModel: 'Xiaomi Smart Band 10 Pro',
                targetFirmware: '3.101.043',
                nativeBuild: device ? device.build : null,
                nativeError: device ? device.error : null,
                playing: !!(device && device.active),
                sentBytes: device ? device.sent : null,
                totalBytes: device ? device.total : null,
                telemetryAgeMs: lastTelemetry ? Math.max(0, now() - lastTelemetry) : null,
                nativeConnected: !!device && lastTelemetry > 0 && now() - lastTelemetry <= 5000,
                librarySongs: tracks.filter(t => t.group === 'phone').length,
                queueLength: queue.length,
              }),
              blocked: () =>
                closing ||
                !visible ||
                !!pendingSwitch ||
                active() ||
                sending ||
                b.busy ||
                queue.length > 0,
              status: text => {
                this.phoneText = text
                this.receiving = !!music.busy
                this.libraryLoading = !!music.restoring
                this.updatePresentation()
              },
              library: (items, settings = {}) => {
                if (!alive || closing) return
                const id = track().id || track().uri
                const builtin = builtinTracks.filter(
                  t => !settings.builtinRemoved || t.uri !== '/common/sample.bin'
                )
                if (JSON.stringify(tracks) === JSON.stringify(builtin.concat(items))) return
                tracks = builtin.concat(items)
                libraryRevision++
                selected = Math.max(
                  0,
                  tracks.findIndex(t => (t.id || t.uri) === id)
                )
                selection(this)
                this.updatePresentation()
              },
              imported: (t, fresh) => {
                if (!alive || closing) return
                this.phoneReceiptText =
                  (fresh ? '传输完成 · 已校验保存' : '已保存歌曲') +
                  '\n' +
                  t.title +
                  ' · ' +
                  (t.bytes / 12000).toFixed(1) +
                  '秒'
                const index = tracks.findIndex(x => x.id === t.id)
                if (index >= 0) {
                  tracks[index] = t
                  if (fresh) selected = index
                } else {
                  tracks.push(t)
                  if (fresh || !active()) selected = tracks.length - 1
                }
                libraryRevision++
                if (fresh) {
                  stagedKey = null
                  libraryPage = Math.floor(selected / 8)
                }
                selection(this)
                if (fresh) this.statusText = '手机音乐已保存，点击播放'
                this.updatePresentation()
                // Completion is acknowledged directly; optional FACE notification must not block playback.
              },
            },
            timers
          )
          restoreLibrary(this)
          try {
            connection = phone.interconnect.instance()
            connection.onmessage = event => {
              if (typeof event.data === 'string' && event.data.length > 24576) return
              music
                .handle(event.data)
                .then(reply => {
                  if (reply && alive && !closing) {
                    sendPhone(this, reply)
                    this.receiving = music.busy
                    this.libraryLoading = music.restoring
                    this.updatePresentation()
                  }
                  if (reply && reply.saved && alive && !closing) this.refresh()
                })
                .catch(e => {
                  this.phoneText = String(e)
                })
            }
            connection.onopen = () => {
              if (finalReceipt) sendPhone(this, finalReceipt)
            }
            connection.onerror = () => {
              this.phoneText = '手机连接异常，请检查小米运动健康'
            }
            connection.onclose = () => {
              this.phoneText = '手机连接断开；可在安卓端继续未完成的传输'
            }
          } catch (e) {
            this.phoneText = '手机通信不可用：' + String(e)
          }
        }
      },
      onShow() {
        visible = true
        if (closing) return
        if (music && !music.busy) restoreLibrary(this)
        connect(this).then(
          () => {
            if (alive && !closing) {
              this.refresh()
              pump(this)
            }
          },
          e => {
            if (alive && !closing) fail(this, e)
          }
        )
        if (timer === null) timer = every(() => this.refresh(), 1000)
      },
      onHide() {
        autoRun = null
        pendingSwitch = null
        this.switching = false
        visible = false
        if (timer !== null) cancel(timer)
        timer = null
      },
      onDestroy() {
        autoRun = null
        pendingSwitch = null
        if (music) music.close()
        clearReceiptRetry()
        finalReceipt = null
        if (connection) {
          connection.onopen = null
          connection.onmessage = null
          connection.onerror = null
          connection.onclose = null
        }
        alive = false
        visible = false
        queue = []
        if (timer !== null) cancel(timer)
        timer = null
        if (b) b.close().catch(() => {})
      },
      refresh() {
        if (!alive || closing || !b) return Promise.resolve()
        if (notificationWanted && !(music && music.busy) && !sending && !b.busy && !queue.length) {
          notificationId = notificationWanted
          notificationWanted = null
          queue = ['notifications']
          purpose = 'notifications'
        }
        diagnostics(this)
        return b.poll().then(
          out => {
            if (!out || !alive || closing) return
            if (out.heartbeat) {
              if (tick !== out.heartbeat.tick) {
                tick = out.heartbeat.tick
                lastHeartbeat = now()
                applyState(this, out.heartbeat.player)
              }
            }
            if (out.result) receive(this, out.result)
            if (out.timeout) {
              if (out.timeout.op === 'notifications')
                receive(this, {
                  op: 'notifications',
                  ok: false,
                  error: '通知回执超时，结果未确认；不自动重试',
                })
              else fail(this, '原生回执超时，结果未确认；可读取状态或请求停止')
            }
            diagnostics(this)
            return finishSwitch(this).then(() => pump(this))
          },
          e => {
            if (alive && !closing) fail(this, e)
          }
        )
      },
      play() {
        if (active()) {
          if (this.paused) return this.resume()
          this.statusText = '正在播放，可点击暂停'
          return Promise.resolve()
        }
        if (music && music.restoring) {
          this.statusText = '正在读取歌曲清单，随后播放'
          return restoreLibrary(this).then(() => {
            if (alive && !closing) return this.play()
          })
        }
        if (!tracks.length) {
          this.statusText = '暂无歌曲，请从手机传入'
          this.uiTransfer()
          return Promise.resolve()
        }
        return begin(this, streamStageAvailable ? ['player'] : ['ping', 'player'], 'play')
      },
      pause() {
        if (!active() || this.paused || this.pausing || this.resuming) return Promise.resolve()
        return begin(this, ['pause'], 'pause')
      },
      resume() {
        if (!active() || !this.paused || this.pausing || this.resuming) return Promise.resolve()
        return begin(this, ['resume'], 'resume')
      },
      stop() {
        pendingSwitch = null
        autoRun = null
        this.switching = false
        if (closing) return Promise.resolve()
        // Discard queued prepare/start steps, then stop after the in-flight receipt.
        queue = []
        purpose = 'stop'
        stopWanted = true
        this.statusText = '正在请求停止'
        if (b && typeof b.cancelPublishedPending === 'function') b.cancelPublishedPending()
        return pump(this)
      },
      previous() {
        return this.select(-1)
      },
      next() {
        return this.select(1)
      },
      select(delta) {
        if (!tracks.length) {
          this.statusText = '暂无歌曲，请从手机传入'
          return Promise.resolve()
        }
        if (
          closing ||
          pendingSwitch ||
          (music && (music.busy || music.restoring)) ||
          sending ||
          b.busy ||
          queue.length
        ) {
          this.statusText = '正在处理，请稍候再切歌'
          return Promise.resolve()
        }
        const index = (selected + delta + tracks.length) % tracks.length
        if (active()) {
          const wanted = {
            uri: tracks[index].uri,
            play: !this.paused,
            deadline: now() + 10000,
          }
          const result = this.stop()
          pendingSwitch = wanted
          this.switching = true
          this.statusText = '正在停止当前曲并切换'
          return result
        }
        selected = index
        stagedKey = null
        autoRun = null
        selection(this)
        this.statusText = '已选歌曲，点击播放'
        this.errorText = ''
        return Promise.resolve()
      },
      setPlayOrder(value) {
        if (!orderLabels[value]) return
        order = value
        this.playOrder = value
        this.playOrderText = orderLabels[value]
        this.statusText = '已设为' + orderLabels[value]
      },
      volumeDown() {
        return this.adjustVolume(-10)
      },
      volumeUp() {
        return this.adjustVolume(10)
      },
      adjustVolume(delta) {
        if (
          closing ||
          pendingSwitch ||
          (music && music.busy) ||
          active() ||
          sending ||
          b.busy ||
          queue.length
        ) {
          this.statusText = '停止后可调音量'
          return
        }
        volume = Math.max(0, Math.min(100, volume + delta))
        stagedKey = null
        selection(this)
        this.statusText = volume ? '下次播放生效' : '下次播放静音'
      },
      previousLibraryPage() {
        if (libraryPage > 0) {
          libraryPage--
          selection(this)
          this.updatePresentation()
        }
      },
      nextLibraryPage() {
        if ((libraryPage + 1) * 8 < tracks.length) {
          libraryPage++
          selection(this)
          this.updatePresentation()
        }
      },
      openSongs() {
        libraryPage = Math.floor(selected / 8)
        selection(this)
        this.details = false
        this.songList = true
      },
      chooseBuiltin() {
        return this.chooseSong(tracks.findIndex(t => t.uri === '/common/sample.bin'))
      },
      requestDeleteSong(id) {
        if (this.deleteSongId || this.deletingSong || closing) return
        const song = tracks.find(
          t => (t.id || t.uri) === id && (t.group === 'phone' || t.uri === '/common/sample.bin')
        )
        if (!song) return
        this.deleteSongId = id
        this.deleteSongTitle = song.title || '内置试听'
        this.deleteNote =
          song.group === 'phone'
            ? '删除后可从手机重新传入'
            : '从歌曲清单删除内置试听，重开应用后仍生效'
      },
      cancelDeleteSong() {
        if (this.deletingSong) return
        this.deleteSongId = ''
        this.deleteSongTitle = ''
        this.deleteNote = ''
      },
      async confirmDeleteSong() {
        const id = this.deleteSongId
        if (!id || !music || closing || this.deletingSong) return
        this.deletingSong = true
        this.deleteNote = '正在删除，请稍候'
        this.updatePresentation()
        try {
          await music.deleteSong(id)
          if (!alive || closing) return
          this.deletingSong = false
          this.cancelDeleteSong()
          stagedKey = null
          if (finalReceipt && finalReceipt.id === id) {
            clearReceiptRetry()
            finalReceipt = null
          }
          this.phoneReceiptText = ''
          this.statusText = '歌曲已删除'
          this.errorText = ''
          selection(this)
        } catch (e) {
          if (alive && !closing) {
            this.statusText = '删除未完成'
            this.errorText = String(e.message || e)
            this.deleteNote = this.errorText
          }
        } finally {
          this.deletingSong = false
        }
        if (alive && !closing) diagnostics(this)
      },
      async cancelTransfer() {
        if (!music || closing) return
        this.phoneText = '正在中断传输…'
        const result = await music.cancelTransfer()
        if (result.cancelled) {
          clearReceiptRetry()
          finalReceipt = null
          this.phoneReceiptText = ''
          this.phoneText = '传输已取消，已有歌曲保留'
          try {
            connection?.send({
              data: {
                tag: 'haptic.music.v1',
                type: 'cancelled',
                id: result.id,
                ok: true,
                cancelled: true,
              },
              fail: () => {},
            })
          } catch (e) {}
        } else if (result.saved) this.phoneText = '歌曲已经保存，可在清单中删除'
        else this.phoneText = result.error || '中断结果未确认'
        this.receiving = music.busy
        this.updatePresentation()
      },
      choosePhone() {
        let index = -1
        tracks.forEach((t, i) => {
          if (t.group === 'phone') index = i
        })
        return this.chooseSong(index)
      },
      chooseSong(index) {
        if (this.deleteSongId) return
        if (index < 0 || index >= tracks.length) return
        if (
          closing ||
          pendingSwitch ||
          (music && (music.busy || music.restoring)) ||
          sending ||
          b.busy ||
          queue.length
        ) {
          this.statusText = '正在处理，请稍候再切歌'
          return
        }
        this.songList = false
        this.details = false
        // Use the same stop-confirm-select-start sequence as previous/next.
        return this.select(index - selected)
      },
      toggleDetails() {
        if (this.songList) {
          this.songList = false
          this.details = false
          return
        }
        this.details = !this.details
      },
      readState() {
        return begin(this, ['player'], 'status')
      },
      clear() {
        if (active()) {
          this.statusText = '先停止播放'
          return
        }
        return begin(this, ['clear'], 'clear')
      },
      exitApp() {
        if (closing) return exitPromise || Promise.resolve()
        closing = true
        // Keep the live bridge and poller until the synchronous terminate call is
        // accepted. A rejection must leave playback controllable. Native EXIT_COMMIT
        // already owns the visual handoff; no file callback may invoke terminate.
        try {
          app.terminate()
        } catch (e) {
          closing = false
          exitPromise = Promise.reject(e)
          return exitPromise
        }
        autoRun = null
        pendingSwitch = null
        queue = []
        if (timer !== null) cancel(timer)
        timer = null
        // onDestroy also closes it; close() is idempotent and never stops audio.
        if (b) b.close().catch(() => {})
        exitPromise = Promise.resolve()
        return exitPromise
      },
    },
    timers,
    brightness,
    file
  )
}
