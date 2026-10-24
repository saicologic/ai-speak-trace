import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveDataDir } from './data-dir';
import { createMcpServer } from './server';

/**
 * MCP サーバーを stdio で起動する（Claude Desktop・Claude Code から子プロセスとして起動される）
 * stdout は MCP の通信に使うため、ログはすべて stderr に出す（Nest の Logger は stdout に出るため使わない）
 */
async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const log = (message: string) =>
    process.stderr.write(`[ai-speak-trace-mcp] ${message}\n`);
  const server = createMcpServer({
    dataDir,
    version: process.env.npm_package_version ?? 'dev',
    log,
  });
  await server.connect(new StdioServerTransport());
  log(`起動しました（データ: ${dataDir}）`);
}

main().catch((error) => {
  process.stderr.write(`[ai-speak-trace-mcp] 起動に失敗しました: ${error}\n`);
  process.exit(1);
});
