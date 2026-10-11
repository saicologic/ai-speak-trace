import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { TranscriptionStoreService } from '../transcription/transcription-store.service';
import { FeedbackStore } from './feedback.store';
import {
  Feedback,
  FeedbackCategory,
  FeedbackFeature,
} from './types/feedback.types';

/** AI が生成した結果への、誤りの報告を扱うサービス */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly store: FeedbackStore,
    private readonly transcriptionStore: TranscriptionStoreService,
  ) {}

  /** 報告を保存する（文字起こしがない場合は保存しない） */
  async create(input: {
    feature: FeedbackFeature;
    targetId: string;
    transcriptionId: string;
    category: FeedbackCategory;
    quote: string;
    comment: string;
  }): Promise<Feedback> {
    if (!(await this.transcriptionStore.findById(input.transcriptionId))) {
      throw new NotFoundException(
        `文字起こし結果が見つかりません: ${input.transcriptionId}`,
      );
    }
    const feedback: Feedback = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      ...input,
    };
    if (!(await this.store.save(feedback))) {
      throw new NotFoundException(
        `文字起こし結果が削除されたため、報告を保存しませんでした: ${input.transcriptionId}`,
      );
    }
    return feedback;
  }

  /** 報告の一覧（機能・結果の ID で絞り込める） */
  async find(filter: {
    feature?: string;
    targetId?: string;
  }): Promise<Feedback[]> {
    return (await this.store.findAll()).filter(
      (f) =>
        (filter.feature === undefined || f.feature === filter.feature) &&
        (filter.targetId === undefined || f.targetId === filter.targetId),
    );
  }
}
