// Provider 编辑表单(新增/修改)
import { useState } from 'react';
import type { ProviderConfig, ProviderKind } from '@/utils/ai/provider/types';
import { PROVIDER_TEMPLATES } from '@/utils/ai/provider';

interface Props {
  initial?: ProviderConfig;
  onSave: (cfg: ProviderConfig) => void;
  onCancel: () => void;
}

const KINDS: ProviderKind[] = ['anthropic', 'deepseek', 'openai-compat'];
const KIND_LABEL: Record<ProviderKind, string> = {
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
  'openai-compat': 'OpenAI 兼容',
};

export function ProviderForm({ initial, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<ProviderKind>(initial?.kind ?? 'deepseek');
  const [label, setLabel] = useState(initial?.label ?? PROVIDER_TEMPLATES.deepseek.label);
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? PROVIDER_TEMPLATES.deepseek.baseUrl);
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(initial?.model ?? PROVIDER_TEMPLATES.deepseek.model);

  const pickTemplate = (k: ProviderKind) => {
    setKind(k);
    const t = PROVIDER_TEMPLATES[k];
    setLabel(t.label);
    setBaseUrl(t.baseUrl);
    setModel(t.model);
  };

  return (
    <form
      className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          id: initial?.id ?? `p_${Date.now().toString(36)}`,
          kind,
          label: label.trim() || KIND_LABEL[kind],
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
        });
      }}
    >
      <div>
        <label className="mb-1 block text-xs text-gray-500">服务商</label>
        <div className="flex gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => pickTemplate(k)}
              className={`rounded px-2.5 py-1 text-xs ${
                kind === k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">名称</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">Base URL</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.deepseek.com"
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">API Key(仅存本机)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={initial?.apiKey ? '已保存,留空保持不变' : 'sk-...'}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-gray-500">模型</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="deepseek-chat"
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
        >
          取消
        </button>
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          保存
        </button>
      </div>
    </form>
  );
}
