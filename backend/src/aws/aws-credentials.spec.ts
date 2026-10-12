import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { awsCredentials } from './aws-credentials';

describe('awsCredentials', () => {
  const saved = {
    file: process.env.AWS_SHARED_CREDENTIALS_FILE,
    config: process.env.AWS_CONFIG_FILE,
    profile: process.env.AWS_PROFILE,
    keyId: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
  };
  let dir: string;
  let credentialsFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aws-credentials-'));
    credentialsFile = path.join(dir, 'credentials');
    process.env.AWS_SHARED_CREDENTIALS_FILE = credentialsFile;
    process.env.AWS_CONFIG_FILE = path.join(dir, 'config');
    // 環境変数の認証情報があると、そちらが先に使われるため外す
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  afterEach(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('AWS_SHARED_CREDENTIALS_FILE', saved.file);
    restore('AWS_CONFIG_FILE', saved.config);
    restore('AWS_PROFILE', saved.profile);
    restore('AWS_ACCESS_KEY_ID', saved.keyId);
    restore('AWS_SECRET_ACCESS_KEY', saved.secret);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('アプリの起動後に ~/.aws に足したプロファイルも、再起動せずに読める', async () => {
    await fs.writeFile(
      credentialsFile,
      '[old]\naws_access_key_id = OLDKEY\naws_secret_access_key = oldsecret\n',
    );
    process.env.AWS_PROFILE = 'old';
    await expect(awsCredentials()()).resolves.toMatchObject({
      accessKeyId: 'OLDKEY',
    });

    // 起動中に利用者が新しいプロファイルを足し、設定画面で切り替えた場合
    await fs.appendFile(
      credentialsFile,
      '[new]\naws_access_key_id = NEWKEY\naws_secret_access_key = newsecret\n',
    );
    process.env.AWS_PROFILE = 'new';
    await expect(awsCredentials()()).resolves.toMatchObject({
      accessKeyId: 'NEWKEY',
    });
  });
});
