import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type { AiSettings, ProviderConfig } from '@/utils/ai/provider/types';
import { getSettings, saveSettings } from '@/utils/storage';
import { ProviderForm } from '@/components/options/ProviderForm';

function App() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState<ProviderConfig | 'new' | null>(null);
  const [saved, setSaved] = useState(false);

  const [tunnelStatus, setTunnelStatus] = useState<'connected' | 'connecting' | 'reconnecting' | 'disconnected'>('disconnected');
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectMsg, setReconnectMsg] = useState<string | null>(null);

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      if (s.enableTunnel) {
        setTunnelStatus('connecting');
      }
      try {
        if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
          void browser.runtime.sendMessage({ type: 'TUNNEL:GET_STATUS' }).then((res: any) => {
            if (res?.status) {
              setTunnelStatus(res.status);
            }
          });
        }
      } catch {
        /* ignore */
      }
    });

    // 查询当前长连接状态
    if (typeof browser !== 'undefined' && browser.storage?.local) {
      void browser.storage.local.get('browseragent_tunnel_status').then((res: any) => {
        if (res?.browseragent_tunnel_status) {
          setTunnelStatus(res.browseragent_tunnel_status);
        }
      });
    }

    // 监听状态变化广播
    const onMsg = (msg: any) => {
      if (msg?.type === 'TUNNEL:STATUS_CHANGE' && msg.status) {
        setTunnelStatus(msg.status);
      }
    };
    if (typeof browser !== 'undefined' && browser.runtime?.onMessage) {
      browser.runtime.onMessage.addListener(onMsg);
      return () => browser.runtime.onMessage.removeListener(onMsg);
    }
  }, []);

  const persist = async (next: AiSettings) => {
    setSettings(next);
    await saveSettings(next);
    try {
      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
        void browser.runtime.sendMessage({ type: 'SETTINGS:SAVE', settings: next });
        if (next.enableTunnel) {
          void browser.runtime.sendMessage({ type: 'TUNNEL:RECONNECT' }).then((res: any) => {
            if (res?.status) setTunnelStatus(res.status);
          });
        }
      }
    } catch {
      /* ignore */
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleManualReconnect = async () => {
    setReconnecting(true);
    setReconnectMsg(null);
    try {
      if (!settings?.enableTunnel) {
        const next = { ...settings, enableTunnel: true } as AiSettings;
        await persist(next);
      }
      if (typeof browser !== 'undefined' && browser.runtime?.sendMessage) {
        const res = (await browser.runtime.sendMessage({ type: 'TUNNEL:RECONNECT' })) as { ok?: boolean; status?: any };
        if (res?.status) {
          setTunnelStatus(res.status);
        }
        setReconnectMsg('已触发连接');
      }
    } catch {
      setReconnectMsg('连接请求已发送');
    }
    setTimeout(() => {
      setReconnecting(false);
      setTimeout(() => setReconnectMsg(null), 2500);
    }, 800);
  };

  if (!settings) return <div className="p-6 text-sm text-gray-500">加载中...</div>;

  const { providers, activeProviderId } = settings;
  const active = providers.find((p) => p.id === activeProviderId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 text-sm">
      <header className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">AI 浏览器助手设置</h1>
          <p className="text-xs text-gray-400 mt-0.5">配置您的 AI 模型服务与平台协同连接</p>
        </div>
        <span className={`text-xs ${saved ? 'text-green-600 font-medium' : 'text-gray-300'}`}>
          {saved ? '✓ 已保存' : '更改后自动保存'}
        </span>
      </header>

      {/* 1. AI 模型服务配置 (核心区域) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <span>🧠</span>
            <span>AI 模型服务</span>
          </h2>
          <span className="text-xs text-gray-400">
            当前生效: <span className="font-medium text-gray-700">{active ? `${active.label} (${active.model})` : '未配置'}</span>
          </span>
        </div>

        {providers.length === 0 && !editing && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/70 p-4 text-center">
            <p className="text-xs text-gray-500 mb-2">尚未配置 AI 模型。请点击下方按钮添加（支持 DeepSeek / OpenAI / Claude 等）</p>
            <button
              onClick={() => setEditing('new')}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 cursor-pointer shadow-2xs"
            >
              + 添加 AI 服务
            </button>
          </div>
        )}

        {providers.length > 0 && (
          <div className="space-y-2">
            {providers.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                  p.id === activeProviderId ? 'border-blue-300 bg-blue-50/50 shadow-2xs' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{p.label}</span>
                    <span className="text-[10px] text-gray-400 font-mono">
                      {p.kind === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'}
                    </span>
                    {p.id === activeProviderId && (
                      <span className="rounded bg-blue-600 px-1.5 py-0.2 text-[10px] font-medium text-white">当前使用</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 font-mono">
                    {p.baseUrl} · {p.model}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {p.id !== activeProviderId && (
                    <button
                      onClick={() => void persist({ ...settings, activeProviderId: p.id })}
                      className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
                    >
                      设为当前
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(p)}
                    className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
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
                    className="rounded border border-red-100 bg-white px-2 py-1 text-xs text-red-500 hover:bg-red-50 cursor-pointer"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editing ? (
          <div className="pt-2">
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
          providers.length > 0 && (
            <button
              onClick={() => setEditing('new')}
              className="rounded border border-dashed border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              + 新增 AI 服务
            </button>
          )
        )}
      </section>

      {/* 2. 平台协同状态 (AgentPlatform) */}
      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-2 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>🔌</span>
            <h2 className="text-sm font-semibold text-gray-800">AgentPlatform 平台协同</h2>
          </div>
          <div className="flex items-center gap-2">
            {tunnelStatus === 'connected' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 border border-green-200">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                已连接平台
              </span>
            ) : tunnelStatus === 'reconnecting' || tunnelStatus === 'connecting' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-50 px-2.5 py-0.5 text-xs font-medium text-yellow-700 border border-yellow-200">
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                连接中…
              </span>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 border border-gray-200">
                  未连接
                </span>
                <button
                  type="button"
                  disabled={reconnecting}
                  onClick={() => void handleManualReconnect()}
                  className="rounded bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer shadow-2xs whitespace-nowrap"
                >
                  {reconnecting ? '正在重试…' : '🔄 重试连接'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-500">
          端侧智能协同节点：供平台端云下发公众号排版一键注入、跨系统代填表单与 DOM 数据提取任务。
        </p>
        {reconnectMsg && <p className="text-xs text-blue-600">{reconnectMsg}</p>}
      </section>

      {/* 底部隐私声明 */}
      <footer className="text-center text-[11px] text-gray-400 pt-2">
        🔒 所有 API Key 与平台凭证仅存储在用户当前本地浏览器中，绝不会向未经授权的第三方传输。
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
