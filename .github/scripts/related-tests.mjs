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
    const header = out.subarray(pos, headerEnd).toString().split(' ')
    // サブモジュール・ない物は、本文なしの「<名前> submodule」「<名前> missing」の1行だけが返る
    if (header.length < 3) {
      contents.push('')
      pos = headerEnd + 1
      continue
    }
    const size = Number(header[2])
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

// import・require・jest.mock・vi.mock などの参照先（前にある ' などに引きずられないよう、書き方を決めて探す）
const MODULE_REF =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\b(?:jest|vi)\.(?:mock|doMock|unmock|requireActual|importActual)\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm
// .ts・.tsx 以外のファイルは、ファイル名で終わる文字列で探す
const escaped = implName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PATH_REF = new RegExp(`(['"\`])([^'"\`\\n]*${escaped})\\1`, 'g')
const contents = readAll(tests)
tests.forEach((testPath, i) => {
  for (const m of contents[i].matchAll(isModule ? MODULE_REF : PATH_REF)) {
    if (refersTo(testPath, m[2])) {
      console.log(testPath)
      return
    }
  }
})
