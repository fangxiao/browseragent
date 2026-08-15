import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { AiSettings, ProviderConfig } from '@/utils/ai/provider/types';
import { getSettings, saveSettings } from '@/utils/storage';
import { ProviderForm } from '@/components/options/ProviderForm';
import {
  getCachedCloudConfig,
  fetchAndSyncCloudConfig,
  type AgentCloudConfig,
} from '@/utils/ai/remoteConfig';

function App() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState<ProviderConfig | 'new' | null>(null);
  const [saved, setSaved] = useState(false);
  const [cloudConfig, setCloudConfig] = useState<AgentCloudConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    void getCachedCloudConfig().then(setCloudConfig);
  }, []);

  const persist = async (next: AiSettings) => {
    setSettings(next);
    await saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleSyncRules = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const res = await fetchAndSyncCloudConfig();
    setSyncing(false);
    if (res.success && res.config) {
      setCloudConfig(res.config);
      setSyncMsg({ ok: true, text: `✅ 技能已更新至 v${res.config.version}` });
    } else {
      setSyncMsg({ ok: false, text: `⚠️ 同步提示: ${res.error ?? '无法连接到云端服务，已自动保持本地稳定规则'}` });
    }
    setTimeout(() => setSyncMsg(null), 4000);
  };

  if (!settings) return <div className="p-6 text-sm text-gray-500">加载中...</div>;

  const { providers, activeProviderId } = settings;
  const active = providers.find((p) => p.id === activeProviderId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 text-sm">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">设置</h1>
        <span className={`text-xs ${saved ? 'text-green-600' : 'text-gray-300'}`}>
          {saved ? '已保存' : '更改后自动保存'}
        </span>
      </header>

      <section>
        <h2 className="mb-2 text-base font-medium text-gray-700">AI 服务</h2>
        {providers.length === 0 && (
          <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">
            尚未配置 AI 服务。点击"新增服务"添加(推荐 DeepSeek,国内直连)。
          </p>
        )}

        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-lg border p-3 ${
                p.id === activeProviderId ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{p.label}</span>
                  {p.id === activeProviderId && (
                    <span className="rounded bg-blue-600 px-1.5 text-[10px] text-white">当前</span>
                  )}
                </div>
                <div className="text-xs text-gray-400">
                  {p.baseUrl} · {p.model}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void persist({ ...settings, activeProviderId: p.id })}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  设为当前
                </button>
                <button
                  onClick={() => setEditing(p)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                >
                  编辑
                </button>
                <button
                  onClick={() => {
                    const next = {
                      ...settings,
                      providers: providers.filter((x) => x.id !== p.id),
                      activeProviderId:
                        activeProviderId === p.id ? providers.find((x) => x.id !== p.id)?.id ?? '' : activeProviderId,
                    };
                    void persist(next);
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        {editing ? (
          <div className="mt-3">
            <ProviderForm
              initial={editing === 'new' ? undefined : editing}
              onSave={(cfg) => {
                const exists = providers.some((p) => p.id === cfg.id);
                const next: AiSettings = exists
                  ? {
                      ...settings,
                      providers: providers.map((p) => (p.id === cfg.id ? { ...p, ...cfg, apiKey: cfg.apiKey || p.apiKey } : p)),
                    }
                  : {
                      ...settings,
                      providers: [...providers, cfg],
                      activeProviderId: settings.activeProviderId || cfg.id,
                    };
                void persist(next);
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : (
          <button
            onClick={() => setEditing('new')}
            className="mt-3 rounded border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
          >
            + 新增服务
          </button>
        )}

        <div className="mt-2 text-xs text-gray-400">
          当前使用:{active ? `${active.label}(${active.model})` : '未配置'}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-medium text-gray-700">处理与隐私</h2>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-gray-600">单文档最大字符数(超过将仅处理前 80 块)</span>
            <input
              type="number"
              value={settings.maxDocChars}
              min={1000}
              step={1000}
              onChange={(e) => void persist({ ...settings, maxDocChars: Number(e.target.value) || 120000 })}
              className="w-28 rounded border border-gray-300 px-2 py-1 text-right"
            />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-gray-600">每次发送文档内容前确认(ADR-0005)</span>
            <input
              type="checkbox"
              checked={settings.confirmOnSend}
              onChange={(e) => void persist({ ...settings, confirmOnSend: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
          <label className="flex items-center justify-between">
            <div>
              <span className="text-gray-600">调试模式</span>
              <p className="text-xs text-gray-400">在侧边栏中默认展开 AI 思考过程与中间执行步骤卡片</p>
            </div>
            <input
              type="checkbox"
              checked={Boolean(settings.debugMode)}
              onChange={(e) => void persist({ ...settings, debugMode: e.target.checked })}
              className="h-4 w-4"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          API Key 仅保存在本机浏览器存储中,不会上传到任何第三方。
        </p>
      </section>

      {/* 版本与云端 AI 技能热更 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-base font-medium text-gray-700">版本与云端 AI 技能同步</h2>
        <div className="space-y-2 text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <span className="text-gray-500">扩展核心外壳版本:</span>
            <span className="font-mono font-medium text-gray-800">v0.2.0</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500">当前生效的 AI 技能规则:</span>
            <span className="font-medium text-blue-700">
              {cloudConfig ? `v${cloudConfig.version} (云端已同步)` : '内置原生规则 (v0.2.0)'}
            </span>
          </div>
          {cloudConfig?.updatedAt && (
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span>上次更新时间:</span>
              <span>{new Date(cloudConfig.updatedAt).toLocaleString()}</span>
            </div>
          )}

          {syncMsg && (
            <div
              className={`rounded p-2 text-xs ${
                syncMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              {syncMsg.text}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between border-t border-gray-100">
            <span className="text-gray-400 text-[11px]">
              无需重新下载扩展，即可热更最新的 Agent 场景与跨 Tab 协同规则
            </span>
            <button
              disabled={syncing}
              onClick={() => void handleSyncRules()}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {syncing ? '正在检查…' : '🔄 立即检查并同步最新 AI 技能'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
