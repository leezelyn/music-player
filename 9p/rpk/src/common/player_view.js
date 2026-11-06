// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import { createScreenAwake } from './screen_awake.js'
import { parseLyrics, lyricIndex } from './lyrics.js'
// Presentation and navigation only. Playback, files and HMP1 stay in their existing owners.
export const PLAYER_COLORS = {
  background: '#111217',
  surface: '#191a20',
  primary: '#bac3ff',
  onPrimary: '#10236f',
  selected: '#293b89',
  text: '#ffffff',
  secondary: '#c7c6d0',
  muted: '#91919b',
  info: '#3B94FF',
  success: '#3BFFA4',
  warning: '#FFC73B',
  error: '#FF3838',
}
export function displaySongTitle(value) {
  return (
    String(value || '')
      .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
      .trim()
      .replace(/\.mp3$/i, '')
      .trim() || '未命名歌曲'
  )
}
const titles = {
  home: '正在播放',
  library: '歌曲清单',
  transfer: '手机传歌',
  settings: '设置',
  playback: '播放设置',
  lyrics: '歌词',
  reader: '详情',
  disc: '唱盘模式',
}
const helpText = [
  '首次使用\n重启后先打开 9 Pro 09g 配套表盘，看到“原生控制已启动”后，再打开播放器。',
  '播放与唱盘模式\n首页点击中央按钮播放；播放中点击可暂停，再点继续。首页左右按钮切换歌曲；播放中先停止当前曲再切换，暂停时切换只选中歌曲。停止后从头重播。\n点击首页歌曲名进入唱盘模式。点击唱片可播放、暂停或继续；播放时旋转，暂停时停转。点击唱盘上方歌曲名查看详情；下方显示上一句、当前句和下一句同步歌词。点击歌词展开全文，上下滑动阅读，返回键收起；右上角图标返回首页。没有歌词时，可在安卓端选取 LRC 文件传入。',
  '歌曲清单\n此源码公开版不提供内置试听，请从手机传入歌曲。手机歌曲数量不限，实际容量取决于手环剩余空间。清单分页显示。',
  '手机传歌与封面\n在手机“环间音乐”中选歌、手动转码后发送。支持 300 秒以内歌曲，按实际结束位置转码。可选图片作唱片封面：手机会居中裁剪并压缩，歌曲保存后单独传送封面并等待回执；也可在“补充歌词/封面”中为已有手机歌曲单独传封面。未传封面时显示默认唱盘。传输时保持手环接收页打开，完成后查看保存回执；新歌曲加入清单，已有歌曲保留。手机或手环可中断传输，未完成文件会清理。',
  '播放设置\n屏幕常亮仅在本次打开的播放器前台生效，退出或切到后台时恢复系统熄屏。音量需停止后调整，下次播放生效；暂停后继续沿用原音量。播放顺序可选顺序播放、列表循环、单曲循环或随机播放。自动接歌仅在播放器前台生效，后台播完当前曲后停止。',
  '退出播放器\n退出后已开始的音乐可继续播放；需要停止时，请先在播放器中按停止。',
].join('\n\n')
export function scrollProgress(offset, content, viewport) {
  if (
    !Number.isFinite(content) ||
    !Number.isFinite(viewport) ||
    content <= viewport ||
    viewport <= 0
  )
    return {
      visible: false,
      percent: 0,
      height: 96,
      top: 0,
    }
  const ratio = Math.max(
    0,
    Math.min(1, (Number.isFinite(offset) ? offset : 0) / (content - viewport))
  )
  const height = Math.max(22, Math.round((96 * viewport) / content))
  return {
    visible: true,
    percent: Math.round(ratio * 100),
    height,
    top: Math.round((96 - height) * ratio),
  }
}
export function attachPlayerView(player, timers = {}, brightness = null) {
  const later = timers.setTimeout || setTimeout,
    cancel = timers.clearTimeout || clearTimeout
  const every = timers.setInterval || setInterval,
    cancelEvery = timers.clearInterval || clearInterval
  let alive = false,
    visible = false,
    measureTimer = null,
    epoch = 0,
    contentHeight = 0,
    viewportHeight = 0,
    offset = 0,
    contentKey = ''
  let page = null,
    awakeEnabled = false,
    lyricsReturn = 'home'
  const discStyle = angle => ({
    transform: JSON.stringify({
      rotate: angle + 'deg',
      scaleX: 1,
      scaleY: 1,
    }),
  })
  const idleDiscStyle = discStyle(0)
  let discTimer = null,
    discAngle = 0
  function stopDisc(p) {
    if (discTimer !== null) {
      cancelEvery(discTimer)
      discTimer = null
    }
    // Keep the last phase when paused; no jump to twelve o'clock on resume.
  }
  function syncDisc(p) {
    const spinning =
      visible && ready && p.uiScreen === 'disc' && p.playing && !p.pausing && !p.stopping
    if (p.uiDiscSpinning !== spinning) p.uiDiscSpinning = spinning
    if (!spinning) {
      if (discTimer !== null) stopDisc(p)
      return
    }
    if (discTimer !== null) return
    // Rotate the existing song cover or the default vinyl bitmap in place.
    discTimer = every(() => {
      if (!alive || !visible || p.uiScreen !== 'disc' || !p.playing || p.pausing || p.stopping) {
        stopDisc(p)
        return
      }
      discAngle = (discAngle + 9) % 360
      p.uiDiscStyle = discStyle(discAngle)
    }, 100)
  }
  const awake = createScreenAwake(brightness, state => {
    if (!alive || !page) return
    page.uiAwakeText = state.error
      ? '未生效 · 点击重试'
      : state.pending !== null
        ? '设置中…'
        : awakeEnabled
          ? '已开启'
          : '已关闭'
  })
  let ready = false,
    titleTimer = null,
    titleEpoch = 0,
    runningTitle = null,
    titleAttempts = 0
  const titleVisible = p => p.uiScreen === 'home' || p.uiScreen === 'disc'
  function stopTitle() {
    titleEpoch++
    titleAttempts = 0
    if (titleTimer !== null) cancel(titleTimer)
    titleTimer = null
    const node = runningTitle
    runningTitle = null
    if (node)
      try {
        node.stop()
      } catch (e) {}
  }
  function scheduleTitle(p) {
    if (
      !alive ||
      !ready ||
      !visible ||
      !titleVisible(p) ||
      titleTimer !== null ||
      runningTitle ||
      p.uiTitleUnavailable
    )
      return
    const token = titleEpoch
    titleTimer = later(() => {
      titleTimer = null
      if (token !== titleEpoch || !alive || !ready || !visible || !titleVisible(p)) return
      try {
        const node =
          typeof p.$element === 'function' &&
          p.$element(p.uiScreen === 'disc' ? 'disc-song-marquee' : 'song-marquee')
        if (!node) {
          // Conditional home nodes can appear after onReady. Retry only a bounded number of times.
          if (++titleAttempts < 4) scheduleTitle(p)
          else p.uiTitleUnavailable = true
          return
        }
        if (typeof node.start !== 'function' || typeof node.stop !== 'function') {
          p.uiTitleUnavailable = true
          return
        }
        try {
          node.start()
          runningTitle = node
        } catch (e) {
          try {
            node.stop()
          } catch (ignored) {}
          p.uiTitleUnavailable = true
        }
      } catch (e) {
        p.uiTitleUnavailable = true
      }
    }, [16, 50, 120, 250][titleAttempts])
  }
  let lyricRaw = null,
    lyricTrack = '',
    lyricRows = [],
    lyricText = '',
    lyricError = '',
    lyricNode = null,
    lyricTimer = null,
    lyricEpoch = 0,
    lyricAttempts = 0,
    lyricKey = ''
  function stopLyric() {
    lyricEpoch++
    lyricAttempts = 0
    if (lyricTimer !== null) cancel(lyricTimer)
    lyricTimer = null
    if (lyricNode)
      try {
        lyricNode.stop()
      } catch (e) {}
    lyricNode = null
  }
  function scheduleLyric(p) {
    if (
      !alive ||
      !ready ||
      !visible ||
      p.uiScreen !== 'home' ||
      lyricTimer !== null ||
      lyricNode ||
      p.uiLyricUnavailable ||
      !lyricRows.length
    )
      return
    const token = lyricEpoch
    lyricTimer = later(() => {
      lyricTimer = null
      if (token !== lyricEpoch || !alive || !visible || p.uiScreen !== 'home') return
      try {
        const n = typeof p.$element === 'function' && p.$element('lyric-marquee')
        if (!n) {
          if (++lyricAttempts < 4) scheduleLyric(p)
          else p.uiLyricUnavailable = true
          return
        }
        if (typeof n.start !== 'function' || typeof n.stop !== 'function') {
          p.uiLyricUnavailable = true
          return
        }
        n.start()
        lyricNode = n
      } catch (e) {
        p.uiLyricUnavailable = true
      }
    }, [16, 50, 120, 250][lyricAttempts])
  }
  function syncLyrics(p) {
    if (lyricRaw !== p.lyricsRaw || lyricTrack !== p.lyricsTrackId) {
      stopLyric()
      lyricKey = ''
      lyricRaw = p.lyricsRaw
      lyricTrack = p.lyricsTrackId
      lyricError = ''
      try {
        lyricRows = parseLyrics(lyricRaw || '')
      } catch (e) {
        lyricRows = []
        lyricError = String(e.message || e)
      }
      lyricText = lyricRows.length
        ? lyricRows.map(r => r.text || '♪').join('\n\n')
        : '暂无歌词。可在安卓端选择 LRC 文件，使用“只传歌词”为这首歌补充歌词，无需重传音频。'
      if (lyricError) lyricText = '歌词无法读取：' + lyricError
      if (p.uiScreen === 'lyrics') {
        reset(p)
        resetScrollPosition(p)
        schedule(p)
      }
    }
    const fullText =
      p.libraryLoading && !lyricRows.length ? '正在读取歌曲与歌词，请稍候' : lyricText
    if (p.uiLyricsText !== fullText) {
      p.uiLyricsText = fullText
      if (p.uiScreen === 'lyrics') schedule(p)
    }
    const index = lyricIndex(lyricRows, Number(p.lyricsElapsedMs) || 0)
    const text =
      p.libraryLoading && !lyricRows.length
        ? '正在读取歌曲与歌词'
        : p.lyricsMatched === false
          ? p.libraryLoading
            ? '正在读取歌曲与歌词'
            : '当前播放歌曲未匹配'
          : !lyricRows.length
            ? lyricError
              ? '歌词格式异常 · 点击查看'
              : p.hasSelectedSong
                ? '暂无歌词 · 点击查看'
                : '请先从手机传入歌曲'
            : index < 0
              ? '♪ 等待歌词'
              : lyricRows[index].text || '♪'
    if (text !== lyricKey) {
      stopLyric()
      lyricKey = text
      p.uiLyricLine = text
      p.uiLyricUnavailable = false
    }
    const matched = p.lyricsMatched !== false && !p.libraryLoading
    assign(p, 'uiDiscPrevious', matched && index > 0 ? lyricRows[index - 1].text || '♪' : '')
    assign(p, 'uiDiscCurrent', text)
    assign(
      p,
      'uiDiscNext',
      matched && index + 1 < lyricRows.length ? lyricRows[index + 1].text || '♪' : ''
    )
    scheduleLyric(p)
  }
  let libraryKey = '',
    libraryTimer = null,
    libraryAttempts = 0,
    libraryNodes = {}
  function stopLibrary() {
    if (libraryTimer !== null) cancel(libraryTimer)
    libraryTimer = null
    libraryAttempts = 0
    libraryKey = ''
    Object.keys(libraryNodes).forEach(id => {
      try {
        libraryNodes[id].stop()
      } catch (e) {}
    })
    libraryNodes = {}
  }
  function syncLibrary(p) {
    const rows = p.songs || []
    const key =
      alive && ready && visible && p.uiScreen === 'library' && !p.deleteSongId
        ? JSON.stringify(rows.map(s => [s.id, s.displayTitle]))
        : ''
    if (key !== libraryKey) {
      stopLibrary()
      libraryKey = key
    }
    if (
      !key ||
      libraryTimer !== null ||
      libraryAttempts >= 4 ||
      Object.keys(libraryNodes).length === rows.length
    )
      return
    libraryTimer = later(() => {
      libraryTimer = null
      if (key !== libraryKey) return
      libraryAttempts++
      rows.forEach(row => {
        const id = 'library-title-' + row.index
        if (libraryNodes[id]) return
        try {
          const node = typeof p.$element === 'function' && p.$element(id)
          if (node && typeof node.start === 'function' && typeof node.stop === 'function') {
            node.start()
            libraryNodes[id] = node
          }
        } catch (e) {}
      })
      syncLibrary(p)
    }, [16, 50, 120, 250][libraryAttempts])
  }
  const assign = (p, key, value) => {
    if (p[key] !== value) p[key] = value
  }
  const reset = p => {
    epoch++
    contentHeight = 0
    viewportHeight = 0
    offset = 0
    p.uiScrollVisible = false
    p.uiScrollStyle = 'height:96px;top:0px;'
    if (measureTimer !== null) cancel(measureTimer)
    measureTimer = null
  }
  function progress(p) {
    const v = scrollProgress(offset, contentHeight, viewportHeight)
    p.uiScrollVisible = v.visible
    assign(p, 'uiScrollStyle', 'height:' + v.height + 'px;top:' + v.top + 'px;')
  }
  function measure(p) {
    if (
      !alive ||
      !visible ||
      p.uiScreen === 'home' ||
      p.uiScreen === 'disc' ||
      typeof p.$element !== 'function'
    )
      return
    const token = epoch
    let element
    try {
      element = p.$element('content-scroll')
    } catch (e) {
      return
    }
    if (!element || typeof element.getScrollRect !== 'function') return
    try {
      element.getScrollRect({
        success: r => {
          if (!alive || !visible || token !== epoch) return
          // Convert runtime dimensions using the current viewport design width.
          const scale = Number(r.width) / (p.uiMenuWide ? 328 : 300)
          if (!Number.isFinite(scale) || scale <= 0) return
          contentHeight = Number(r.height)
          viewportHeight = 364 * scale
          progress(p)
        },
        fail: () => {
          if (alive && token === epoch) {
            contentHeight = 0
            progress(p)
          }
        },
      })
    } catch (e) {
      contentHeight = 0
      progress(p)
    }
  }
  function schedule(p) {
    if (!alive || !visible || measureTimer !== null) return
    measureTimer = later(() => {
      measureTimer = null
      measure(p)
    }, 16)
  }
  function reader(p) {
    const status = [p.statusText, p.errorText].filter(Boolean).join('\n\n')
    switch (p.uiReaderKind) {
      case 'song':
        return [
          displaySongTitle(p.trackTitle),
          p.phoneSelected ? '手机传入' : '内置试听',
          '时长 ' + p.durationText,
          '音量 ' + p.volumeText,
          '暂停可接续播放；停止后从头开始。',
        ].join('\n\n')
      case 'connection':
        return [
          p.bridgeText,
          p.diagnosticText,
          '重启后先打开 9 Pro 09g 配套表盘初始化一次；之后播放和停止由原生服务处理。',
        ].join('\n\n')
      case 'license':
        return '© 2026 Leon\n\nGPL-3.0-only\n允许商业使用、修改及按 GPL 第 3 版再分发。\n本程序不提供任何担保。\n\n许可全文随源码及安装包的 common/LICENSE.txt 提供：\nhttps://www.gnu.org/licenses/gpl-3.0.html'
      case 'help':
        return helpText
      default:
        return [
          displaySongTitle(p.trackTitle),
          '进度 ' + p.elapsedText + ' / ' + p.durationText,
          status,
          p.bridgeText,
        ].join('\n\n')
    }
  }
  function project(p) {
    if (!alive) return
    assign(p, 'uiMenuWide', p.uiScreen === 'settings' || p.uiScreen === 'playback')
    syncDisc(p)
    syncLyrics(p)
    const title = displaySongTitle(p.trackTitle)
    if (title !== p.uiTrackTitle) {
      stopTitle()
      p.uiTitleUnavailable = false
      p.uiTrackTitle = title
      scheduleTitle(p)
    }
    assign(p, 'uiHeader', p.uiScreen === 'reader' ? p.uiReaderTitle : titles[p.uiScreen] || '音乐')
    assign(
      p,
      'uiConnection',
      p.bridgeText === '原生服务已连接'
        ? '已连接'
        : p.bridgeText.indexOf('停滞') >= 0
          ? '连接中断'
          : '未连接'
    )
    assign(
      p,
      'uiConnectionStyle',
      'background-color:' +
        (p.uiConnection === '已连接' ? PLAYER_COLORS.success : PLAYER_COLORS.muted) +
        ';'
    )
    assign(
      p,
      'uiSource',
      p.phoneSelected ? '手机音乐' : p.hasSelectedSong ? '内置试听' : '本地音乐'
    )
    assign(
      p,
      'uiPrimaryIcon',
      '/common/icons/' + (p.playing ? 'pause' : p.busy && !p.paused ? 'stop' : 'play') + '.png'
    )
    assign(
      p,
      'uiPrimaryLabel',
      p.stopping
        ? '正在停止'
        : p.pausing
          ? '正在暂停'
          : p.resuming
            ? '正在继续'
            : p.paused
              ? '继续'
              : p.playing
                ? '暂停'
                : p.busy
                  ? '取消准备'
                  : p.hasSelectedSong
                    ? '播放'
                    : '传入歌曲'
    )
    assign(
      p,
      'uiStatus',
      p.errorText
        ? '操作未完成 · 点击查看'
        : p.receiving
          ? '正在接收 · 可查看传歌'
          : p.libraryLoading
            ? '正在读取歌曲清单'
            : p.statusText
    )
    assign(
      p,
      'uiStatusStyle',
      'color:' + (p.errorText ? PLAYER_COLORS.error : PLAYER_COLORS.secondary) + ';'
    )
    assign(
      p,
      'uiSkipStyle',
      'opacity:' + (p.switching || p.busy || p.receiving ? '0.4' : '1') + ';'
    )
    assign(
      p,
      'uiVolumeStyle',
      'opacity:' + (p.playing || p.paused || p.busy || p.receiving ? '0.4' : '1') + ';'
    )
    const failed = /异常|中断|失败|不符|无效|超时|播放器忙|不可用|断开|取消|存满/.test(p.phoneText)
    assign(p, 'uiTransferFailed', failed)
    const saving = /校验|保存歌曲/.test(p.phoneText) && p.receiving
    assign(
      p,
      'uiTransferTitle',
      /传输已取消/.test(p.phoneText)
        ? '传输已取消'
        : failed
          ? '传输需要重试'
          : p.receiving
            ? saving
              ? '正在保存'
              : '正在接收'
            : p.hasPhoneSong
              ? '歌曲已保存'
              : '等待手机发送'
    )
    assign(
      p,
      'uiTransferIcon',
      '/common/icons/' +
        (failed ? 'warning' : p.receiving ? 'phone' : p.hasPhoneSong ? 'success' : 'phone') +
        '.png'
    )
    const match = /接收音乐 (\d+)%/.exec(p.phoneText)
    assign(
      p,
      'uiTransferProgress',
      p.receiving && match
        ? match[1] + '%'
        : p.receiving
          ? '请保持连接'
          : p.hasPhoneSong
            ? '可返回播放'
            : '在手机上选择歌曲'
    )
    assign(p, 'uiReaderText', reader(p))
    const key =
      p.uiScreen +
      '|' +
      (p.uiScreen === 'reader'
        ? p.uiReaderText
        : p.uiScreen === 'library'
          ? JSON.stringify(p.songs) + p.deleteSongId
          : p.uiScreen === 'transfer'
            ? p.phoneText + p.phoneReceiptText
            : '')
    if (key !== contentKey) {
      contentKey = key
      schedule(p)
    }
    syncLibrary(p)
  }
  function resetScrollPosition(p) {
    if (typeof p.$element !== 'function') return
    try {
      const e = p.$element('content-scroll')
      if (e && typeof e.scrollTo === 'function')
        e.scrollTo({
          top: 0,
          behavior: 'instant',
        })
    } catch (e) {
      return false
    }
  }
  function navigate(p, screen) {
    if (!alive) return
    stopLyric()
    stopTitle()
    if (screen === 'home' || screen === 'disc') p.uiTitleUnavailable = false
    p.uiScreen = screen
    p.songList = screen === 'library'
    p.details = screen === 'settings'
    reset(p)
    project(p)
    // Content is shared by internal views; reset after Vela applies the new template.
    schedule(p)
    resetScrollPosition(p)
    scheduleTitle(p)
  }
  Object.assign(player.private, {
    uiSkipStyle: '',
    uiAwakeEnabled: false,
    uiAwakeText: '已关闭',
    uiDiscSpinning: false,
    uiDiscStyle: idleDiscStyle,
    uiDiscCoverUri: '',
    uiDiscPrevious: '',
    uiDiscCurrent: '暂无歌词',
    uiDiscNext: '',
    uiMenuWide: false,
    uiLyricLine: '暂无歌词 · 点击查看',
    uiLyricsText: '',
    uiLyricUnavailable: false,
    uiTrackTitle: '',
    uiTitleUnavailable: false,
    uiScreen: 'home',
    uiHeader: '正在播放',
    uiConnection: '未连接',
    uiConnectionStyle: '',
    uiTransferFailed: false,
    uiSource: '内置试听',
    uiPrimaryIcon: '/common/icons/play.png',
    uiPrimaryLabel: '播放',
    uiStatus: '选择歌曲，点击播放',
    uiStatusStyle: '',
    uiVolumeStyle: '',
    uiTransferTitle: '等待手机发送',
    uiTransferIcon: '/common/icons/phone.png',
    uiTransferProgress: '在手机上选择歌曲',
    uiReaderKind: 'status',
    uiReaderTitle: '播放状态',
    uiReaderText: '',
    uiReturnScreen: 'home',
    uiScrollVisible: false,
    uiScrollStyle: 'height:96px;top:0px;',
    receiving: false,
    libraryLoading: false,
  })
  const original = {}
  Object.keys(player).forEach(name => {
    if (typeof player[name] === 'function') original[name] = player[name]
  })
  Object.keys(original).forEach(name => {
    player[name] = function (...args) {
      if (name === 'onInit') {
        page = this
        ready = false
        titleAttempts = 0
        alive = true
        visible = false
        this.uiScreen = 'home'
        reset(this)
      }
      if (name === 'onShow') {
        visible = true
        awake.set(awakeEnabled)
        this.uiLyricUnavailable = false
        if (this.uiTitleUnavailable) titleAttempts = 0
        this.uiTitleUnavailable = false
      }
      if (name === 'onHide' || name === 'onDestroy') {
        this.deleteSongId = ''
        this.deleteSongTitle = ''
        stopLyric()
        stopTitle()
        stopLibrary()
        visible = false
        this.uiDiscSpinning = false
        stopDisc(this)
        awake.set(false)
        reset(this)
      }
      if (name === 'onDestroy') {
        alive = false
        ready = false
        awake.dispose()
        page = null
      }
      if (name === 'exitApp') {
        visible = false
        this.uiDiscSpinning = false
        stopDisc(this)
        awake.set(false)
      }
      const result = original[name].apply(this, args)
      if (
        name === 'chooseSong' &&
        !this.deleteSongId &&
        ['已选歌曲，点击播放', '正在停止当前曲并切换'].includes(this.statusText) &&
        (this.uiScreen === 'library' || this.uiScreen === 'transfer')
      )
        navigate(this, 'home')
      project(this)
      if (name === 'onShow') {
        schedule(this)
        scheduleTitle(this)
      }
      if (result && typeof result.then === 'function')
        return result.then(
          value => {
            project(this)
            return value
          },
          error => {
            project(this)
            throw error
          }
        )
      return result
    }
  })
  const previousLibraryPage = player.previousLibraryPage,
    nextLibraryPage = player.nextLibraryPage
  Object.assign(player, {
    updatePresentation() {
      project(this)
    },
    previousLibraryPage() {
      previousLibraryPage.call(this)
      reset(this)
      resetScrollPosition(this)
      schedule(this)
      project(this)
    },
    nextLibraryPage() {
      nextLibraryPage.call(this)
      reset(this)
      resetScrollPosition(this)
      schedule(this)
      project(this)
    },
    onReady() {
      ready = true
      project(this)
      schedule(this)
      scheduleTitle(this)
      scheduleLyric(this)
      syncLibrary(this)
    },
    openSongs() {
      original.openSongs.call(this)
      navigate(this, 'library')
    },
    toggleDetails() {
      this.uiScreen === 'home' ? navigate(this, 'settings') : this.uiBack()
    },
    uiLyrics() {
      lyricsReturn = this.uiScreen === 'disc' ? 'disc' : 'home'
      navigate(this, 'lyrics')
    },
    uiDisc() {
      navigate(this, 'disc')
    },
    uiToggleAwake() {
      if (this.uiAwakeText.indexOf('未生效') !== 0) awakeEnabled = !awakeEnabled
      this.uiAwakeEnabled = awakeEnabled
      awake.set(visible && awakeEnabled)
    },
    uiTransfer() {
      navigate(this, 'transfer')
    },
    uiSettings() {
      navigate(this, 'settings')
    },
    uiPlaybackSettings() {
      navigate(this, 'playback')
    },
    uiHome() {
      navigate(this, 'home')
    },
    uiBack() {
      if (this.deleteSongId) {
        this.cancelDeleteSong()
        return
      }
      if (this.uiScreen === 'reader') navigate(this, this.uiReturnScreen)
      else if (this.uiScreen === 'lyrics') navigate(this, lyricsReturn)
      else if (this.uiScreen === 'playback') navigate(this, 'settings')
      else navigate(this, 'home')
    },
    onBackPress() {
      if (this.deleteSongId) {
        this.cancelDeleteSong()
        return true
      }
      if (this.uiScreen === 'home') return false
      this.uiBack()
      return true
    },
    uiPrimary() {
      if (this.receiving) {
        this.uiTransfer()
        return
      }
      if (this.switching || this.pausing || this.resuming || this.stopping) return
      if (this.busy) {
        if (!this.playing && !this.paused) return this.stop()
        return
      }
      return this.paused ? this.resume() : this.playing ? this.pause() : this.play()
    },
    uiStatusDetails() {
      if (this.receiving) {
        this.uiTransfer()
        return
      }
      this.uiOpenReader('status', '播放状态')
    },
    uiOpenReader(kind, title) {
      this.uiReturnScreen = this.uiScreen
      this.uiReaderKind = kind
      this.uiReaderTitle = title
      navigate(this, 'reader')
    },
    uiSongDetails() {
      this.uiOpenReader('song', '歌曲详情')
    },
    uiConnectionDetails() {
      this.uiOpenReader('connection', '连接信息')
    },
    uiReadState() {
      this.uiOpenReader('status', '播放状态')
      return this.readState()
    },
    uiLicense() {
      this.uiOpenReader('license', '许可说明')
    },
    uiHelp() {
      this.uiOpenReader('help', '使用说明')
    },
    uiReload() {
      return this.readState()
    },
    onContentScroll(event) {
      if (!alive || !visible) return
      offset = Number(event && event.scrollY)
      progress(this)
    },
    onContentTop() {
      if (!alive || !visible) return
      offset = 0
      progress(this)
    },
    onContentBottom() {
      if (!alive || !visible) return
      offset = Math.max(0, contentHeight - viewportHeight)
      progress(this)
    },
    measureContent() {
      measure(this)
    },
  })
  return player
}
