// 提示词分发:按能力返回稳定的 system 提示词(对话式)。
// 首轮 user 消息(含文档)由 sidepanel 组装;background 只负责 system + 透传历史。
// M1:review(需求评审)/ complete(周报补全)/ 通用四件套;M2 专属能力降级为摘要。
import type { CapabilityId } from '../provider/types';
import { REVIEW_SYSTEM } from './review';
import { REPORT_SYSTEM } from './report';
import { GENERAL_SYSTEM, type GeneralAction } from './general';

const GENERAL_ACTIONS: CapabilityId[] = ['polish', 'translate', 'summary', 'outline'];

export function buildSystemFor(capability: CapabilityId): string {
  switch (capability) {
    case 'review':
      return REVIEW_SYSTEM;
    case 'complete':
      return REPORT_SYSTEM;
    case 'actionItems':
    case 'riskReview':
    case 'structure':
      // M2 专属提示词未实现前降级为通用摘要
      return GENERAL_SYSTEM.summary;
    default:
      return GENERAL_SYSTEM[capability as GeneralAction] ?? GENERAL_SYSTEM.summary;
  }
}

export { GENERAL_ACTIONS };
