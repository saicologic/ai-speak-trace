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
 * sandbox-exec は macOS にしかないため、ほかの OS（CI の ubuntu）では飛ばす
 */
const BACKEND_DIR = path.resolve(__dirname, '../..');
const SCRIPT = path.join(BACKEND_DIR, 'scripts/mcp-sandbox.sh');
const PROFILE = path.join(BACKEND_DIR, 'scripts/mcp-sandbox.sb');
const MAIN = path.join(BACKEND_DIR, 'dist/mcp/main.js');
const NODE = process.execPath;

const describeOnMac = process.platform === 'darwin' ? describe : describe.skip;

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
