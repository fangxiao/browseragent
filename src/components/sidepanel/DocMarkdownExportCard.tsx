// 飞书云文档/网页长文 Markdown 全文提取与离线 ZIP 归档卡片 (DocMarkdownExportCard)
import { useState, useMemo } from 'react';
import type { DocMarkdownResult } from '@/utils/feishu/docToMarkdown';
import {
  extractMarkdownImages,
  extractMarkdownAttachments,
  packageDocWithImagesAsZip,
  triggerZipDownload,
  type ImagePackProgress,
} from '@/utils/feishu/offlineDocPacker';

interface Props {
  data: DocMarkdownResult;
}

export function DocMarkdownExportCard({ data }: Props) {
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [packProgress, setPackProgress] = useState<ImagePackProgress | null>(null);

  const images = useMemo(() => extractMarkdownImages(data.markdown), [data.markdown]);
  const attachments = useMemo(() => extractMarkdownAttachments(data.markdown), [data.markdown]);
  const hasImages = images.length > 0;
  const hasAttachments = attachments.length > 0;
  const hasMedia = hasImages || hasAttachments;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMd = () => {
    const cleanTitle = (data.title || '飞书文档').replace(/[\\/:*?"<>|]/g, '_').slice(0, 35);
    const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    if (packProgress?.status === 'downloading' || packProgress?.status === 'packaging') return;

    try {
      const result = await packageDocWithImagesAsZip(
        data.markdown,
        data.title || '飞书文档',
        (progress) => setPackProgress(progress),
      );
      triggerZipDownload(result.zipBlob, data.title || '飞书文档');
      setTimeout(() => setPackProgress(null), 2500);
    } catch {
      setPackProgress({
        current: 0,
        total: images.length + attachments.length,
        status: 'error',
        errorMessage: '打包失败',
      });
      setTimeout(() => setPackProgress(null), 3000);
    }
  };

  const getZipButtonLabel = () => {
    if (packProgress?.status === 'downloading') {
      return `正在下载资源 (${packProgress.current}/${packProgress.total})...`;
    }
    if (packProgress?.status === 'packaging') {
      return '正在生成 ZIP...';
    }
    if (packProgress?.status === 'done') {
      return 'ZIP 已打包下载 ✓';
    }
    const parts: string[] = [];
    if (hasImages) parts.push(`${images.length} 张图片`);
    if (hasAttachments) parts.push(`${attachments.length} 个附件`);
    if (parts.length > 0) {
      return `一键打包 ZIP (含 ${parts.join('、')})`;
    }
    return '一键打包 ZIP';
  };

  return (
    <div className="mt-2 rounded-lg border border-sky-200/90 bg-sky-50/40 p-2.5 text-xs text-gray-800 shadow-xs transition-all">
      {/* 头部标题与统计 */}
      <div className="flex items-center justify-between font-medium text-sky-950 mb-1.5 pb-1 border-b border-sky-200/60">
        <div className="flex items-center gap-1.5 font-semibold flex-wrap">
          <span>📄</span>
          <span>文档 Markdown 全文提取</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-800 border border-sky-300">
            约 {data.wordCount.toLocaleString()} 字 · {data.headingsCount} 章节
          </span>
          {hasImages && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-0.5">
              <span>🖼️</span>
              <span>{images.length} 张图片</span>
            </span>
          )}
          {hasAttachments && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-0.5">
              <span>📎</span>
              <span>{attachments.length} 个附件</span>
            </span>
          )}
        </div>
        <button
          onClick={() => setShowPreview(!showPreview)}
          className="text-[11px] text-sky-700 hover:text-sky-900 hover:underline"
        >
          {showPreview ? '收起预览 ▲' : '源码预览 ▼'}
        </button>
      </div>

      {/* 文档标题 */}
      <div className="text-[11.5px] font-medium text-gray-800 mb-2 truncate">
        📌 <strong>文档名称</strong>：{data.title || '当前文档'}
      </div>

      {/* Markdown 源码预览区 (可展开) */}
      {showPreview && (
        <div className="mb-2 max-h-56 overflow-y-auto rounded border border-sky-200/80 bg-white/90 p-2 font-mono text-[10.5px] leading-relaxed text-gray-700 whitespace-pre-wrap select-all">
          {data.markdown.slice(0, 3000)}
          {data.markdown.length > 3000 && (
            <div className="text-gray-400 text-center text-[10px] mt-1 pt-1 border-t border-gray-100">
              ... (余下 {(data.markdown.length - 3000).toLocaleString()} 字符已自动完整打包) ...
            </div>
          )}
        </div>
      )}

      {/* 快捷操作区 */}
      <div className="pt-1 flex items-center justify-between text-[11px] flex-wrap gap-2">
        <span className="text-sky-700/80 text-[10px]">
          {hasMedia ? '支持将图片、文件附件与 .md 一并打包为离线 Zip 压缩包' : '100% 保留 H1~H6 / 表格 / 代码块 / 待办 / 引用'}
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleCopy}
            className="text-sky-700 hover:text-sky-900 font-medium hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>📋</span>
            <span>{copied ? '已复制 ✓' : '复制 Markdown'}</span>
          </button>
          <span className="text-sky-300">|</span>
          <button
            onClick={handleDownloadMd}
            className="text-sky-700 font-medium hover:text-sky-900 hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            <span>📥</span>
            <span>仅下载 .md</span>
          </button>
          <span className="text-sky-300">|</span>
          <button
            onClick={handleDownloadZip}
            disabled={packProgress?.status === 'downloading' || packProgress?.status === 'packaging'}
            className="bg-sky-600 hover:bg-sky-700 text-white px-2 py-0.5 rounded font-semibold transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <span>📦</span>
            <span>{getZipButtonLabel()}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
