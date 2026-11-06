// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// Browser approximation of the actual newly compiled 10 Pro template, not a device screenshot.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { harness } from '../tests/rpk/player_harness.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, '10p/rpk/build/pages/index/player.js'), 'utf8')
const styleValue = s =>
  typeof s === 'string'
    ? Object.fromEntries(
        s
          .split(';')
          .filter(x => x.includes(':'))
          .map(x => {
            const i = x.indexOf(':')
            return [x.slice(0, i).trim(), x.slice(i + 1).trim()]
          })
      )
    : s
const sandbox = {
  console,
  setTimeout: () => 1,
  clearTimeout() {},
  setInterval: () => 1,
  clearInterval() {},
  $translateStyle$: styleValue,
  $app_require$: () => ({}),
  aiot: {
    __cf__: (o, render) =>
      Array.from(o.__opts__.exp().__list__).flatMap((item, index) => render(index, item)),
    __ce__: (type, o, children) => ({
      type,
      options: o.__opts__,
      children: children.flat(Infinity),
    }),
    __ci__: (o, render) => (o.__opts__.shown() ? render() : []),
  },
}
const factory = vm.runInNewContext('(' + source.replace(/^export default /, '') + ')', sandbox)
const entries = {},
  exports = {}
factory(sandbox, sandbox, sandbox, entries, () => {})
entries.entry(exports)
const compiled = exports.default
const escape = s =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
const value = x => (typeof x === 'function' ? x() : x)
const kebab = s => s.replace(/[A-Z]/g, m => '-' + m.toLowerCase())
const declarations = object =>
  Object.entries(object || {})
    .map(([k, v]) => kebab(k) + ':' + v)
    .join(';')
const css = compiled.style
  .flatMap(([selectors, props]) => {
    if (selectors.length !== 1 || selectors[0][0] !== 0) return []
    return (
      '.' +
      selectors[0][1] +
      '{' +
      declarations(props) +
      (props.lines
        ? ';display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:' + props.lines
        : '') +
      '}'
    )
  })
  .join('\n')
function render(n) {
  if (Array.isArray(n)) return n.map(render).join('')
  const o = n.options || {}
  if (o.show !== undefined && !value(o.show)) return ''
  const style = value(o.style),
    classes = value(o.classList) || []
  const attrs =
    ' class="' +
    escape(Array.isArray(classes) ? classes.join(' ') : classes) +
    '" style="' +
    escape(typeof style === 'string' ? style : declarations(style)) +
    '"'
  if (n.type === 'image') {
    const uri = value(o.src)
    if (!uri) return ''
    if (!uri.startsWith('/common/')) return '<div' + attrs + '></div>'
    const bytes = fs.readFileSync(path.join(root, '10p/rpk/src', uri))
    return '<img' + attrs + ' alt="" src="data:image/png;base64,' + bytes.toString('base64') + '">'
  }
  if (n.type === 'text' || n.type === 'marquee')
    return '<span' + attrs + '>' + escape(value(o.value)) + '</span>'
  return '<div' + attrs + '>' + render(n.children || []) + '</div>'
}
const scenes = []
async function capture(name, count, setup = () => {}) {
  const h = await harness('10p', count)
  try {
    setup(h.page)
    h.page.updatePresentation()
    scenes.push({ name, html: render(compiled.template(h.page)) })
  } finally {
    h.close()
  }
}
await capture('01 · 空歌单', 0)
await capture('02 · 手机歌曲清单', 3, p => p.openSongs())
await capture('03 · 设置', 3, p => p.uiSettings())
await capture('04 · 帮助', 3, p => p.uiHelp())
await capture('05 · GPL 许可', 3, p => p.uiLicense())
const base = /* CSS */ `
* {
  box-sizing: border-box;
  flex-shrink: 0;
}
html,
body {
  margin: 0;
  width: 336px;
  height: 480px;
  background: #111217;
  color: #fff;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
div {
  display: flex;
}
span {
  display: block;
  white-space: pre-wrap;
  overflow: hidden;
}
img {
  object-fit: contain;
}
.viewport {
  width: 336px;
  height: 480px;
  overflow: hidden;
}
.scroll-shell {
  position: relative;
}
.content-scroll {
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}
.content-scroll::-webkit-scrollbar {
  display: none;
}
.scroll-track {
  background: #4d5669;
  width: 5px;
  border-radius: 3px;
}
.scroll-fill {
  background: #cdd0e8;
  width: 5px;
  border-radius: 3px;
}
`
const frameScript = `
const update = () =>
  document.querySelectorAll('.scroll-shell').forEach((shell) => {
    const view = shell.querySelector('.content-scroll'),
      rail = shell.querySelector('.scroll-track'),
      fill = shell.querySelector('.scroll-fill')
    if (!view || !rail || !fill) return
    const max = view.scrollHeight - view.clientHeight,
      h = rail.clientHeight || 96
    rail.style.display = max > 0 ? 'flex' : 'none'
    fill.style.height =
      Math.min(h, Math.max(22, (h * view.clientHeight) / Math.max(1, view.scrollHeight))) + 'px'
    fill.style.position = 'absolute'
    fill.style.top = (max > 0 ? (view.scrollTop / max) * (h - fill.offsetHeight) : 0) + 'px'
  })
document
  .querySelectorAll('.content-scroll')
  .forEach((view) => view.addEventListener('scroll', update))
addEventListener('load', update)
addEventListener('message', async (event) => {
  if (event.source !== parent || event.data?.command !== 'capture') return
  const requestId = event.data.requestId
  try {
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})))
    const original = document.querySelector('.viewport'),
      clone = original.cloneNode(true),
      views = original.querySelectorAll('.content-scroll'),
      copies = clone.querySelectorAll('.content-scroll')
    views.forEach((view, i) => {
      if (!view.scrollTop && !view.scrollLeft) return
      ;[...copies[i].children].forEach((child, j) => {
        const transform = getComputedStyle(view.children[j]).transform
        child.style.transform =
          'translate(' +
          -view.scrollLeft +
          'px,' +
          -view.scrollTop +
          'px) ' +
          (transform === 'none' ? '' : transform)
      })
    })
    const element = document.createElementNS('http://www.w3.org/1999/xhtml', 'div')
    element.innerHTML = '<style>' + document.querySelector('style').textContent + '</style>'
    element.append(clone)
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="336" height="480"><foreignObject width="336" height="480">' +
      new XMLSerializer().serializeToString(element) +
      '</foreignObject></svg>'
    parent.postMessage({ requestId, svg }, '*')
  } catch (error) {
    parent.postMessage({ requestId, error: String(error) }, '*')
  }
})
`
const frames = scenes.map(scene => ({
  name: scene.name,
  source:
    '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'"><style>' +
    base +
    css +
    '</style></head><body><div class="viewport">' +
    scene.html +
    '</div><script>' +
    frameScript +
    '</script></body></html>',
}))
const page = /* HTML */ `
  <!doctype html>
  <html lang="zh-CN">
    <meta charset="utf-8" />
    <title>10 Pro RPK 实际模板预览</title>
    <style>
      body {
        background: #0b0d12;
        color: #eee;
        font: 16px system-ui;
        padding: 24px;
      }
      main {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
      }
      section {
        width: 336px;
      }
      iframe {
        display: block;
        border: 1px solid #464c5c;
        width: 336px;
        height: 480px;
      }
      button {
        margin: 12px 0;
        padding: 8px;
      }
      p {
        max-width: 1000px;
      }
    </style>
    <h1>10 Pro · RPK 本地审查预览</h1>
    <p>
      来自本次构建的真实模板与样式，336×480
      设计坐标。已替换几何图片、空内置歌单。浏览器映射只展示审查场景，不代表设备字形、动画、蓝牙或播放验收；按钮不执行业务操作。每页可独立滚动并导出当前视口。
    </p>
    <main></main>
    <script>
      const scenes = ${JSON.stringify(frames).replaceAll('<', '\\u003c')},
        pending = new Map()
      for (const scene of scenes) {
        const section = document.createElement('section'),
          title = document.createElement('h2'),
          frame = document.createElement('iframe'),
          button = document.createElement('button')
        title.textContent = scene.name
        frame.sandbox = 'allow-scripts'
        frame.srcdoc = scene.source
        button.textContent = '截图 PNG · 336 × 480'
        button.onclick = () => {
          button.disabled = true
          const requestId = crypto.randomUUID()
          const timer = setTimeout(() => {
            pending.delete(requestId)
            button.disabled = false
            button.textContent = '导出超时，点击重试'
          }, 8000)
          pending.set(requestId, { frame, button, timer, name: scene.name })
          frame.contentWindow.postMessage({ command: 'capture', requestId }, '*')
        }
        section.append(title, frame, button)
        document.querySelector('main').append(section)
      }
      addEventListener('message', async event => {
        const entry = pending.get(event.data?.requestId)
        if (!entry || event.source !== entry.frame.contentWindow) return
        pending.delete(event.data.requestId)
        clearTimeout(entry.timer)
        try {
          if (event.data.error) throw new Error(event.data.error)
          const image = new Image()
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(event.data.svg)
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = 336
          canvas.height = 480
          canvas.getContext('2d').drawImage(image, 0, 0)
          const a = document.createElement('a')
          a.download = entry.name + '-336x480.png'
          a.href = canvas.toDataURL('image/png')
          a.click()
          entry.button.textContent = '截图 PNG · 336 × 480'
        } catch (error) {
          entry.button.textContent = '导出失败，点击重试'
          console.error(error)
        } finally {
          entry.button.disabled = false
        }
      })
    </script>
  </html>
`
fs.mkdirSync(path.join(root, '.local-review'), { recursive: true })
fs.writeFileSync(path.join(root, '.local-review/ui-preview.html'), page)
console.log(
  'Generated',
  scenes.length,
  'scenes from current compiled template: .local-review/ui-preview.html'
)
