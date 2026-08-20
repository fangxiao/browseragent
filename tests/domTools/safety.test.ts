import { describe, expect, it } from 'vitest';
import {
  isSensitiveText,
  isSensitiveToolCall,
  isSensitiveNavigate,
} from '../../src/utils/domTools/safety';
import type { ToolCall } from '../../src/utils/domTools/types';

describe('safety(敏感操作判定纯函数)', () => {
  it('isSensitiveText:命中中文敏感词', () => {
    expect(isSensitiveText('提交订单')).toBe(true);
    expect(isSensitiveText('发布文章')).toBe(true);
    expect(isSensitiveText('删除账号')).toBe(true);
    expect(isSensitiveText('确认支付 99 元')).toBe(true);
  });

  it('isSensitiveText:命中英文敏感词', () => {
    expect(isSensitiveText('Submit')).toBe(true);
    expect(isSensitiveText('Publish now')).toBe(true);
    expect(isSensitiveText('Delete')).toBe(true);
    expect(isSensitiveText('Pay')).toBe(true);
  });

  it('isSensitiveText:普通操作不敏感', () => {
    expect(isSensitiveText('展开详情')).toBe(false);
    expect(isSensitiveText('查看更多')).toBe(false);
    expect(isSensitiveText('next page')).toBe(false);
    expect(isSensitiveText('')).toBe(false);
  });

  it('isSensitiveToolCall:clickElement 根据目标文本判定', () => {
    const sensitive: ToolCall = { id: '1', name: 'clickElement', args: { selector: '提交' } };
    const safe: ToolCall = { id: '2', name: 'clickElement', args: { selector: '展开' } };
    expect(isSensitiveToolCall(sensitive).sensitive).toBe(true);
    expect(isSensitiveToolCall(safe).sensitive).toBe(false);
  });

  it('isSensitiveToolCall:typeInto 密码框敏感', () => {
    const pw: ToolCall = {
      id: '3',
      name: 'typeInto',
      args: { selector: 'input[type="password"]', text: 'abc' },
    };
    const normal: ToolCall = {
      id: '4',
      name: 'typeInto',
      args: { selector: 'input[name="name"]', text: 'x' },
    };
    expect(isSensitiveToolCall(pw).sensitive).toBe(true);
    expect(isSensitiveToolCall(normal).sensitive).toBe(false);
  });

  it('isSensitiveToolCall:extractData/readPage 只读不敏感', () => {
    const rd: ToolCall = { id: '5', name: 'extractData', args: { selector: 'table' } };
    const rp: ToolCall = { id: '6', name: 'readPage', args: {} };
    expect(isSensitiveToolCall(rd).sensitive).toBe(false);
    expect(isSensitiveToolCall(rp).sensitive).toBe(false);
  });

  it('isSensitiveNavigate:跨域离开敏感', () => {
    expect(isSensitiveNavigate('https://b.com/x', 'https://a.com')).toBe(true);
    expect(isSensitiveNavigate('https://a.com/y', 'https://a.com')).toBe(false);
    expect(isSensitiveNavigate('/relative', 'https://a.com')).toBe(false);
  });

  it('isSensitiveToolCall:navigate 用注入的 currentOrigin 判定(E6)', () => {
    const sameOrigin: ToolCall = { id: '7', name: 'navigate', args: { url: 'https://a.com/next' } };
    const crossOrigin: ToolCall = { id: '8', name: 'navigate', args: { url: 'https://b.com/x' } };
    const ctx = { currentOrigin: 'https://a.com' };
    expect(isSensitiveToolCall(sameOrigin, ctx).sensitive).toBe(false);
    expect(isSensitiveToolCall(crossOrigin, ctx).sensitive).toBe(true);
  });

  it('isSensitiveToolCall:navigate 无注入 origin 时绝对 URL 按敏感处理(宁多确认)', () => {
    const call: ToolCall = { id: '9', name: 'navigate', args: { url: 'https://x.com/' } };
    expect(isSensitiveToolCall(call).sensitive).toBe(true);
    const relative: ToolCall = { id: '10', name: 'navigate', args: { url: '/page2' } };
    expect(isSensitiveToolCall(relative).sensitive).toBe(false);
  });

  it('isSensitiveToolCall:closeTabs 批量关闭标签页敏感', () => {
    const multi: ToolCall = { id: '11', name: 'closeTabs', args: { tabIds: [101, 102, 103] } };
    const single: ToolCall = { id: '12', name: 'closeTabs', args: { tabIds: [101] } };
    expect(isSensitiveToolCall(multi).sensitive).toBe(true);
    expect(isSensitiveToolCall(single).sensitive).toBe(false);
  });

  it('isSensitiveToolCall:removeBookmark 删除书签敏感', () => {
    const item: ToolCall = { id: '13', name: 'removeBookmark', args: { id: 'bm_12' } };
    const folder: ToolCall = { id: '14', name: 'removeBookmark', args: { id: 'bm_folder_3', isFolder: true } };
    expect(isSensitiveToolCall(item).sensitive).toBe(true);
    expect(isSensitiveToolCall(folder).sensitive).toBe(true);
  });

  it('isSensitiveToolCall:clearBrowsingData, deleteWorkspace 与 deleteWorkflowRecipe 敏感', () => {
    const clearCall: ToolCall = { id: '15', name: 'clearBrowsingData', args: { origins: ['https://localhost:3000'] } };
    const delWsCall: ToolCall = { id: '16', name: 'deleteWorkspace', args: { nameOrId: '调研快照' } };
    const delWfCall: ToolCall = { id: '17', name: 'deleteWorkflowRecipe', args: { nameOrId: '每日打卡' } };
    expect(isSensitiveToolCall(clearCall).sensitive).toBe(true);
    expect(isSensitiveToolCall(delWsCall).sensitive).toBe(true);
    expect(isSensitiveToolCall(delWfCall).sensitive).toBe(true);
  });
});
