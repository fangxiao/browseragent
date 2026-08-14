// 内容面板:文档标题、类型(可手动改)、token 估算、解析诊断
import type { DocContent } from '@/utils/pageExtract/types';
import type { DocTypeId } from '@/utils/ai/docType';
import { DOC_TYPE_LABELS } from '@/utils/ai/docType';
import { estimateTokens } from '@/utils/ai/tokens';

interface Props {
  doc: DocContent;
  docType: DocTypeId;
  onChangeDocType: (t: DocTypeId) => void;
}

const DOC_TYPES: DocTypeId[] = ['requirement', 'report', 'meeting', 'technical', 'review', 'other'];

export function ContentPanel({ doc, docType, onChangeDocType }: Props) {
  const tokens = estimateTokens(doc.markdown);
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
      <div className="mb-1 truncate font-medium text-gray-800" title={doc.title}>
        {doc.title || '未命名文档'}
      </div>
      <div className="flex items-center gap-2 text-gray-500">
        <span>
          {doc.blockCount} 块 · {doc.textLength.toLocaleString()} 字 · ≈{tokens.toLocaleString()} token
        </span>
        {doc.extractionRate < 0.8 && (
          <span className="rounded bg-amber-100 px-1 text-amber-700" title={doc.warnings.join('; ')}>
            解析率 {Math.round(doc.extractionRate * 100)}%
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="text-gray-500">文档类型</label>
        <select
          className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-700"
          value={docType}
          onChange={(e) => onChangeDocType(e.target.value as DocTypeId)}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {doc.warnings.length > 0 && (
        <div className="mt-1 text-amber-600" title={doc.warnings.join('; ')}>
          ⚠ 部分内容可能未完整提取
        </div>
      )}
    </div>
  );
}
