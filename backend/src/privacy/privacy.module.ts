import { Module } from '@nestjs/common';
import { GuardrailService } from './guardrail.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PrivacyService } from './privacy.service';

/** Amazon Bedrock Guardrails による個人情報チェックのモジュール */
@Module({
  providers: [GuardrailService, PrivacyScanStore, PrivacyService],
  exports: [GuardrailService, PrivacyService],
})
export class PrivacyModule {}
