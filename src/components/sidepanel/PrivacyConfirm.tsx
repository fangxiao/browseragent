// 隐私确认弹层(ADR-0005 / 需求 FR-5.1:发送前明示 provider)
interface Props {
  providerLabel: string;
  onConfirm: (remember: boolean) => void;
  onCancel: () => void;
}

export function PrivacyConfirm({ providerLabel, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full rounded-lg bg-white p-4 text-sm shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          const remember = (e.currentTarget.elements.namedItem('remember') as HTMLInputElement)?.checked ?? false;
          onConfirm(remember);
        }}
      >
        <div className="mb-2 font-medium text-gray-800">确认发送文档内容</div>
        <p className="mb-3 text-xs text-gray-500">
          当前文档内容将发送至 <span className="font-medium text-gray-700">{providerLabel}</span>{' '}
          进行处理。请确认文档不包含敏感信息。
        </p>
        <label className="mb-3 flex items-center gap-1.5 text-xs text-gray-600">
          <input type="checkbox" name="remember" defaultChecked />
          本会话记住此信任
        </label>
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
            确认发送
          </button>
        </div>
      </form>
    </div>
  );
}
