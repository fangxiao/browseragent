// 快捷能力指令 chips(点击即作为一条消息发出)
import { capabilitiesForDocType, type CapabilityMeta } from '@/utils/ai/capabilities';
import type { DocTypeId } from '@/utils/ai/docType';

interface Props {
  docType: DocTypeId;
  disabled: boolean;
  onRun: (cap: CapabilityMeta) => void;
}

export function CapabilityChips({ docType, disabled, onRun }: Props) {
  const caps = capabilitiesForDocType(docType);
  return (
    <div className="flex flex-wrap gap-1.5">
      {caps.map((cap) => (
        <button
          key={cap.id}
          disabled={disabled}
          onClick={() => onRun(cap)}
          className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          title={cap.description}
        >
          {cap.label}
        </button>
      ))}
    </div>
  );
}
