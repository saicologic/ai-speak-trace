#!/usr/bin/env node
// 実装のファイルを参照しているテストのファイルを、指定したコミットの中から探し、1行に1つずつ出す
// 参照は、テストの中の文字列で判断する
// - './foo'・'../Foo' などの相対パス: import・jest.mock・vi.mock の参照先を、拡張子と index を補ってたどる
// - .ts・.tsx 以外のファイル（スクリプトなど）: 'scripts/run.sh' のようなパスの文字列の後ろが一致するか
// 使い方: node related-tests.mjs <commit> <impl-path>
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const [commit, impl] = process.argv.slice(2)
if (!commit || !impl) {
  console.error('使い方: related-tests.mjs <commit> <impl-path>')
  process.exit(2)
}

const TEST_FILE = /^(backend\/src\/.*\.spec\.ts|frontend\/src\/.*\.test\.tsx?)$/
const isModule = ['.ts', '.tsx'].includes(path.posix.extname(impl))
const implName = path.posix.basename(impl)

const tests = execFileSync('git', ['ls-tree', '-r', '-z', '--name-only', commit, '--', 'backend/src', 'frontend/src'], {
  encoding: 'utf-8',
})
  .split('\0')
  .filter((f) => TEST_FILE.test(f))

/** テストのファイルの中身を、まとめて読む（git cat-file --batch） */
function readAll(files) {
  if (files.length === 0) return []
  const out = execFileSync('git', ['cat-file', '--batch'], {
    input: files.map((f) => `${commit}:${f}\n`).join(''),
    maxBuffer: 256 * 1024 * 1024,
  })
  const contents = []
  let pos = 0
  for (let i = 0; i < files.length; i++) {
    const headerEnd = out.indexOf(0x0a, pos)
    const size = Number(out.subarray(pos, headerEnd).toString().split(' ')[2])
    contents.push(out.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf-8'))
    pos = headerEnd + 1 + size + 1
  }
  return contents
}

function refersTo(testPath, literal) {
  if (literal === '.' || literal === '..' || literal.startsWith('./') || literal.startsWith('../')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(testPath), literal))
    const candidates = [target, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx'].map((e) => target + e)]
    return candidates.includes(impl)
  }
  if (!isModule && literal.endsWith(implName)) {
    const rel = literal.replace(/^\/+/, '')
    return impl === rel || impl.endsWith('/' + rel)
  }
  return false
}

const LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g
const contents = readAll(tests)
tests.forEach((testPath, i) => {
  for (const m of contents[i].matchAll(LITERAL)) {
    if (refersTo(testPath, m[2])) {
      console.log(testPath)
      return
    }
  }
})
