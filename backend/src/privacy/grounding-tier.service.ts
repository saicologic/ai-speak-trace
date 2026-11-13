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
  unknownFields,
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
  /** 読んだ tier（Guardrail ID・バージョンが同じ間は使い回す。読めなかったときは覚えない） */
  private cached?: { key: string; tier: GroundingTier };
  /** 覚えている tier の世代（reset と切り替えで進める。古い世代で読み始めた結果は覚えない） */
  private generation = 0;
  /** 書き換えた後、Guardrail が READY に戻るのを確かめる間隔（ミリ秒）と回数 */
  readyPollMs = 1000;
  readyPollAttempts = 30;

  constructor(
    private readonly configService: ConfigService,
    private readonly guardrail: GuardrailService,
  ) {}

  /** 覚えている tier とクライアントを捨てる（設定・AWS のプロファイルを変えたとき） */
  reset(): void {
    this.client = undefined;
    this.cached = undefined;
    this.generation++;
  }

  /** 今の設定の Guardrail（ID・バージョン）の根拠の確認の tier */
  async getTier(): Promise<GroundingTierStatus> {
    const id = this.guardrail.guardrailId;
    if (!id) return 'UNKNOWN';
    const version = this.guardrail.guardrailVersion;
    const key = `${id}@${version}`;
    if (this.cached?.key === key) return this.cached.tier;
    const generation = this.generation;
    try {
      const tier = groundingTierOf(await this.get(id, version));
      // 読んでいる間に reset・切り替えがあったら、古い結果で上書きしない
      if (generation === this.generation) this.cached = { key, tier };
      return tier;
    } catch (error) {
      // 一時的な失敗や権限の不足は、直した後に読み直せるよう覚えない
      this.logger.warn(
        `根拠の確認の tier を確かめられません（Guardrail ${id}、バージョン ${version}）`,
        error instanceof Error ? error.message : error,
      );
      return 'UNKNOWN';
    }
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
      // 使っているバージョンにだけ引き継げない設定があると、新しいバージョンでその設定が消えるため止める
      const unknown = unknownFields(current);
      if (unknown.length > 0) {
        throw new Error(
          `使っているバージョン ${pinned} に、引き継ぎ方がわからない設定があります: ${unknown.join(', ')}`,
        );
      }
      if (!sameSettingsExceptGroundingTier(draft, current)) {
        throw new Error(
          `DRAFT の設定が、使っているバージョン ${pinned} と違うため、切り替えませんでした。AWS のコンソールで切り替えてください`,
        );
      }
    }
    this.cached = undefined;
    this.generation++;
    await this.getClient().send(
      new UpdateGuardrailCommand(standardGroundingRequest(draft)),
    );
    // 更新中（UPDATING）は新しいバージョンを作れないため、READY に戻るまで待つ
    const updated = await this.waitUntilReady(id, 'DRAFT');
    // SDK が tierConfig を知らないと、エラーにならずに捨てるため、読み直して確かめる
    // （STANDARD になっていないまま新しいバージョンを作ると、使わないバージョンが増える）
    const draftTier = groundingTierOf(updated);
    if (draftTier !== 'STANDARD') {
      throw new Error(
        `根拠の確認が STANDARD になりませんでした（${draftTier}）。AWS SDK の版が古い可能性があります`,
      );
    }
    let version = 'DRAFT';
    let checked = updated;
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
      checked = await this.waitUntilReady(id, version);
      // 新しいバージョンは作った時点の DRAFT を写すため、途中で別の操作が設定を変えていないかを確かめる
      if (!sameSettingsExceptGroundingTier(checked, draft)) {
        throw new Error(
          `新しいバージョン ${version} の設定が、切り替える前の DRAFT と違います。AWS のコンソールで確かめてください`,
        );
      }
    }
    // SDK が tierConfig を知らないと、エラーにならずに捨てるため、読み直して確かめる
    const after = groundingTierOf(checked);
    if (after !== 'STANDARD') {
      throw new Error(
        `根拠の確認が STANDARD になりませんでした（${after}）。AWS SDK の版が古い可能性があります`,
      );
    }
    // 切り替えの最中に読まれた古い tier が残らないよう、確かめた tier を覚える
    this.cached = { key: `${id}@${version}`, tier: 'STANDARD' };
    return { version };
  }

  /** Guardrail が READY になるまで読み直す（ならなければ失敗にする） */
  private async waitUntilReady(
    id: string,
    version: string,
  ): Promise<GetGuardrailCommandOutput> {
    for (let attempt = 1; ; attempt++) {
      const guardrail = await this.get(id, version);
      if (guardrail.status === 'READY') return guardrail;
      if (guardrail.status === 'FAILED') {
        throw new Error(
          `Guardrail（バージョン ${version}）の更新が失敗しました（${(guardrail.statusReasons ?? []).join('、') || '理由は不明'}）`,
        );
      }
      if (attempt >= this.readyPollAttempts) {
        throw new Error(
          `Guardrail（バージョン ${version}）が READY に戻りませんでした（${guardrail.status ?? '不明'}）`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.readyPollMs));
    }
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
