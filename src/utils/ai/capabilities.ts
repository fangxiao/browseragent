// 能力清单与文档类型 → 可用能力映射(UI 使用)
import type { CapabilityId } from './provider/types';
import type { DocTypeId } from './docType';

export interface CapabilityMeta {
  id: CapabilityId;
  label: string;
  description?: string;
}

export const CAPABILITIES: Record<CapabilityId, CapabilityMeta> = {
  review: { id: 'review', label: 'AI 评审', description: '结构 / 可测性 / 一致性 / 风险' },
  complete: { id: 'complete', label: 'AI 补全', description: '补全进展与计划,区分已有与建议' },
  actionItems: { id: 'actionItems', label: '待办提炼', description: '结论 / 待办 / 责任人(M2)' },
  riskReview: { id: 'riskReview', label: '风险评审', description: '完整性 / 技术风险 / 可落地(M2)' },
  structure: { id: 'structure', label: '结构补全', description: '目标→结果→原因→行动(M2)' },
  polish: { id: 'polish', label: '润色', description: '修正语病、优化表达' },
  translate: { id: 'translate', label: '翻译', description: '中英互译' },
  summary: { id: 'summary', label: '摘要', description: '核心结论 + 要点' },
  outline: { id: 'outline', label: '大纲', description: '多级大纲' },
};

/** M1 可用能力(M2 专属能力暂不下发,见需求里程碑) */
const M1_CAPABILITIES: CapabilityId[] = [
  'review',
  'complete',
  'polish',
  'translate',
  'summary',
  'outline',
];

export function capabilitiesForDocType(type: DocTypeId): CapabilityMeta[] {
  const ids: CapabilityId[] = (
    {
      requirement: ['review', 'summary', 'outline'],
      report: ['complete', 'polish', 'summary'],
      meeting: ['summary', 'outline'],
      technical: ['summary', 'outline'],
      review: ['summary', 'polish'],
      other: ['summary', 'polish', 'translate', 'outline'],
    } as Record<DocTypeId, CapabilityId[]>
  )[type] ?? ['summary', 'polish'];

  return ids
    .filter((id) => M1_CAPABILITIES.includes(id))
    .map((id) => CAPABILITIES[id]);
}
