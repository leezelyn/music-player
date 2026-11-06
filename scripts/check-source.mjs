// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const license = 'GPL-3.0-only'
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const json = p => JSON.parse(read(p))
const hash = buffer => crypto.createHash('sha256').update(buffer).digest('hex')
const fail = message => {
  throw new Error(message)
}
const assert = (condition, message) => {
  if (!condition) fail(message)
}
const ignored = new Set([
  '.git',
  'node_modules',
  'build',
  'dist',
  'validation',
  '__pycache__',
  '.local-review',
])
function walk(directory) {
  const result = []
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(item.name)) continue
    const p = path.join(directory, item.name)
    assert(!item.isSymbolicLink(), 'Unexpected symlink: ' + path.relative(root, p))
    if (item.isDirectory()) result.push(...walk(p))
    else result.push(p)
  }
  return result
}
const files = walk(root)
const topAllowed = new Set(['10', '10p', '9p', 'tests', 'scripts', 'docs', 'licenses'])
for (const file of files) {
  const relative = path.relative(root, file),
    parts = relative.split(path.sep)
  if (parts.length > 1) assert(topAllowed.has(parts[0]), 'Unexpected directory: ' + relative)
  assert(
    !/\.(?:c|h|s|lua|elf|hpm|face|aar|apk|pem|p12|jks|keystore|s8|bin)$/i.test(relative),
    'Private or excluded file: ' + relative
  )
  if (['.js', '.mjs', '.py', '.ux', '.json', '.md', '.txt', ''].includes(path.extname(file))) {
    const text = fs.readFileSync(file, 'utf8')
    assert(
      !/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text),
      'Private key content: ' + relative
    )
    assert(!/https?:\/\/[^\s/:@]+:[^\s/@]+@/.test(text), 'Credential URL: ' + relative)
    assert(
      [
        'scripts/check-source.mjs',
        'tests/rpk/test_public_boundary.mjs',
        'package-lock.json',
      ].includes(relative) ||
        !/\b(?:sih|fs|aw|gh)\d{4,5}\b|寄存器|\b(?:PGA|PWM|FIFO)\b|包络/i.test(text),
      'Excluded hardware research: ' + relative
    )
  }
}
const rootPackage = json('package.json'),
  lock = json('package-lock.json')
assert(rootPackage.license === license, 'Root license mismatch')
assert(rootPackage.private === true, 'Root must not be published to npm')
assert(lock.lockfileVersion === 3, 'Expected npm lockfile v3')
assert(lock.packages[''].license === license, 'Root lock license mismatch')
assert(
  read('LICENSE').includes('GNU GENERAL PUBLIC LICENSE') &&
    read('LICENSE').includes('Version 3, 29 June 2007'),
  'Unexpected official license text'
)
assert(read('NOTICE').includes('Copyright (c) 2026 Leon'), 'Missing copyright notice')
let imports = 0
const models = { 10: [212, '0.2.43', 67], '10p': [336, '0.2.41', 65], '9p': [336, '0.2.41', 65] }
for (const [model, [width, version, code]] of Object.entries(models)) {
  const base = model + '/rpk',
    pkg = json(base + '/package.json'),
    manifest = json(base + '/src/manifest.json')
  assert(
    pkg.license === license && pkg.private === true,
    'Workspace license/private mismatch: ' + model
  )
  assert(pkg.name === '@huanjian/rpk-' + model, 'Workspace name mismatch: ' + model)
  assert(
    pkg.version === version && manifest.versionName === version && manifest.versionCode === code,
    'Version changed: ' + model
  )
  assert(
    manifest.package === 'com.tse.musicplayer' && manifest.config.designWidth === width,
    'Identity/profile changed: ' + model
  )
  assert(manifest.minPlatformVersion === 1000, 'API floor changed: ' + model)
  assert(lock.packages[base]?.license === license, 'Workspace missing from lock: ' + model)
  assert(
    pkg.devDependencies['aiot-toolkit'] === '2.0.5' &&
      pkg.devDependencies['@aiot-toolkit/jsc'] === '1.0.9',
    'Unpinned tools: ' + model
  )
  assert(
    json(base + '/src/common/sample.json').variants.length === 0,
    'Bundled commercial sample: ' + model
  )
  const embedded = read(base + '/src/common/LICENSE.txt')
  assert(
    embedded.includes(read('LICENSE').trim()) && embedded.includes('Copyright (c) 2026 Leon'),
    'Missing embedded terms: ' + model
  )
  const source = path.join(root, base, 'src')
  for (const file of walk(source)) {
    if (!['.js', '.ux'].includes(path.extname(file))) continue
    const text = fs.readFileSync(file, 'utf8')
    assert(text.includes('SPDX-License-Identifier: ' + license), 'Missing source license: ' + file)
    for (const match of text.matchAll(/\bimport(?:[\s\S]*?\bfrom\s*|\s*)(['"])([^'"\n]+)\1/g)) {
      const dependency = match[2]
      imports++
      if (dependency.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), dependency)
        assert(
          resolved.startsWith(source + path.sep) && fs.existsSync(resolved),
          'Import escapes source or is missing: ' + dependency
        )
      } else
        assert(dependency.startsWith('@system.'), 'Unexpected runtime dependency: ' + dependency)
    }
    for (const match of text.matchAll(/\/common\/[A-Za-z0-9_./-]+\.png/g)) {
      assert(fs.existsSync(path.join(source, match[0])), 'Missing image: ' + match[0])
    }
  }
}
const generated = json('docs/generated-assets.json')
const expectedImages = new Set(generated.map(row => path.resolve(root, row.path)))
const actualImages = files.filter(file => file.endsWith('.png'))
assert(expectedImages.size === actualImages.length, 'Unlisted images present')
for (const row of generated) {
  const file = path.resolve(root, row.path),
    data = fs.readFileSync(file)
  assert(
    expectedImages.has(file) && hash(data) === row.sha256,
    'Generated image changed: ' + row.path
  )
  assert(
    data.readUInt32BE(16) === row.width && data.readUInt32BE(20) === row.height,
    'PNG size mismatch: ' + row.path
  )
}
console.log(
  JSON.stringify(
    {
      ok: true,
      files: files.length,
      models: 3,
      generatedImages: generated.length,
      importsChecked: imports,
      privatePayloads: 0,
      license,
    },
    null,
    2
  )
)
