// Block[] → Markdown 序列化。纯函数,便于单测
import type { Block } from '../types';

const escCell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const lv = Math.min(Math.max(b.level ?? 1, 1), 6);
        lines.push(`${'#'.repeat(lv)} ${b.text}`);
        break;
      }
      case 'listItem': {
        const prefix = b.ordered ? '1.' : '-';
        const indent = '  '.repeat(b.level ?? 0);
        lines.push(`${indent}${prefix} ${b.text}`);
        break;
      }
      case 'todo':
        lines.push(`- [${b.checked ? 'x' : ' '}] ${b.text}`);
        break;
      case 'quote':
        lines.push(...b.text.split('\n').map((l) => `> ${l}`));
        break;
      case 'code':
        lines.push('```\n' + b.text + '\n```');
        break;
      case 'table': {
        const cells = b.cells ?? [];
        if (cells.length === 0) break;
        const header = cells[0]!;
        lines.push(`| ${header.map(escCell).join(' | ')} |`);
        lines.push(`| ${header.map(() => '---').join(' | ')} |`);
        for (let i = 1; i < cells.length; i++) {
          lines.push(`| ${cells[i]!.map(escCell).join(' | ')} |`);
        }
        break;
      }
      case 'divider':
        lines.push('---');
        break;
      case 'image':
        lines.push(b.src ? `![${b.text || 'image'}](${b.src})` : `[图片] ${b.text}`);
        break;
      case 'callout':
        lines.push(`> 📌 ${b.text}`);
        break;
      case 'paragraph':
      case 'unknown':
      default:
        lines.push(b.text);
    }
  }
  return lines.join('\n');
}
