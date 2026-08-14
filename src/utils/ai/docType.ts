// 文档类型识别(规则 + 置信度;LLM 兜底在 AI 引擎层)。见需求 §2.2
export type DocTypeId =
  | 'requirement' // T1 需求文档 → AI 评审
  | 'report' // T2 周报/月报 → AI 补全
  | 'meeting' // T3 会议纪要 → 待办提炼
  | 'technical' // T4 技术方案 → 风险评审
  | 'review' // T5 复盘总结 → 结构补全
  | 'other'; // 通用

export const DOC_TYPE_LABELS: Record<DocTypeId, string> = {
  requirement: '需求文档',
  report: '周报 / 月报',
  meeting: '会议纪要',
  technical: '技术方案',
  review: '复盘总结',
  other: '其他',
};

export interface DocTypeGuess {
  type: DocTypeId;
  confidence: number; // 0-1
}

interface Rule {
  type: DocTypeId;
  base: number;
  keywords: string[];
}

const RULES: Rule[] = [
  {
    type: 'requirement',
    base: 0.9,
    keywords: ['需求', 'PRD', '产品需求', '验收标准', '用户故事', '需求背景', '需求目标'],
  },
  {
    type: 'report',
    base: 0.85,
    keywords: ['周报', '月报', '本周进展', '本周完成', '下周计划', '月度总结', '工作汇报'],
  },
  {
    type: 'meeting',
    base: 0.85,
    keywords: ['会议纪要', '会议记录', '参会人', '纪要', '会议结论', '待办事项'],
  },
  {
    type: 'technical',
    base: 0.85,
    keywords: ['技术方案', '设计文档', '技术选型', '架构设计', '方案评审', '技术风险', '系统设计'],
  },
  {
    type: 'review',
    base: 0.8,
    keywords: ['复盘', '经验总结', '反思', '改进项', '行动项', '结果', '原因分析'],
  },
];

export function guessDocType(title: string, bodyText: string): DocTypeGuess {
  const sample = `${title}\n${bodyText.slice(0, 3000)}`;
  const scored = RULES.map((r) => {
    const hits = r.keywords.filter((k) => sample.includes(k)).length;
    return { type: r.type, ratio: hits / r.keywords.length, hits };
  })
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.ratio - a.ratio || b.hits - a.hits);

  if (scored.length === 0) {
    return { type: 'other', confidence: 0.3 };
  }
  const top = scored[0]!;
  const confidence = Math.min(0.95, 0.4 + top.ratio * 0.55);
  return { type: top.type, confidence };
}
