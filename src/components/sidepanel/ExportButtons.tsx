// 数据导出按钮组:CSV 下载(Blob,带 BOM 兼容 Excel)/ 复制到剪贴板(设计 §10)。
import { useState } from 'react';

interface Props {
  csv: string;
  filename?: string;
}

export function ExportButtons({ csv, filename = 'data.csv' }: Props) {
  const [copied, setCopied] = useState(false);

  const download = () => {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <button
        onClick={download}
        className="rounded border border-blue-200 bg-white px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
      >
        ⬇ 下载 CSV
      </button>
      <button
        onClick={() => void copy()}
        className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
      >
        {copied ? '✓ 已复制' : '复制'}
      </button>
    </div>
  );
}
