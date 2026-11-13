import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BedrockClient,
  CreateGuardrailVersionCommand,
  GetGuardrailCommand,
  GetGuardrailCommandOutput,
  UpdateGuardrailCommand,
} from '@aws-sdk/client-bedrock';
import { awsCredentials } from '../aws/aws-credentials';
import { GuardrailService } from './guardrail.service';
import {
  GroundingTier,
  groundingTierOf,
  sameSettingsExceptGroundingTier,
  standardGroundingRequest,
} from './grounding-tier';

/** 根拠の確認の tier（UNKNOWN は、Guardrail ID がない・GetGuardrail を呼べないなどで確かめられない） */
export type GroundingTierStatus = GroundingTier | 'UNKNOWN';

/**
 * Guardrail の根拠の確認（contextual grounding check）の tier を読み、Standard に切り替えるサービス
 *
 * 日本語の文の根拠の確認は Standard tier だけが対応するため、tier を確かめてから日本語の文を確かめる。
 * Guardrail の設定を読み書きする API（GetGuardrail など）は、ApplyGuardrail とは別のクライアント（BedrockClient）で呼ぶ
 */
@Injectable()
export class GroundingTierService {
  private readonly logger = new Logger(GroundingTierService.name);
  private client?: BedrockClient;
  /** 読んだ tier（Guardrail ID・バージョンが同じ間は使い回す） */
  private cached?: { key: string; tier: GroundingTierStatus };

  constructor(
    private readonly configService: ConfigService,
    private readonly guardrail: GuardrailService,
  ) {}

  /** 覚えている tier とクライアントを捨てる（設定・AWS のプロファイルを変えたとき） */
  reset(): void {
    this.client = undefined;
    this.cached = undefined;
  }

  /** 今の設定の Guardrail（ID・バージョン）の根拠の確認の tier */
  async getTier(): Promise<GroundingTierStatus> {
    const id = this.guardrail.guardrailId;
    if (!id) return 'UNKNOWN';
    const version = this.guardrail.guardrailVersion;
    const key = `${id}@${version}`;
    if (this.cached?.key === key) return this.cached.tier;
    let tier: GroundingTierStatus;
    try {
      tier = groundingTierOf(await this.get(id, version));
    } catch (error) {
      this.logger.warn(
        `根拠の確認の tier を確かめられません（Guardrail ${id}、バージョン ${version}）`,
        error instanceof Error ? error.message : error,
      );
      tier = 'UNKNOWN';
    }
    this.cached = { key, tier };
    return tier;
  }

  /**
   * 根拠の確認を Standard tier にする。今の設定は引き継ぐ
   * 番号付きのバージョンを使っていれば、DRAFT が同じ設定かを確かめてから新しいバージョンを作り、その番号を返す
   */
  async switchToStandard(): Promise<{ version: string }> {
    const id = this.guardrail.guardrailId;
    if (!id) throw new Error('Guardrail ID が設定されていません');
    const pinned = this.guardrail.guardrailVersion;
    const draft = await this.get(id, 'DRAFT');
    if (pinned !== 'DRAFT') {
      const current = await this.get(id, pinned);
      if (!sameSettingsExceptGroundingTier(draft, current)) {
        throw new Error(
          `DRAFT の設定が、使っているバージョン ${pinned} と違うため、切り替えませんでした。AWS のコンソールで切り替えてください`,
        );
      }
    }
    this.cached = undefined;
    await this.getClient().send(
      new UpdateGuardrailCommand(standardGroundingRequest(draft)),
    );
    let version = 'DRAFT';
    if (pinned !== 'DRAFT') {
      const created = await this.getClient().send(
        new CreateGuardrailVersionCommand({
          guardrailIdentifier: id,
          description: '根拠の確認を Standard tier にした',
        }),
      );
      if (!created.version) {
        throw new Error('新しいバージョンの番号が返りませんでした');
      }
      version = created.version;
    }
    // SDK が tierConfig を知らないと、エラーにならずに捨てるため、読み直して確かめる
    const after = groundingTierOf(await this.get(id, version));
    if (after !== 'STANDARD') {
      throw new Error(
        `根拠の確認が STANDARD になりませんでした（${after}）。AWS SDK の版が古い可能性があります`,
      );
    }
    return { version };
  }

  private get(id: string, version: string): Promise<GetGuardrailCommandOutput> {
    return this.getClient().send(
      new GetGuardrailCommand({
        guardrailIdentifier: id,
        guardrailVersion: version,
      }),
    );
  }

  private getClient(): BedrockClient {
    this.client ??= new BedrockClient({
      // サイドカーでも読めるよう、認証情報の読み方を指定する（GuardrailService と同じ）
      credentials: awsCredentials(),
      region: this.configService.get<string>('AWS_REGION', 'ap-northeast-1'),
    });
    return this.client;
  }
}
