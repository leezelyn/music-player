// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// AIoT 2.0.5 can return zero after an error; require a newly generated RPK.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const models = ['10', '10p', '9p'],
  selected = process.argv[2]
if (selected && !models.includes(selected)) throw new Error('Model must be 10, 10p or 9p')
for (const model of selected ? [selected] : models) {
  const directory = path.join(root, model, 'rpk')
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'src/manifest.json'), 'utf8'))
  const output = path.join(
    directory,
    'dist',
    manifest.package + '.debug.' + manifest.versionName + '.rpk'
  )
  fs.rmSync(output, { force: true })
  const npm = process.env.npm_execpath
  const result = npm
    ? spawnSync(process.execPath, [npm, 'run', 'build', '--workspace', '@huanjian/rpk-' + model], {
        cwd: root,
        stdio: 'inherit',
      })
    : spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'build', '--workspace', '@huanjian/rpk-' + model],
        { cwd: root, stdio: 'inherit' }
      )
  if (result.error) throw result.error
  if (result.status !== 0 || !fs.existsSync(output))
    throw new Error('Build failed or generated no fresh RPK: ' + model)
  const data = fs.readFileSync(output)
  if (data.length < 22 || data.readUInt32LE(0) !== 0x04034b50)
    throw new Error('Invalid RPK container: ' + model)
  console.log('Verified fresh RPK:', path.relative(root, output), '(' + data.length + ' bytes)')
}
