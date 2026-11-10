// 工作流与 RPA 录制回放相关后台工具实现
import type { ToolCall, ToolResult } from '@/utils/domTools/types';
import {
  saveWorkflowRecipe,
  listWorkflowRecipes,
  getWorkflowRecipe,
  deleteWorkflowRecipe,
  interpolateStepVariables,
  exportWorkflowRecipesJson,
  importWorkflowRecipesJson,
} from '@/utils/workflow/storage';

export async function executeWorkflowTool(
  call: ToolCall,
  defaultTabId: number,
  callToolInTab: (tabId: number, toolCall: ToolCall) => Promise<ToolResult>,
): Promise<ToolResult | null> {
  // 1. startWorkflowRecording 开启流程录制
  if (call.name === 'startWorkflowRecording') {
    try {
      const targetTabId = Number(call.args?.tabId) || defaultTabId;
      const res = await browser.tabs.sendMessage(targetTabId, { type: 'WORKFLOW:START_RECORDING' });
      return {
        ok: true,
        data: { status: 'recording', tabId: targetTabId, note: res?.message || '🔴 已开启网页流程录制' },
      };
    } catch (err) {
      return { ok: false, error: `开启录制失败: ${(err as Error).message}` };
    }
  }

  // 2. stopWorkflowRecording 结束流程录制
  if (call.name === 'stopWorkflowRecording') {
    try {
      const targetTabId = Number(call.args?.tabId) || defaultTabId;
      const res = await browser.tabs.sendMessage(targetTabId, { type: 'WORKFLOW:STOP_RECORDING' });
      return {
        ok: true,
        data: {
          steps: res?.steps || [],
          count: res?.steps?.length || 0,
          actionCount: res?.actionCount || 0,
          note: `已成功结束录制，提炼生成 ${res?.steps?.length || 0} 个步骤`,
        },
      };
    } catch (err) {
      return { ok: false, error: `结束录制失败: ${(err as Error).message}` };
    }
  }

  // 3. saveWorkflowRecipe 保存工作流配方
  if (call.name === 'saveWorkflowRecipe') {
    try {
      const name = String(call.args?.name ?? '').trim();
      const steps = (call.args?.steps as any[]) || [];
      const description = call.args?.description ? String(call.args.description) : undefined;
      const urlPattern = call.args?.urlPattern ? String(call.args.urlPattern) : undefined;
      const parameters = (call.args?.parameters as any[]) || undefined;
      if (!name || steps.length === 0) {
        return { ok: false, error: '工作流名称与步骤列表不能为空' };
      }
      const saved = await saveWorkflowRecipe(name, steps, { description, urlPattern, parameters });
      return {
        ok: true,
        data: {
          recipe: saved,
          note: `💾 已成功保存工作流「${name}」(${steps.length} 个步骤)`,
        },
      };
    } catch (err) {
      return { ok: false, error: `保存工作流失败: ${(err as Error).message}` };
    }
  }

  // 4. listWorkflowRecipes 获取工作流列表
  if (call.name === 'listWorkflowRecipes') {
    try {
      const recipes = await listWorkflowRecipes();
      return {
        ok: true,
        data: {
          count: recipes.length,
          recipes: recipes.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            parameters: r.parameters,
            stepCount: r.steps.length,
            stepsPreview: r.steps.map((s) => s.description).join(' ➔ '),
            updatedAt: new Date(r.updatedAt).toLocaleString('zh-CN'),
          })),
          note: `已获取 ${recipes.length} 个自动化工作流`,
        },
      };
    } catch (err) {
      return { ok: false, error: `获取工作流列表失败: ${(err as Error).message}` };
    }
  }

  // 5. runWorkflowRecipe 回放执行工作流配方(支持动态变量插值)
  if (call.name === 'runWorkflowRecipe') {
    try {
      const nameOrId = String(call.args?.nameOrId ?? '').trim();
      const targetTabId = Number(call.args?.tabId) || defaultTabId;
      const variables = (call.args?.variables as Record<string, string>) || undefined;

      const recipe = await getWorkflowRecipe(nameOrId);
      if (!recipe || recipe.steps.length === 0) {
        return { ok: false, error: `未找到工作流「${nameOrId}」或该工作流无步骤` };
      }

      let targetStartUrl = recipe.startUrl || recipe.urlPattern || recipe.steps[0]?.url;
      if (!targetStartUrl && /百度|baidu/i.test(recipe.name)) {
        targetStartUrl = 'https://www.baidu.com';
      }

      if (targetStartUrl) {
        try {
          const currentTab = await browser.tabs.get(targetTabId);
          const currentUrl = currentTab?.url || '';
          const originPrefix = targetStartUrl ? targetStartUrl.split('?')[0] : '';
          if (
            /^(chrome|edge|about|chrome-extension):/i.test(currentUrl) ||
            (originPrefix && !currentUrl.startsWith(originPrefix))
          ) {
            await browser.tabs.update(targetTabId, { url: targetStartUrl });
            await new Promise((r) => setTimeout(r, 1500));
          }
        } catch {
          /* ignore */
        }
      }

      const executionLog: string[] = [];
      let stepIdx = 0;
      for (const rawStep of recipe.steps) {
        stepIdx++;
        if (!rawStep) continue;

        // 动态变量插值替换
        const step = interpolateStepVariables(rawStep, variables);
        executionLog.push(`步骤 ${stepIdx}/${recipe.steps.length}: ${step.description}`);

        let currentTabId = targetTabId;
        try {
          const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true });
          if (currentActive?.id) {
            currentTabId = currentActive.id;
          }
          if (step.url) {
            const allTabs = await browser.tabs.query({ currentWindow: true });
            const prefix = step.url.split('?')[0] || '';
            const matchTab = allTabs.find((t) => t.url && prefix && t.url.startsWith(prefix));
            if (matchTab && matchTab.id && matchTab.id !== currentTabId) {
              currentTabId = matchTab.id;
              await browser.tabs.update(matchTab.id, { active: true });
            }
          }
        } catch {
          /* ignore */
        }

        if (step.type === 'click') {
          await callToolInTab(currentTabId, {
            id: `wf_${Date.now()}_${stepIdx}`,
            name: 'clickElement',
            args: { selector: step.selector, targetText: step.targetText },
          });
        } else if (step.type === 'type') {
          await callToolInTab(currentTabId, {
            id: `wf_${Date.now()}_${stepIdx}`,
            name: 'typeInto',
            args: {
              selector: step.selector,
              targetText: step.targetText,
              text: step.value || '',
              humanLike: true,
            },
          });
        } else if (step.type === 'pressEnter') {
          await callToolInTab(currentTabId, {
            id: `wf_${Date.now()}_${stepIdx}`,
            name: 'pressEnter',
            args: { selector: step.selector, targetText: step.targetText },
          });
        } else if (step.type === 'hover') {
          await callToolInTab(currentTabId, {
            id: `wf_${Date.now()}_${stepIdx}`,
            name: 'hoverElement',
            args: { selector: step.selector, targetText: step.targetText },
          });
        } else if (step.type === 'wait') {
          await new Promise((r) => setTimeout(r, step.waitMs || 1000));
        }
        // 拟人步骤间隔 300ms
        await new Promise((r) => setTimeout(r, 300));
      }

      return {
        ok: true,
        data: {
          name: recipe.name,
          stepCount: recipe.steps.length,
          variables,
          logs: executionLog,
          note: `🎉 自动化工作流「${recipe.name}」已顺利执行完毕！`,
        },
      };
    } catch (err) {
      return { ok: false, error: `执行工作流失败: ${(err as Error).message}` };
    }
  }

  // 6. deleteWorkflowRecipe 删除工作流
  if (call.name === 'deleteWorkflowRecipe') {
    try {
      const nameOrId = String(call.args?.nameOrId ?? '').trim();
      const ok = await deleteWorkflowRecipe(nameOrId);
      if (!ok) return { ok: false, error: `未找到要删除的工作流「${nameOrId}」` };
      return {
        ok: true,
        data: { name: nameOrId, note: `🗑️ 已删除工作流「${nameOrId}」` },
      };
    } catch (err) {
      return { ok: false, error: `删除工作流失败: ${(err as Error).message}` };
    }
  }

  // 7. exportWorkflowRecipes 导出工作流配方为 JSON
  if (call.name === 'exportWorkflowRecipes') {
    try {
      const recipeIds = Array.isArray(call.args?.recipeIds) ? (call.args.recipeIds as string[]) : undefined;
      const json = await exportWorkflowRecipesJson(recipeIds);
      return {
        ok: true,
        data: {
          json,
          note: '🎉 已成功导出工作流配方 JSON 数据',
        },
      };
    } catch (err) {
      return { ok: false, error: `导出工作流失败: ${(err as Error).message}` };
    }
  }

  // 8. importWorkflowRecipes 从 JSON 导入工作流配方
  if (call.name === 'importWorkflowRecipes') {
    try {
      const jsonString = String(call.args?.json ?? call.args?.jsonString ?? '').trim();
      if (!jsonString) return { ok: false, error: '请提供有效的 json 字符串' };
      const res = await importWorkflowRecipesJson(jsonString);
      if (res.importedCount === 0 && res.errors.length > 0) {
        return { ok: false, error: `导入失败: ${res.errors.join('; ')}` };
      }
      return {
        ok: true,
        data: {
          importedCount: res.importedCount,
          importedNames: res.recipes.map((r) => r.name),
          errors: res.errors,
          note: `🎉 成功导入 ${res.importedCount} 个工作流配方！${res.errors.length > 0 ? ` (存在 ${res.errors.length} 条警告)` : ''}`,
        },
      };
    } catch (err) {
      return { ok: false, error: `导入工作流失败: ${(err as Error).message}` };
    }
  }

  return null;
}
