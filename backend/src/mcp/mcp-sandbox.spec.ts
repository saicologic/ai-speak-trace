import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * MCP サーバーを sandbox（macOS の sandbox-exec）の中で起動する仕組みのテスト
 * sandbox-exec は macOS にしかないため、ほかの OS（CI の ubuntu）では飛ばす。
 * Claude Code のサンドボックスの中でも飛ばすため、開発者が自分のターミナルで流して確かめる
 */
const BACKEND_DIR = path.resolve(__dirname, '../..');
const SCRIPT = path.join(BACKEND_DIR, 'scripts/mcp-sandbox.sh');
const PROFILE = path.join(BACKEND_DIR, 'scripts/mcp-sandbox.sb');
const MAIN = path.join(BACKEND_DIR, 'dist/mcp/main.js');
const NODE = process.execPath;

/**
 * sandbox-exec でサンドボックスを作れるか。
 * sandbox-exec は macOS にしかない。また、すでにサンドボックスの中（Claude Code の Bash など）では、
 * もう1つサンドボックスを作れない（sandbox_apply: Operation not permitted）。
 * それ以外の理由で作れないときは、黙って飛ばさずに失敗させる（このテストを流すのは開発者の Mac だけのため）
 */
function canUseSandboxExec(): boolean {
  if (process.platform !== 'darwin') return false;
  const probe = spawnSync(
    '/usr/bin/sandbox-exec',
    ['-p', '(version 1)(allow default)', '/usr/bin/true'],
    { encoding: 'utf-8' },
  );
  if (probe.status === 0) return true;
  if (/sandbox_apply: Operation not permitted/.test(probe.stderr ?? '')) {
    console.warn(
      'サンドボックスの中のため、MCP サーバーの sandbox のテストを飛ばします。自分のターミナルで流してください',
    );
    return false;
  }
  throw new Error(
    `sandbox-exec を動かせません: ${probe.error?.message ?? probe.stderr}`,
  );
}

// eslint-disable-next-line no-restricted-properties -- macOS 以外と、サンドボックスの中では確かめられないため（開発者のターミナルで流す）
const describeOnMac = canUseSandboxExec() ? describe : describe.skip;

describeOnMac('MCP サーバーの sandbox', () => {
  /** 仮のホームフォルダ（この中にデータのフォルダと、読まれたくないファイルを置く） */
  let home: string;
  let dataDir: string;
  let secret: string;

  beforeAll(() => {
    if (!fs.existsSync(MAIN)) {
      execFileSync('npm', ['run', 'mcp:build'], {
        cwd: BACKEND_DIR,
        stdio: 'ignore',
      });
    }
  }, 120_000);

  beforeEach(() => {
    // sandbox-exec はシンボリックリンクを解決したパスで比べるため、実際のパスにする
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sb-')));
    dataDir = path.join(home, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    secret = path.join(home, '.aws-credentials');
    fs.writeFileSync(secret, 'secret');
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** sandbox の中で node のコードを動かし、終了コードを返す */
  function runInSandbox(code: string): number {
    const result = spawnSync(
      '/usr/bin/sandbox-exec',
      [
        '-f',
        PROFILE,
        '-D',
        `HOME_DIR=${home}`,
        '-D',
        `DATA_DIR=${dataDir}`,
        '-D',
        `BACKEND_DIR=${BACKEND_DIR}`,
        '-D',
        `NODE_DIR=${path.dirname(path.dirname(fs.realpathSync(NODE)))}`,
        NODE,
        '-e',
        code,
      ],
      { encoding: 'utf-8', timeout: 30_000 },
    );
    return result.status ?? -1;
  }

  it('sandbox の中で起動しても、ツールを呼べて、監査ログを書ける', async () => {
    const transport = new StdioClientTransport({
      command: SCRIPT,
      args: [NODE],
      env: { HOME: home, DATA_DIR: dataDir, PATH: '/usr/bin:/bin' },
      stderr: 'ignore',
    });
    const client = new Client({ name: 'sandbox-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain('list_transcriptions');
      const result = await client.callTool({
        name: 'list_transcriptions',
        arguments: {},
      });
      expect(result.isError).not.toBe(true);
      expect(fs.readdirSync(path.join(dataDir, 'mcp-audit-logs'))).toHaveLength(
        1,
      );
    } finally {
      await client.close();
    }
  }, 30_000);

  it('node が多段のシンボリックリンクでも、実体のフォルダを sandbox に渡す', () => {
    // link2 → link1 → node の実体（nvm・asdf などで起こる形）
    const links = path.join(home, 'a/b');
    const middle = path.join(home, 'c/d');
    fs.mkdirSync(links, { recursive: true });
    fs.mkdirSync(middle, { recursive: true });
    fs.symlinkSync(fs.realpathSync(NODE), path.join(middle, 'link1'));
    fs.symlinkSync(path.join(middle, 'link1'), path.join(links, 'link2'));
    // MCP_SANDBOX_DRY_RUN=1 は、起動せずに sandbox に渡す値を表示する
    const result = spawnSync(SCRIPT, [path.join(links, 'link2')], {
      encoding: 'utf-8',
      env: {
        HOME: home,
        DATA_DIR: dataDir,
        PATH: '/usr/bin:/bin',
        MCP_SANDBOX_DRY_RUN: '1',
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `NODE_DIR=${path.dirname(path.dirname(fs.realpathSync(NODE)))}\n`,
    );
  });

  it('node を実行できないときは、理由を示して止まる', () => {
    const result = spawnSync(SCRIPT, [path.join(home, 'no-node')], {
      encoding: 'utf-8',
      env: { HOME: home, DATA_DIR: dataDir, PATH: '/usr/bin:/bin' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('node を実行できません');
  });

  it.each([
    ['ホームフォルダと同じ', (base: string) => path.join(base, 'home')],
    ['ホームフォルダの親', (base: string) => path.join(base, 'x/home')],
  ])(
    'node のフォルダが%sになるときは、読み取りを制限できないため止まる',
    (_, homeOf) => {
      // node を入れたフォルダ（bin/node の2つ上）が、ホームフォルダかその親になる配置
      const base = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sb-node-')),
      );
      try {
        const fakeHome = homeOf(base);
        const binDir = path.join(
          path.dirname(fakeHome) === base ? fakeHome : base,
          'bin',
        );
        fs.mkdirSync(fakeHome, { recursive: true });
        fs.mkdirSync(binDir, { recursive: true });
        const fakeNode = path.join(binDir, 'node');
        fs.writeFileSync(fakeNode, '#!/bin/sh\n', { mode: 0o755 });
        const result = spawnSync(SCRIPT, [fakeNode], {
          encoding: 'utf-8',
          env: {
            HOME: fakeHome,
            DATA_DIR: path.join(fakeHome, 'data'),
            PATH: '/usr/bin:/bin',
            MCP_SANDBOX_DRY_RUN: '1',
          },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('ホームフォルダを含む');
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    },
  );

  it('node のフォルダがルート（/）になるときも、止まる', () => {
    // /bin にある実行できるファイル（/bin/sh）を node として渡すと、node のフォルダは / になる
    const result = spawnSync(SCRIPT, ['/bin/sh'], {
      encoding: 'utf-8',
      env: {
        HOME: home,
        DATA_DIR: dataDir,
        PATH: '/usr/bin:/bin',
        MCP_SANDBOX_DRY_RUN: '1',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('ホームフォルダを含む');
  });

  it('外部に通信できない', async () => {
    const server = http.createServer((_, res) => res.end('ok'));
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      // 通信できれば 0、できなければ 1 で終わる
      const code = `fetch('http://127.0.0.1:${port}/').then(() => process.exit(0), () => process.exit(1))`;
      expect(runInSandbox(code)).toBe(1);
    } finally {
      server.close();
    }
  });

  it('監査ログのフォルダ以外には書き込めない', () => {
    const write = (file: string) =>
      `try { require('fs').mkdirSync(require('path').dirname(${JSON.stringify(file)}), { recursive: true }); require('fs').writeFileSync(${JSON.stringify(file)}, 'x'); process.exit(0) } catch { process.exit(1) }`;
    expect(
      runInSandbox(write(path.join(dataDir, 'mcp-audit-logs/a.jsonl'))),
    ).toBe(0);
    expect(
      runInSandbox(write(path.join(dataDir, 'transcriptions/x.json'))),
    ).toBe(1);
    expect(runInSandbox(write(path.join(home, 'x.txt')))).toBe(1);
  });

  it('ホームフォルダのうち、データのフォルダ以外は読めない', () => {
    fs.writeFileSync(path.join(dataDir, 'ok.txt'), 'ok');
    const read = (file: string) =>
      `try { require('fs').readFileSync(${JSON.stringify(file)}); process.exit(0) } catch { process.exit(1) }`;
    expect(runInSandbox(read(path.join(dataDir, 'ok.txt')))).toBe(0);
    expect(runInSandbox(read(secret))).toBe(1);
  });
});
