import { Module } from '@nestjs/common';
import { ClaudeService } from './claude.service';

/** Claude API共有モジュール */
@Module({
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class ClaudeModule {}
