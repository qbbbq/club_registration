import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

// 宝塔会在站点根目录生成 .user.ini，并可能设置不可变属性。
// Vite 的 emptyOutDir 会尝试删除它并报 EPERM，所以这里清理时保留它。
const distDir = path.resolve('dist')
const keep = new Set(['.user.ini'])

try {
  const entries = await readdir(distDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => !keep.has(entry.name))
      .map((entry) => rm(path.join(distDir, entry.name), { recursive: true, force: true }))
  )
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error
  }
}
