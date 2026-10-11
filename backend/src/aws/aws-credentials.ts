import { fromEnv } from '@aws-sdk/credential-provider-env';
import { fromIni } from '@aws-sdk/credential-provider-ini';
import { chain } from '@smithy/property-provider';
import type { AwsCredentialIdentityProvider } from '@smithy/types';

/**
 * AWS のクライアントに渡す認証情報の読み方（環境変数 → ~/.aws/credentials・config の順）
 *
 * AWS SDK の既定の読み方（@aws-sdk/credential-provider-node）は、方法ごとの部品を動的 import で
 * 読み込む。pkg でまとめたサイドカーの中では動的 import が部品を見つけられず、
 * 「Cannot find package '@aws-sdk/credential-provider-ini'」で失敗する。
 * そのため、環境変数と ~/.aws の設定を読む部品を通常の import で読み込み、すべてのクライアントに渡す。
 *
 * ~/.aws にアクセスキーを書く設定（プロファイルは AWS_PROFILE、未指定なら default）に対応する。
 * SSO・ロールの切り替え（assume role）・credential_process は、部品の中でさらに動的 import を使うため
 * サイドカーでは動かない。
 */
export function awsCredentials(): AwsCredentialIdentityProvider {
  return chain(fromEnv(), fromIni());
}
