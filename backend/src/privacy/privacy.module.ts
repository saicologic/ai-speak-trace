import { Module } from '@nestjs/common';
import { GuardrailService } from './guardrail.service';
import { GroundingTierService } from './grounding-tier.service';
import { PrivacyScanStore } from './privacy-scan.store';
import { PrivacyService } from './privacy.service';

/** Amazon Bedrock Guardrails による個人情報チェックのモジュール */
@Module({
  providers: [
    GuardrailService,
    GroundingTierService,
    PrivacyScanStore,
    PrivacyService,
  ],
  exports: [GuardrailService, GroundingTierService, PrivacyService],
})
export class PrivacyModule {}
