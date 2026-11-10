// Provider 编辑表单 (极简双协议: OpenAI 格式 / Anthropic 格式)
import { useState } from 'react';
import type { ProviderConfig, ProviderKind } from '@/utils/ai/provider/types';

interface Props {
  initial?: ProviderConfig;
  onSave: (cfg: ProviderConfig) => void;
  onCancel: () => void;
}

export function ProviderForm({ initial, onSave, onCancel }: Props) {
  // 归一化为 openai-compat 或 anthropic
  const initialKind: ProviderKind = initial?.kind === 'anthropic' ? 'anthropic' : 'openai-compat';
  const [kind, setKind] = useState<ProviderKind>(initialKind);
  const [label, setLabel] = useState(initial?.label ?? (initialKind === 'anthropic' ? 'Anthropic Claude' : 'OpenAI / DeepSeek'));
  const [baseUrl, setBaseUrl] = useState(
    initial?.baseUrl ?? (initialKind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com'),
  );
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '');
  const [model, setModel] = useState(
    initial?.model ?? (initialKind === 'anthropic' ? 'claude-3-7-sonnet-20250219' : 'deepseek-chat'),
  );

  const handleKindSwitch = (newKind: ProviderKind) => {
    setKind(newKind);
    if (newKind === 'anthropic') {
      if (!initial) {
        setLabel('Anthropic Claude');
        setBaseUrl('https://api.anthropic.com');
        setModel('claude-3-7-sonnet-20250219');
      }
    } else {
      if (!initial) {
        setLabel('OpenAI / DeepSeek');
        setBaseUrl('https://api.deepseek.com');
        setModel('deepseek-chat');
      }
    }
  };

  return (
    <form
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 text-sm shadow-xs"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          id: initial?.id ?? `p_${Date.now().toString(36)}`,
          kind,
          label: label.trim() || (kind === 'anthropic' ? 'Anthropic' : 'OpenAI Compatible'),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          model: model.trim(),
        });
      }}
    >
      {/* 格式选择: 仅提供 OpenAI 格式 与 Anthropic 格式 */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-gray-700">API 格式规范</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => handleKindSwitch('openai-compat')}
            className={`flex flex-col items-center justify-center rounded-md border p-2.5 text-xs transition-colors cursor-pointer ${
              kind !== 'anthropic'
                ? 'border-blue-600 bg-blue-50/60 text-blue-700 font-medium ring-1 ring-blue-600'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="font-semibold text-sm">OpenAI 格式</span>
            <span className="text-[11px] text-gray-500 mt-0.5">兼容 DeepSeek / Kimi / Qwen / Ollama 等</span>
          </button>

          <button
            type="button"
            onClick={() => handleKindSwitch('anthropic')}
            className={`flex flex-col items-center justify-center rounded-md border p-2.5 text-xs transition-colors cursor-pointer ${
              kind === 'anthropic'
                ? 'border-blue-600 bg-blue-50/60 text-blue-700 font-medium ring-1 ring-blue-600'
                : 'border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="font-semibold text-sm">Anthropic 格式</span>
            <span className="text-[11px] text-gray-500 mt-0.5">适用于 Claude 3.5 / 3.7 系列</span>
          </button>
        </div>
      </div>

      {/* 4 个核心输入字段 */}
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">服务名称</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如: DeepSeek / OpenAI / Claude"
            className="w-full rounded border border-gray-300 px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Base URL (接口地址)</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1 或 https://api.deepseek.com'}
            className="w-full rounded border border-gray-300 font-mono px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={initial?.apiKey ? '已配置，留空保持不变' : 'sk-...'}
            className="w-full rounded border border-gray-300 font-mono px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Model Name (模型名称)</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={kind === 'anthropic' ? 'claude-3-7-sonnet-20250219' : 'deepseek-chat 或 gpt-4o'}
            className="w-full rounded border border-gray-300 font-mono px-2.5 py-1.5 text-xs outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 cursor-pointer"
        >
          取消
        </button>
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer shadow-2xs"
        >
          保存
        </button>
      </div>
    </form>
  );
}
