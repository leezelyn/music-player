// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Leon
// Serialize system requests: a late enable callback must be followed by disable on hide.
export function createScreenAwake(brightness, changed = () => {}) {
  let desired = false,
    applied = false,
    pending = null,
    failed = null,
    disposed = false
  const emit = () => changed({ desired, applied, pending, error: failed !== null })
  function drive() {
    if (pending !== null || desired === applied || failed === desired) {
      emit()
      return
    }
    const target = desired
    pending = target
    emit()
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true
      pending = null
      if (ok) {
        applied = target
        failed = null
      } else {
        applied = null
        failed = target
      }
      emit()
      if (desired !== target || ok) drive()
    }
    try {
      brightness.setKeepScreenOn({
        keepScreenOn: target,
        success: () => finish(true),
        fail: () => finish(false),
        complete: () => {
          if (!settled) finish(false)
        },
      })
    } catch (e) {
      finish(false)
    }
  }
  return {
    set(value) {
      if (disposed) return
      desired = !!value
      failed = null
      drive()
    },
    dispose() {
      disposed = true
      desired = false
      failed = null
      drive()
    },
  }
}
