// 流程自动化与测试独立全屏控制台 (Full-Screen Automation & QA Workbench)
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../assets/main.css';
import type {
  WorkflowRecipe,
  WorkflowStep,
  WorkflowMode,
  RecipeParameter,
  TestAssertion,
  TestRunReport,
  TestStepResult,
  AssertionResult,
  TestSuiteRunReport,
  TestSkillTemplate,
} from '@/utils/workflow/types';
import {
  listWorkflowRecipes,
  saveWorkflowRecipe,
  deleteWorkflowRecipe,
  listTestSkills,
  saveTestSkill,
  deleteTestSkill,
  clearAllWorkflowsAndSkills,
} from '@/utils/workflow/storage';
import { sendWorkflowMessageToTab } from '@/utils/workflow/client';

/** 严谨判断配方是否属于 QA 自动化测试用例 */
function isQaRecipe(r: WorkflowRecipe): boolean {
  if (r.mode === 'qa') return true;
  if (r.mode === 'rpa') return false;
  return Boolean(
    (r.assertions && r.assertions.length > 0) ||
      r.acceptanceCriteria ||
      /测试|test|smoke/i.test(r.name),
  );
}

function isRpaRecipe(r: WorkflowRecipe): boolean {
  return !isQaRecipe(r);
}

async function waitForTabReady(tabId: number, timeoutMs = 8000): Promise<void> {
  try {
    if (typeof browser !== 'undefined' && browser.tabs?.get) {
      const tab = await browser.tabs.get(tabId);
      if (tab?.status === 'loading') {
        await new Promise<void>((resolve) => {
          let done = false;
          const listener = (tId: number, info: { status?: string }) => {
            if (tId === tabId && info.status === 'complete' && !done) {
              done = true;
              browser.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          browser.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            if (!done) {
              done = true;
              browser.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          }, timeoutMs);
        });
      }
    }
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 400));
}

/** 获取或创建用于执行自动化操作的目标网页标签页 (确保 Workbench 自身页面保持不动) */
async function getTargetExecutionTab(preferredUrl?: string): Promise<{ tabId: number; targetUrl: string }> {
  if (typeof browser === 'undefined' || !browser.tabs?.query) {
    throw new Error('未检测到浏览器标签页环境');
  }

  const allTabs = await browser.tabs.query({ currentWindow: true });
  // 过滤掉内部受限页面 (chrome://, chrome-extension://, about:)
  const webTabs = allTabs.filter(
    (t) =>
      t.id &&
      t.url &&
      !/^(chrome|edge|about|chrome-extension):/i.test(t.url) &&
      !/chromewebstore|addons\.mozilla/i.test(t.url),
  );

  let targetUrl = preferredUrl?.trim();
  if (!targetUrl && webTabs.length === 0) {
    targetUrl = 'https://www.baidu.com';
  }

  // 1. 如果指定了 targetUrl，且已有标签页打开了该 URL
  if (targetUrl) {
    const originPrefix = targetUrl.split('?')[0] || '';
    const existing = webTabs.find((t) => t.url && originPrefix && t.url.startsWith(originPrefix));
    if (existing && existing.id) {
      await browser.tabs.update(existing.id, { active: true });
      await waitForTabReady(existing.id);
      return { tabId: existing.id, targetUrl };
    }
  }

  // 2. 如果指定了 targetUrl 但没找到打开的页面，新建一个标签页并切换过去
  if (targetUrl) {
    const newTab = await browser.tabs.create({ url: targetUrl, active: true });
    if (!newTab.id) throw new Error('创建目标网页标签页失败');
    await waitForTabReady(newTab.id, 9000);
    return { tabId: newTab.id, targetUrl };
  }

  // 3. 如果没指定 targetUrl，但窗口中有其他普通网页正在打开
  if (webTabs[0] && webTabs[0].id) {
    await browser.tabs.update(webTabs[0].id, { active: true });
    await waitForTabReady(webTabs[0].id);
    return { tabId: webTabs[0].id, targetUrl: webTabs[0].url || '' };
  }

  // 兜底新建
  const defaultTab = await browser.tabs.create({ url: 'https://www.baidu.com', active: true });
  if (!defaultTab.id) throw new Error('未能建立目标执行网页');
  await waitForTabReady(defaultTab.id, 9000);
  return { tabId: defaultTab.id, targetUrl: 'https://www.baidu.com' };
}

function interpolateStep(step: WorkflowStep, variables: Record<string, string>): WorkflowStep {
  let val = step.value || '';
  let desc = step.description;
  for (const [k, v] of Object.entries(variables)) {
    const reg = new RegExp(`{{\\s*${k}\\s*}}`, 'g');
    val = val.replace(reg, v);
    desc = desc.replace(reg, v);
  }
  return { ...step, value: val, description: desc };
}

function downloadFile(content: string, filename: string, mime = 'text/html;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function generateHtmlTestReport(report: TestRunReport): string {
  const dateStr = new Date(report.startTime).toLocaleString('zh-CN');
  const isPass = report.status === 'PASS';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>自动化测试报告 - ${report.recipeName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; background: #f8fafc; color: #1e293b; }
    .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); padding: 32px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 700; margin: 0; }
    .badge { padding: 4px 14px; border-radius: 9999px; font-weight: 700; font-size: 14px; }
    .badge-pass { background: #dcfce7; color: #166534; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
    .metric-card { background: #f1f5f9; padding: 14px; border-radius: 8px; text-align: center; }
    .metric-val { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 4px; }
    .section-title { font-size: 16px; font-weight: 600; margin: 24px 0 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1 class="title">🧪 ${report.recipeName}</h1>
        <div style="color: #64748b; font-size: 13px; margin-top: 6px;">执行时间: ${dateStr} · 耗时: ${(report.durationMs / 1000).toFixed(2)}s</div>
      </div>
      <span class="badge ${isPass ? 'badge-pass' : 'badge-fail'}">${isPass ? '🟢 PASS 通过' : '🔴 FAIL 失败'}</span>
    </div>
    <div class="metrics">
      <div class="metric-card"><div>总耗时</div><div class="metric-val">${(report.durationMs / 1000).toFixed(2)}s</div></div>
      <div class="metric-card"><div>步骤成功率</div><div class="metric-val" style="color: #16a34a;">${report.passedSteps} / ${report.totalSteps}</div></div>
      <div class="metric-card"><div>断言通过率</div><div class="metric-val" style="color: #7c3aed;">${report.passedAssertions} / ${report.totalAssertions}</div></div>
    </div>
    <div class="section-title">🎯 验收标准与断言检查</div>
    <table>
      <thead><tr><th>序号</th><th>检查项描述</th><th>预期目标</th><th>实际结果</th><th>状态</th></tr></thead>
      <tbody>
        ${report.assertionsResults.map((a, i) => `<tr><td>${i + 1}</td><td>${a.description}</td><td><code>${a.expected}</code></td><td>${a.actual}</td><td>${a.ok ? '🟢 PASS' : '🔴 FAIL'}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="section-title">⏱️ 步骤执行明细</div>
    <table>
      <thead><tr><th>步骤</th><th>操作描述</th><th>耗时</th><th>状态</th><th>异常说明</th></tr></thead>
      <tbody>
        ${report.stepsResults.map((s) => `<tr><td>${s.stepIndex}</td><td>${s.description}</td><td>${(s.durationMs / 1000).toFixed(2)}s</td><td>${s.ok ? '✅' : '❌'}</td><td>${s.error || '-'}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function parseSkillText(raw: string): { name?: string; criteria?: string; targetUrl?: string; assertions: TestAssertion[] } {
  const text = raw.trim();
  if (!text) return { assertions: [] };
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const obj = JSON.parse(text);
      const assertions: TestAssertion[] = Array.isArray(obj.assertions)
        ? obj.assertions.map((a: any) => ({
            id: a.id || `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            type: a.type || 'text_contains',
            target: String(a.target || a.expected || '').trim(),
            description: a.description || `检查 ${a.target || ''}`,
          }))
        : [];
      return {
        name: obj.name || '',
        criteria: obj.acceptanceCriteria || obj.criteria || '',
        targetUrl: obj.targetUrl || obj.url || '',
        assertions,
      };
    } catch {
      /* ignore */
    }
  }

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let name = '';
  let criteria = '';
  let targetUrl = '';
  const assertions: TestAssertion[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      name = line.replace(/^#+\s*/, '').replace(/^[🎯🧪📋\s]+/, '').trim();
      continue;
    }
    const cleanLine = line.replace(/^[-*•]\s*/, '').trim();
    const critMatch = cleanLine.match(/^\[?(?:验收标准|期望结果|criteria)\]?[:：\s]*(.+)$/i);
    if (critMatch && critMatch[1]) {
      criteria = critMatch[1].trim();
      continue;
    }
    const urlTargetMatch = cleanLine.match(/^\[?(?:目标页面|目标网址|目标url|targeturl)\]?[:：\s]*(.+)$/i);
    if (urlTargetMatch && urlTargetMatch[1]) {
      targetUrl = urlTargetMatch[1].trim();
      continue;
    }
    const textMatch = cleanLine.match(/^\[?(?:文本包含|包含文本|页面文本|text)\]?[:：\s]*(.+)$/i);
    if (textMatch && textMatch[1]) {
      const target = textMatch[1].replace(/^['"「]|['"」]$/g, '').trim();
      assertions.push({
        id: `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text_contains',
        target,
        description: `页面包含文本「${target}」`,
      });
      continue;
    }
    const urlMatch = cleanLine.match(/^\[?(?:URL包含|网址包含|路由|url)\]?[:：\s]*(.+)$/i);
    if (urlMatch && urlMatch[1]) {
      const target = urlMatch[1].replace(/^['"「]|['"」]$/g, '').trim();
      assertions.push({
        id: `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'url_contains',
        target,
        description: `URL 包含「${target}」`,
      });
      continue;
    }
    const elMatch = cleanLine.match(/^\[?(?:元素可见|元素存在|选择器|element|selector)\]?[:：\s]*(.+)$/i);
    if (elMatch && elMatch[1]) {
      const target = elMatch[1].replace(/^['"「]|['"」]$/g, '').trim();
      assertions.push({
        id: `as_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'element_visible',
        target,
        description: `元素可见「${target}」`,
      });
      continue;
    }
  }

  return { name, criteria, targetUrl, assertions };
}

export function WorkbenchApp() {
  const [recipes, setRecipes] = useState<WorkflowRecipe[]>([]);
  const [skillsList, setSkillsList] = useState<TestSkillTemplate[]>([]);
  const [activeNav, setActiveNav] = useState<'rpa' | 'qa' | 'skills' | 'reports'>('rpa');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  // 运行与报告状态
  const [runningId, setRunningId] = useState<string | null>(null);
  const [isSuiteRunning, setIsSuiteRunning] = useState(false);
  const [activeReport, setActiveReport] = useState<TestRunReport | null>(null);
  const [suiteReport, setSuiteReport] = useState<TestSuiteRunReport | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // 参数化代办执行弹窗
  const [paramModal, setParamModal] = useState<{ recipe: WorkflowRecipe; values: Record<string, string> } | null>(null);

  // 导入 Skill 弹窗
  const [showImportSkillModal, setShowImportSkillModal] = useState(false);
  const [importInput, setImportInput] = useState('');

  const refreshData = async () => {
    try {
      const list = await listWorkflowRecipes();
      setRecipes(list);
      const skills = await listTestSkills();
      setSkillsList(skills);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as 'rpa' | 'qa' | 'skills' | 'reports' | null;
    if (tabParam && ['rpa', 'qa', 'skills', 'reports'].includes(tabParam)) {
      setActiveNav(tabParam);
    }
    void refreshData();
  }, []);

  useEffect(() => {
    if (activeNav === 'rpa') {
      const first = recipes.find(isRpaRecipe);
      if (first && !selectedRecipeId) setSelectedRecipeId(first.id);
    } else if (activeNav === 'qa') {
      const first = recipes.find(isQaRecipe);
      if (first && !selectedRecipeId) setSelectedRecipeId(first.id);
    } else if (activeNav === 'skills') {
      if (skillsList.length > 0 && !selectedSkillId && skillsList[0]) setSelectedSkillId(skillsList[0].id);
    }
  }, [activeNav, recipes, skillsList]);

  const rpaRecipes = recipes.filter(isRpaRecipe);
  const qaRecipes = recipes.filter(isQaRecipe);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId);
  const selectedSkill = skillsList.find((s) => s.id === selectedSkillId);

  /** 执行 RPA 业务流程 (安全定位目标网页标签页) */
  const executeRpa = async (recipe: WorkflowRecipe, variables: Record<string, string> = {}) => {
    setRunningId(recipe.id);
    setStatusMsg({ type: 'info', text: `▶️ 正在连接目标网页并执行代办「${recipe.name}」...` });
    try {
      const preferredUrl = recipe.startUrl || recipe.urlPattern || recipe.steps[0]?.url;
      const { tabId: targetTabId, targetUrl } = await getTargetExecutionTab(preferredUrl);

      setStatusMsg({ type: 'info', text: `🌐 已定位目标网页: ${targetUrl}，开始执行 ${recipe.steps.length} 步操作...` });

      let stepIndex = 0;
      let lastTabId = targetTabId;
      let hasStepError = false;

      for (const rawStep of recipe.steps) {
        stepIndex++;
        const step = interpolateStep(rawStep, variables);
        setStatusMsg({
          type: 'info',
          text: `▶️ [代办执行 ${stepIndex}/${recipe.steps.length}] ${step.description}...`,
        });

        let currentTabId = lastTabId;
        try {
          const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true });
          if (currentActive?.id && !/chrome-extension:/i.test(currentActive.url || '')) {
            currentTabId = currentActive.id;
            lastTabId = currentActive.id;
          }
        } catch {
          /* ignore */
        }

        await waitForTabReady(currentTabId);

        let res: any;
        try {
          if (step.type === 'click') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_${Date.now()}`,
                name: 'clickElement',
                args: { selector: step.selector, targetText: step.targetText },
              },
            });
          } else if (step.type === 'type') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_${Date.now()}`,
                name: 'typeInto',
                args: {
                  selector: step.selector,
                  targetText: step.targetText,
                  text: step.value || '',
                  humanLike: true,
                },
              },
            });
          } else if (step.type === 'pressEnter') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_${Date.now()}`,
                name: 'pressEnter',
                args: { selector: step.selector, targetText: step.targetText },
              },
            });
          } else if (step.type === 'hover') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_${Date.now()}`,
                name: 'hoverElement',
                args: { selector: step.selector, targetText: step.targetText },
              },
            });
          }
        } catch (stepErr) {
          const isNavClose = /closed before a response was received|message channel closed/i.test(
            (stepErr as Error).message || '',
          );
          if (isNavClose && (step.type === 'click' || step.type === 'pressEnter')) {
            res = { result: { ok: true, note: '操作已触发页面跳转' } };
          } else {
            res = { result: { ok: false, error: (stepErr as Error).message } };
          }
        }

        if (res && res.result && !res.result.ok) {
          hasStepError = true;
          setStatusMsg({
            type: 'error',
            text: `⚠️ 步骤 ${stepIndex} (${step.description}) 未执行成功: ${res.result.error || '未找到目标元素'}`,
          });
        }
        await new Promise((r) => setTimeout(r, 450));
      }

      // 如果 RPA 配方绑定了 Skill 验收规则，在执行完毕后自动进行业务结果校验
      if (!hasStepError && recipe.assertions && recipe.assertions.length > 0) {
        try {
          const assertRes = await sendWorkflowMessageToTab(lastTabId, {
            type: 'TOOL:CALL',
            call: {
              id: `rpa_assert_${Date.now()}`,
              name: 'assertPage',
              args: { assertions: recipe.assertions, acceptanceCriteria: recipe.acceptanceCriteria || '' },
            },
          });
          const assertData = assertRes?.result?.data || {};
          const passedAssertions = assertData.passedAssertions ?? (assertData.assertionsResults || []).filter((a: any) => a.ok).length;
          const totalAssertions = recipe.assertions.length;
          const isSkillPass = passedAssertions === totalAssertions;

          setStatusMsg({
            type: isSkillPass ? 'success' : 'error',
            text: isSkillPass
              ? `🎉 代办「${recipe.name}」已执行完毕，并通过绑定的业务 Skill 结果校验！`
              : `⚠️ 代办动作已执行完毕，但绑定的业务 Skill 校验未通过 (${passedAssertions}/${totalAssertions} 项成功)，请核对页面状态。`,
          });
          return;
        } catch {
          /* ignore */
        }
      }

      if (!hasStepError) {
        setStatusMsg({
          type: 'success',
          text: `🎉 代办工作流「${recipe.name}」已全部执行完毕！`,
        });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `执行异常: ${(err as Error).message}` });
    } finally {
      setRunningId(null);
    }
  };

  /** 执行单个 QA 自动化测试用例 (安全定位目标网页标签页) */
  const executeSingleQaTest = async (recipe: WorkflowRecipe): Promise<TestRunReport> => {
    const startTime = Date.now();
    const stepsResults: TestStepResult[] = [];
    let passedSteps = 0;

    const preferredUrl = recipe.startUrl || recipe.urlPattern || recipe.steps[0]?.url;
    const { tabId: targetTabId, targetUrl } = await getTargetExecutionTab(preferredUrl);

    setStatusMsg({ type: 'info', text: `🧪 定位到目标网页: ${targetUrl}，正在测试「${recipe.name}」...` });

    let stepIndex = 0;
    let lastTabId = targetTabId;

    for (const step of recipe.steps) {
      stepIndex++;
      const stepStart = Date.now();

      let currentTabId = lastTabId;
      try {
        const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true });
        if (currentActive?.id && !/chrome-extension:/i.test(currentActive.url || '')) {
          currentTabId = currentActive.id;
          lastTabId = currentActive.id;
        }
      } catch {
        /* ignore */
      }

      await waitForTabReady(currentTabId);

      let res: any = null;
      try {
        if (step.type === 'click') {
          res = await sendWorkflowMessageToTab(currentTabId, {
            type: 'TOOL:CALL',
            call: {
              id: `test_${Date.now()}`,
              name: 'clickElement',
              args: { selector: step.selector, targetText: step.targetText },
            },
          });
        } else if (step.type === 'type') {
          res = await sendWorkflowMessageToTab(currentTabId, {
            type: 'TOOL:CALL',
            call: {
              id: `test_${Date.now()}`,
              name: 'typeInto',
              args: {
                selector: step.selector,
                targetText: step.targetText,
                text: step.value || '',
                humanLike: true,
              },
            },
          });
        } else if (step.type === 'pressEnter') {
          res = await sendWorkflowMessageToTab(currentTabId, {
            type: 'TOOL:CALL',
            call: {
              id: `test_${Date.now()}`,
              name: 'pressEnter',
              args: { selector: step.selector, targetText: step.targetText },
            },
          });
        } else if (step.type === 'hover') {
          res = await sendWorkflowMessageToTab(currentTabId, {
            type: 'TOOL:CALL',
            call: {
              id: `test_${Date.now()}`,
              name: 'hoverElement',
              args: { selector: step.selector, targetText: step.targetText },
            },
          });
        }
      } catch (stepErr) {
        const isNavClose = /closed before a response was received|message channel closed/i.test(
          (stepErr as Error).message || '',
        );
        if (isNavClose && (step.type === 'click' || step.type === 'pressEnter')) {
          res = { result: { ok: true, note: '操作触发了页面跳转' } };
        } else {
          res = { result: { ok: false, error: (stepErr as Error).message } };
        }
      }

      const stepDuration = Date.now() - stepStart;
      const stepOk = Boolean(res?.result?.ok);
      if (stepOk) passedSteps++;

      stepsResults.push({
        stepIndex,
        description: step.description,
        durationMs: stepDuration,
        ok: stepOk,
        error: res?.result?.ok ? undefined : res?.result?.error || '操作执行失败',
      });

      await new Promise((r) => setTimeout(r, 450));
    }

    let assertRes: any = null;
    try {
      assertRes = await sendWorkflowMessageToTab(lastTabId, {
        type: 'TOOL:CALL',
        call: {
          id: `assert_${Date.now()}`,
          name: 'assertPage',
          args: {
            assertions: recipe.assertions || [],
            acceptanceCriteria: recipe.acceptanceCriteria || '',
          },
        },
      });
    } catch (assertErr) {
      assertRes = {
        result: {
          ok: false,
          error: (assertErr as Error).message,
          data: {
            assertionsResults: (recipe.assertions || []).map((a) => ({
              id: a.id,
              description: a.description,
              expected: a.target,
              actual: '通信异常: ' + (assertErr as Error).message,
              ok: false,
            })),
            passedAssertions: 0,
          },
        },
      };
    }

    const assertData = assertRes?.result?.data || {};
    const assertionsResults: AssertionResult[] = assertData.assertionsResults || [];
    const totalAssertions = recipe.assertions?.length || assertionsResults.length;
    const passedAssertions = assertData.passedAssertions ?? assertionsResults.filter((a: any) => a.ok).length;
    const allStepsOk = passedSteps === recipe.steps.length;
    const allAssertionsOk = totalAssertions === 0 || passedAssertions === totalAssertions;
    const isHealthy = !assertData.systemHealth?.isWhiteScreen;

    const testStatus: 'PASS' | 'FAIL' | 'WARNING' =
      allStepsOk && allAssertionsOk && isHealthy ? 'PASS' : 'FAIL';

    const totalDuration = Date.now() - startTime;
    const report: TestRunReport = {
      id: `tr_${Date.now()}`,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: testStatus,
      startTime,
      durationMs: totalDuration,
      totalSteps: recipe.steps.length,
      passedSteps,
      totalAssertions,
      passedAssertions,
      stepsResults,
      assertionsResults,
      systemHealth: {
        pageUrl: assertData.systemHealth?.pageUrl || '',
        pageTitle: assertData.systemHealth?.pageTitle || '',
        consoleErrorsCount: 0,
        consoleErrors: [],
        isWhiteScreen: Boolean(assertData.systemHealth?.isWhiteScreen),
      },
      summary:
        testStatus === 'PASS'
          ? `🎉 测试通过！${recipe.steps.length} 步操作与 ${totalAssertions} 项断言均验证成功。`
          : `⚠️ 测试未通过: ${recipe.steps.length - passedSteps} 步骤异常, ${totalAssertions - passedAssertions} 断言失败。`,
    };

    try {
      await saveWorkflowRecipe(recipe.name, recipe.steps, {
        id: recipe.id,
        mode: 'qa',
        description: recipe.description,
        startUrl: recipe.startUrl,
        urlPattern: recipe.urlPattern,
        assertions: recipe.assertions,
        acceptanceCriteria: recipe.acceptanceCriteria,
        lastTestReport: report,
      });
    } catch {
      /* ignore */
    }

    return report;
  };

  /** 执行 Skill 一键验收 (安全定位目标网页标签页) */
  const executeSkillRun = async (skill: TestSkillTemplate) => {
    setStatusMsg({ type: 'info', text: `🧪 正在定位目标网页并执行「${skill.name}」验收断言...` });
    try {
      const { tabId: targetTabId, targetUrl } = await getTargetExecutionTab(skill.targetUrl);

      const assertRes = await sendWorkflowMessageToTab(targetTabId, {
        type: 'TOOL:CALL',
        call: {
          id: `skill_run_${Date.now()}`,
          name: 'assertPage',
          args: {
            assertions: skill.assertions || [],
            acceptanceCriteria: skill.acceptanceCriteria || '',
          },
        },
      });

      const assertData = assertRes?.result?.data || {};
      const assertionsResults: AssertionResult[] = assertData.assertionsResults || [];
      const totalAssertions = skill.assertions?.length || assertionsResults.length;
      const passedAssertions = assertData.passedAssertions ?? assertionsResults.filter((a: any) => a.ok).length;
      const isHealthy = !assertData.systemHealth?.isWhiteScreen;
      const isPass = (totalAssertions === 0 || passedAssertions === totalAssertions) && isHealthy;

      const report: TestRunReport = {
        id: `tr_skill_${Date.now()}`,
        recipeId: skill.id,
        recipeName: `[Skill 验收] ${skill.name}`,
        status: isPass ? 'PASS' : 'FAIL',
        startTime: Date.now(),
        durationMs: 450,
        totalSteps: 0,
        passedSteps: 0,
        totalAssertions,
        passedAssertions,
        stepsResults: [],
        assertionsResults,
        systemHealth: {
          pageUrl: assertData.systemHealth?.pageUrl || '',
          pageTitle: assertData.systemHealth?.pageTitle || '',
          consoleErrorsCount: 0,
          consoleErrors: [],
          isWhiteScreen: Boolean(assertData.systemHealth?.isWhiteScreen),
        },
        summary: isPass
          ? `🎉 页面验收通过！${totalAssertions} 项检查点全部符合预期。`
          : `⚠️ 页面验收未通过: ${totalAssertions - passedAssertions} 项检查失败。`,
      };

      setActiveReport(report);
      setStatusMsg({
        type: isPass ? 'success' : 'error',
        text: `🧪 验收完成: ${isPass ? '🟢 全部通过 (PASS)' : '🔴 验收未通过 (FAIL)'}`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `验收异常: ${(err as Error).message}` });
    }
  };

  /** 运行全量测试套件 */
  const executeAllTestSuite = async () => {
    if (qaRecipes.length === 0) {
      setStatusMsg({ type: 'info', text: '暂无可执行的自动化测试用例' });
      return;
    }

    setIsSuiteRunning(true);
    const suiteStart = Date.now();
    const reports: TestRunReport[] = [];

    try {
      let idx = 0;
      for (const recipe of qaRecipes) {
        idx++;
        setStatusMsg({
          type: 'info',
          text: `⚡ [运行测试套件 ${idx}/${qaRecipes.length}] 正在执行「${recipe.name}」...`,
        });
        try {
          const rep = await executeSingleQaTest(recipe);
          reports.push(rep);
        } catch (singleErr) {
          reports.push({
            id: `tr_${Date.now()}`,
            recipeId: recipe.id,
            recipeName: recipe.name,
            status: 'FAIL',
            startTime: Date.now(),
            durationMs: 0,
            totalSteps: recipe.steps.length,
            passedSteps: 0,
            totalAssertions: recipe.assertions?.length || 0,
            passedAssertions: 0,
            stepsResults: [],
            assertionsResults: [],
            systemHealth: { pageUrl: '', pageTitle: '', consoleErrorsCount: 0, consoleErrors: [], isWhiteScreen: false },
            summary: `用例执行异常: ${(singleErr as Error).message}`,
          });
        }
        await new Promise((r) => setTimeout(r, 500));
      }

      await refreshData();
      const passedCount = reports.filter((r) => r.status === 'PASS').length;
      const suite: TestSuiteRunReport = {
        id: `suite_${Date.now()}`,
        suiteName: `全量自动化测试套件 (${reports.length} 个用例)`,
        startTime: suiteStart,
        durationMs: Date.now() - suiteStart,
        totalRecipes: reports.length,
        passedRecipes: passedCount,
        failedRecipes: reports.length - passedCount,
        recipeReports: reports,
        summary: `测试套件执行完成：${passedCount}/${reports.length} 个用例通过 (${Math.round((passedCount / reports.length) * 100)}%)`,
      };

      setSuiteReport(suite);
      setActiveNav('reports');
      setStatusMsg({
        type: passedCount === reports.length ? 'success' : 'error',
        text: `🏁 测试套件完成: ${passedCount}/${reports.length} 用例通过！`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `套件执行异常: ${(err as Error).message}` });
    } finally {
      setIsSuiteRunning(false);
    }
  };

  /** 切换配方模式 (RPA <-> QA) */
  const toggleRecipeMode = async (recipe: WorkflowRecipe) => {
    const isCurrentlyQa = isQaRecipe(recipe);
    const newMode: WorkflowMode = isCurrentlyQa ? 'rpa' : 'qa';
    try {
      await saveWorkflowRecipe(recipe.name, recipe.steps, {
        id: recipe.id,
        mode: newMode,
        description: recipe.description,
        startUrl: recipe.startUrl,
        urlPattern: recipe.urlPattern,
        parameters: recipe.parameters,
        assertions: recipe.assertions,
        acceptanceCriteria: recipe.acceptanceCriteria,
        lastTestReport: recipe.lastTestReport,
      });
      await refreshData();
      setStatusMsg({
        type: 'success',
        text: `🔄 已将「${recipe.name}」切换为 ${newMode === 'qa' ? '🧪 自动化测试用例' : '🤖 业务代办工作流'}`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `切换失败: ${(err as Error).message}` });
    }
  };

  /** 删除配方 */
  const handleDeleteRecipe = async (id: string, name: string) => {
    if (!confirm(`确定要删除「${name}」吗？`)) return;
    try {
      await deleteWorkflowRecipe(id);
      await refreshData();
      if (selectedRecipeId === id) setSelectedRecipeId(null);
      setStatusMsg({ type: 'success', text: `🗑️ 已删除「${name}」` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `删除失败: ${(err as Error).message}` });
    }
  };

  /** 删除自定义 Skill */
  const handleDeleteSkill = async (id: string, name: string) => {
    if (!confirm(`确定要删除 Skill「${name}」吗？`)) return;
    try {
      await deleteTestSkill(id);
      await refreshData();
      if (selectedSkillId === id) setSelectedSkillId(null);
      setStatusMsg({ type: 'success', text: `🗑️ 已删除 Skill「${name}」` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `删除失败: ${(err as Error).message}` });
    }
  };

  /** 导入 Skill */
  const handleImportSkill = async (raw: string) => {
    const { name, criteria, targetUrl, assertions } = parseSkillText(raw);
    if (!criteria && assertions.length === 0) {
      setStatusMsg({ type: 'error', text: '未能解析出有效的验收标准或断言' });
      return;
    }
    const skillName = name || `导入 Skill ${new Date().toLocaleDateString()}`;
    try {
      const sk = await saveTestSkill(skillName, criteria || '', assertions, undefined, targetUrl);
      await refreshData();
      setSelectedSkillId(sk.id);
      setShowImportSkillModal(false);
      setImportInput('');
      setStatusMsg({ type: 'success', text: `📥 成功导入 Skill「${skillName}」！包含 ${assertions.length} 条断言` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `导入失败: ${(err as Error).message}` });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100 font-sans">
      {/* 顶部专业控制台 Header */}
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-3.5 shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg text-lg">
            ⚡
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">流程自动化与测试控制台</h1>
              <span className="rounded bg-indigo-950 border border-indigo-700/60 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
                Full Workbench v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              高自由度 DOM 自动化编排、参数化 RPA 业务代办与全量回归测试套件中心
            </p>
          </div>
        </div>

        {/* 顶部核心指标徽章与快捷动作 */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
            <span className="text-slate-400">业务代办:</span>
            <b className="text-purple-400">{rpaRecipes.length}</b>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">测试用例:</span>
            <b className="text-indigo-400">{qaRecipes.length}</b>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">验收 Skill:</span>
            <b className="text-blue-400">{skillsList.length}</b>
          </div>

          <button
            onClick={() => setShowImportSkillModal(true)}
            className="flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-all cursor-pointer"
          >
            <span>📥</span>
            <span>导入 Skill / Markdown</span>
          </button>

          <button
            disabled={isSuiteRunning || qaRecipes.length === 0}
            onClick={() => void executeAllTestSuite()}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-indigo-500 disabled:opacity-50 transition-all cursor-pointer"
          >
            <span>⚡</span>
            <span>{isSuiteRunning ? '套件运行中...' : '运行全量测试套件'}</span>
          </button>
        </div>
      </header>

      {/* 状态提示条 */}
      {statusMsg && (
        <div
          className={`flex items-center justify-between px-6 py-2 text-xs transition-all ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/80 text-emerald-200 border-b border-emerald-800'
              : statusMsg.type === 'info'
                ? 'bg-indigo-950/80 text-indigo-200 border-b border-indigo-800'
                : 'bg-rose-950/80 text-rose-200 border-b border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{statusMsg.type === 'success' ? '✅' : statusMsg.type === 'info' ? 'ℹ️' : '⚠️'}</span>
            <span>{statusMsg.text}</span>
          </div>
          <button onClick={() => setStatusMsg(null)} className="text-slate-400 hover:text-white cursor-pointer">
            ✕
          </button>
        </div>
      )}

      {/* 主体两栏布局 (左侧导航与列表 + 右侧工作区) */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧侧边栏 */}
        <div className="w-80 border-r border-slate-800 bg-slate-950/70 flex flex-col">
          {/* 主导航 Tab */}
          <div className="grid grid-cols-4 p-2 gap-1 border-b border-slate-800 text-xs font-medium">
            <button
              onClick={() => setActiveNav('rpa')}
              className={`py-1.5 rounded-md text-center transition-all cursor-pointer ${
                activeNav === 'rpa'
                  ? 'bg-purple-900/60 text-purple-300 font-bold border border-purple-700/60'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              🤖 代办 ({rpaRecipes.length})
            </button>
            <button
              onClick={() => setActiveNav('qa')}
              className={`py-1.5 rounded-md text-center transition-all cursor-pointer ${
                activeNav === 'qa'
                  ? 'bg-indigo-900/60 text-indigo-300 font-bold border border-indigo-700/60'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              🧪 测试 ({qaRecipes.length})
            </button>
            <button
              onClick={() => setActiveNav('skills')}
              className={`py-1.5 rounded-md text-center transition-all cursor-pointer ${
                activeNav === 'skills'
                  ? 'bg-blue-900/60 text-blue-300 font-bold border border-blue-700/60'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              🎯 Skill ({skillsList.length})
            </button>
            <button
              onClick={() => setActiveNav('reports')}
              className={`py-1.5 rounded-md text-center transition-all cursor-pointer ${
                activeNav === 'reports'
                  ? 'bg-emerald-900/60 text-emerald-300 font-bold border border-emerald-700/60'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              📊 大屏
            </button>
          </div>

          {/* 搜索框 */}
          <div className="p-2.5 border-b border-slate-800">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索名称、URL 或断言..."
              className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
            />
          </div>

          {/* 列表内容区 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {activeNav === 'rpa' && (
              rpaRecipes
                .filter((r) => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRecipeId(r.id)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedRecipeId === r.id
                        ? 'bg-purple-950/40 border-purple-600 shadow-md ring-1 ring-purple-500/50 text-white'
                        : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs truncate">{r.name}</span>
                        {r.parameters && r.parameters.length > 0 && (
                          <span className="rounded bg-amber-950 border border-amber-800 px-1 py-0.2 text-[9px] text-amber-300 font-mono">
                            {r.parameters.length} 变量
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {r.steps.length} 步骤 · 起始: {r.startUrl || '当前页'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (r.parameters && r.parameters.length > 0) {
                          const initialVals: Record<string, string> = {};
                          r.parameters.forEach((p) => (initialVals[p.key] = p.defaultValue || ''));
                          setParamModal({ recipe: r, values: initialVals });
                        } else {
                          void executeRpa(r);
                        }
                      }}
                      className="rounded bg-emerald-600/80 hover:bg-emerald-500 px-2 py-1 text-[10px] font-medium text-white shadow-xs cursor-pointer shrink-0"
                    >
                      ▶️ 运行
                    </button>
                  </div>
                ))
            )}

            {activeNav === 'qa' && (
              qaRecipes
                .filter((r) => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((r) => {
                  const rep = r.lastTestReport;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRecipeId(r.id)}
                      className={`group flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                        selectedRecipeId === r.id
                          ? 'bg-indigo-950/40 border-indigo-600 shadow-md ring-1 ring-indigo-500/50 text-white'
                          : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs truncate">{r.name}</span>
                          {rep && (
                            <span
                              className={`rounded px-1.5 py-0.2 text-[9px] font-bold ${
                                rep.status === 'PASS'
                                  ? 'bg-emerald-950 border border-emerald-700 text-emerald-400'
                                  : 'bg-rose-950 border border-rose-700 text-rose-400'
                              }`}
                            >
                              {rep.status === 'PASS' ? 'PASS' : 'FAIL'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {r.steps.length} 步骤 · {r.assertions?.length || 0} 断言
                        </div>
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setRunningId(r.id);
                          try {
                            const rep = await executeSingleQaTest(r);
                            await refreshData();
                            setActiveReport(rep);
                          } finally {
                            setRunningId(null);
                          }
                        }}
                        className="rounded bg-indigo-600/80 hover:bg-indigo-500 px-2 py-1 text-[10px] font-medium text-white shadow-xs cursor-pointer shrink-0"
                      >
                        🧪 测试
                      </button>
                    </div>
                  );
                })
            )}

            {activeNav === 'skills' && (
              skillsList
                .filter((s) => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSkillId(s.id)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                      selectedSkillId === s.id
                        ? 'bg-blue-950/40 border-blue-600 shadow-md ring-1 ring-blue-500/50 text-white'
                        : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs truncate">{s.name}</span>
                        <span className="rounded bg-blue-950 border border-blue-800 px-1 py-0.2 text-[8.5px] text-blue-300">
                          {s.isPreset ? '预设' : '自定义'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {s.targetUrl ? `🌐 ${s.targetUrl.replace(/^https?:\/\//, '')} · ` : ''}
                        {s.assertions.length} 条断言
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void executeSkillRun(s);
                      }}
                      className="rounded bg-blue-600/80 hover:bg-blue-500 px-2 py-1 text-[10px] font-medium text-white shadow-xs cursor-pointer shrink-0"
                    >
                      🧪 验页
                    </button>
                  </div>
                ))
            )}

            {activeNav === 'reports' && (
              <div className="p-3 text-xs text-slate-400 space-y-2">
                <div>点击顶部「⚡ 运行全量测试套件」可聚合生成大屏。</div>
                {suiteReport && (
                  <div className="rounded-lg bg-slate-900 p-2.5 border border-slate-800 text-[11px] space-y-1">
                    <div className="font-bold text-white">{suiteReport.suiteName}</div>
                    <div className="text-emerald-400">通过: {suiteReport.passedRecipes}/{suiteReport.totalRecipes}</div>
                    <div className="text-slate-500">耗时: {(suiteReport.durationMs / 1000).toFixed(2)}s</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧详情与编排工作区 */}
        <div className="flex-1 bg-slate-900 overflow-y-auto p-6 space-y-6">
          {(activeNav === 'rpa' || activeNav === 'qa') && selectedRecipe ? (
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              {/* 配方顶部概览栏 */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold text-white tracking-tight">{selectedRecipe.name}</h2>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        isQaRecipe(selectedRecipe)
                          ? 'bg-indigo-950 border border-indigo-700 text-indigo-300'
                          : 'bg-purple-950 border border-purple-700 text-purple-300'
                      }`}
                    >
                      {isQaRecipe(selectedRecipe) ? '🧪 QA 自动化测试用例' : '🤖 RPA 业务代办流程'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 flex items-center gap-4 flex-wrap">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0">起始网址:</span>
                      <b
                        title={selectedRecipe.startUrl || selectedRecipe.steps[0]?.url || '当前活动页'}
                        className="text-slate-200 font-mono max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg truncate inline-block cursor-help bg-slate-950 px-2 py-0.5 rounded border border-slate-800"
                      >
                        {selectedRecipe.startUrl || selectedRecipe.steps[0]?.url || '当前活动页'}
                      </b>
                    </span>
                    <span className="shrink-0">步骤总数: <b className="text-slate-200">{selectedRecipe.steps.length} 步</b></span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void toggleRecipeMode(selectedRecipe)}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                  >
                    🔄 转为{isQaRecipe(selectedRecipe) ? '「业务代办」' : '「自动化测试」'}
                  </button>
                  <button
                    onClick={() => void handleDeleteRecipe(selectedRecipe.id, selectedRecipe.name)}
                    className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/50 cursor-pointer"
                  >
                    🗑️ 删除
                  </button>
                  {isQaRecipe(selectedRecipe) ? (
                    <button
                      disabled={runningId === selectedRecipe.id}
                      onClick={async () => {
                        setRunningId(selectedRecipe.id);
                        try {
                          const rep = await executeSingleQaTest(selectedRecipe);
                          await refreshData();
                          setActiveReport(rep);
                        } finally {
                          setRunningId(null);
                        }
                      }}
                      className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      {runningId === selectedRecipe.id ? '🧪 测试运行中...' : '🧪 立即运行测试'}
                    </button>
                  ) : (
                    <button
                      disabled={runningId === selectedRecipe.id}
                      onClick={() => {
                        if (selectedRecipe.parameters && selectedRecipe.parameters.length > 0) {
                          const initialVals: Record<string, string> = {};
                          selectedRecipe.parameters.forEach((p) => (initialVals[p.key] = p.defaultValue || ''));
                          setParamModal({ recipe: selectedRecipe, values: initialVals });
                        } else {
                          void executeRpa(selectedRecipe);
                        }
                      }}
                      className="rounded-lg bg-purple-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-purple-500 shadow-md cursor-pointer disabled:opacity-50"
                    >
                      {runningId === selectedRecipe.id ? '▶️ 代办执行中...' : '🚀 立即执行代办'}
                    </button>
                  )}
                </div>
              </div>

              {/* 动态入参面板 (RPA 模式) */}
              {isRpaRecipe(selectedRecipe) && selectedRecipe.parameters && selectedRecipe.parameters.length > 0 && (
                <div className="rounded-xl border border-amber-800/60 bg-amber-950/20 p-4 space-y-3">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <span>⚙️</span>
                    <span>动态入参模板配置 ({selectedRecipe.parameters.length} 个变量)</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedRecipe.parameters.map((p) => (
                      <div key={p.key} className="rounded-lg bg-slate-950 p-2.5 border border-slate-800 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{p.label}</span>
                          <span className="font-mono text-amber-400 font-bold">{'{{'}{p.key}{'}}'}</span>
                        </div>
                        <div className="text-slate-400 text-[11px]">默认值: <code>{p.defaultValue || '空'}</code></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 验收标准与业务 Skill 校验面板 (RPA 与 QA 均支持绑定 Skill 校验业务结果) */}
              <div className="rounded-xl border border-indigo-800/60 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-indigo-300 flex items-center gap-2">
                    <span>🎯</span>
                    <span>
                      {isQaRecipe(selectedRecipe) ? '自动化验收标准与断言检查矩阵' : '业务结果成功校验 Skill (执行后自动检验)'}
                    </span>
                  </h3>
                  <select
                    onChange={async (e) => {
                      const skill = skillsList.find((s) => s.id === e.target.value);
                      if (!skill) return;
                      await saveWorkflowRecipe(selectedRecipe.name, selectedRecipe.steps, {
                        id: selectedRecipe.id,
                        mode: selectedRecipe.mode,
                        description: selectedRecipe.description,
                        startUrl: selectedRecipe.startUrl || skill.targetUrl,
                        urlPattern: selectedRecipe.urlPattern,
                        parameters: selectedRecipe.parameters,
                        assertions: skill.assertions,
                        acceptanceCriteria: skill.acceptanceCriteria,
                      });
                      await refreshData();
                      setStatusMsg({ type: 'success', text: `✨ 已为「${selectedRecipe.name}」绑定 Skill「${skill.name}」！` });
                    }}
                    defaultValue=""
                    className="rounded border border-indigo-700 bg-slate-900 px-2 py-1 text-xs text-indigo-300 outline-none cursor-pointer"
                  >
                    <option value="" disabled>📚 绑定业务 Skill 校验规则...</option>
                    {skillsList.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.assertions.length}条)</option>
                    ))}
                  </select>
                </div>

                  {selectedRecipe.acceptanceCriteria && (
                    <div className="text-xs text-slate-300 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                      <span className="font-semibold text-indigo-400">验收目标: </span>
                      <span>{selectedRecipe.acceptanceCriteria}</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    {selectedRecipe.assertions && selectedRecipe.assertions.length > 0 ? (
                      selectedRecipe.assertions.map((a, idx) => (
                        <div
                          key={a.id || idx}
                          className="flex items-center justify-between bg-slate-950 p-2 rounded-lg border border-slate-800 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-indigo-400 font-bold">{idx + 1}.</span>
                            <span className="rounded bg-indigo-950 border border-indigo-800 px-1.5 py-0.2 text-[10px] text-indigo-300 font-mono">
                              {a.type}
                            </span>
                            <span className="text-slate-200">{a.description}</span>
                          </div>
                          <span className="font-mono text-slate-400 text-[11px]">目标: <code>{a.target}</code></span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500 italic">未配置显式断言，运行时自动执行白屏崩溃与 DOM 健康度底线检查。</div>
                    )}
                  </div>
                </div>

              {/* 步骤编排与可视化时序链 */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>⏱️</span>
                    <span>步骤编排与操作时序流 ({selectedRecipe.steps.length} 步)</span>
                  </h3>
                </div>

                <div className="space-y-2">
                  {selectedRecipe.steps.map((step, idx) => (
                    <div
                      key={step.id || idx}
                      className="flex items-start gap-3 bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs hover:border-slate-700 transition-all"
                    >
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-900/60 border border-purple-700 font-bold text-purple-300 text-xs shrink-0">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{step.description}</span>
                          <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[10px] font-mono text-slate-400">
                            {step.type}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                          <div className="truncate">选择器: <code className="text-slate-300">{step.selector || '-'}</code></div>
                          {step.value && <div className="truncate">输入值: <code className="text-purple-300">{step.value}</code></div>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeNav === 'skills' && selectedSkill ? (
            /* Skill 详情面板 */
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold text-white tracking-tight">{selectedSkill.name}</h2>
                    <span className="rounded bg-blue-950 border border-blue-700 text-blue-300 px-2 py-0.5 text-xs font-semibold">
                      {selectedSkill.isPreset ? '内置预设' : '自定义'}
                    </span>
                  </div>
                  {selectedSkill.targetUrl && (
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0">目标网页:</span>
                      <b
                        title={selectedSkill.targetUrl}
                        className="text-blue-400 font-mono max-w-xs sm:max-w-sm md:max-w-md truncate inline-block cursor-help bg-slate-950 px-2 py-0.5 rounded border border-slate-800"
                      >
                        {selectedSkill.targetUrl}
                      </b>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!selectedSkill.isPreset && (
                    <button
                      onClick={() => void handleDeleteSkill(selectedSkill.id, selectedSkill.name)}
                      className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/50 cursor-pointer"
                    >
                      🗑️ 删除 Skill
                    </button>
                  )}
                  <button
                    onClick={() => void executeSkillRun(selectedSkill)}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-500 shadow-md cursor-pointer"
                  >
                    🧪 对目标页执行全量验收
                  </button>
                </div>
              </div>

              {selectedSkill.acceptanceCriteria && (
                <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 text-xs space-y-1">
                  <div className="font-bold text-blue-400">验收目标标准:</div>
                  <div className="text-slate-200">{selectedSkill.acceptanceCriteria}</div>
                </div>
              )}

              <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                <div className="font-bold text-white text-xs">断言检查项清单 ({selectedSkill.assertions.length} 条):</div>
                <div className="space-y-2">
                  {selectedSkill.assertions.map((a, idx) => (
                    <div key={a.id || idx} className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-blue-400">{idx + 1}.</span>
                        <span className="rounded bg-blue-950 border border-blue-800 px-1.5 py-0.2 text-[10px] text-blue-300 font-mono">{a.type}</span>
                        <span className="text-slate-200">{a.description}</span>
                      </div>
                      <span className="font-mono text-slate-400 text-[11px]">目标: <code>{a.target}</code></span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : activeNav === 'reports' ? (
            /* 测试套件大屏视图 */
            <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <h2 className="text-xl font-bold text-white">📊 自动化测试套件健康度诊断大屏</h2>
                {suiteReport && (
                  <button
                    onClick={() => {
                      const html = generateHtmlTestReport(suiteReport.recipeReports[0] || ({} as any));
                      downloadFile(html, `test-suite-report-${Date.now()}.html`);
                    }}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 cursor-pointer"
                  >
                    📥 导出套件 HTML 报告
                  </button>
                )}
              </div>

              {suiteReport ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div className="rounded-xl bg-slate-950 p-4 border border-slate-800">
                      <div className="text-xs text-slate-400">总用例数</div>
                      <div className="text-2xl font-bold text-white mt-1">{suiteReport.totalRecipes}</div>
                    </div>
                    <div className="rounded-xl bg-emerald-950/40 p-4 border border-emerald-800">
                      <div className="text-xs text-emerald-400">通过用例</div>
                      <div className="text-2xl font-bold text-emerald-400 mt-1">{suiteReport.passedRecipes}</div>
                    </div>
                    <div className="rounded-xl bg-rose-950/40 p-4 border border-rose-800">
                      <div className="text-xs text-rose-400">失败用例</div>
                      <div className="text-2xl font-bold text-rose-400 mt-1">{suiteReport.failedRecipes}</div>
                    </div>
                    <div className="rounded-xl bg-purple-950/40 p-4 border border-purple-800">
                      <div className="text-xs text-purple-300">通过率</div>
                      <div className="text-2xl font-bold text-purple-300 mt-1">
                        {suiteReport.totalRecipes > 0 ? Math.round((suiteReport.passedRecipes / suiteReport.totalRecipes) * 100) : 100}%
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="font-bold text-sm text-slate-200">📋 用例执行明细:</h3>
                    {suiteReport.recipeReports.map((r, i) => (
                      <div key={r.id || i} className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 flex items-center justify-between text-xs">
                        <div>
                          <div className="font-bold text-white">{i + 1}. {r.recipeName}</div>
                          <div className="text-slate-400 mt-1">步骤: {r.passedSteps}/{r.totalSteps} · 断言: {r.passedAssertions}/{r.totalAssertions}</div>
                        </div>
                        <span className={`font-bold px-3 py-1 rounded-md ${r.status === 'PASS' ? 'bg-emerald-950 border border-emerald-700 text-emerald-300' : 'bg-rose-950 border border-rose-700 text-rose-300'}`}>
                          {r.status === 'PASS' ? '🟢 PASS' : '🔴 FAIL'} ({(r.durationMs / 1000).toFixed(2)}s)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 p-12 text-center text-slate-500 text-sm">
                  点击顶部「⚡ 运行全量测试套件」即可在此生成测试套件大屏。
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500 text-sm">
              请从左侧选择一个配方或技能以查看详情
            </div>
          )}
        </div>
      </div>

      {/* 参数化执行弹窗 */}
      {paramModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 border border-slate-700 text-slate-100 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">🤖 填入动态入参</h3>
              <button onClick={() => setParamModal(null)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            <div className="space-y-3">
              {paramModal.recipe.parameters?.map((p) => (
                <div key={p.key} className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>{p.label}</span>
                    <span className="font-mono text-purple-400">{'{{'}{p.key}{'}}'}</span>
                  </label>
                  <input
                    type="text"
                    value={paramModal.values[p.key] || ''}
                    onChange={(e) => {
                      setParamModal({
                        ...paramModal,
                        values: { ...paramModal.values, [p.key]: e.target.value },
                      });
                    }}
                    placeholder={`默认: ${p.defaultValue || '空'}`}
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-white outline-none focus:border-purple-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button onClick={() => setParamModal(null)} className="rounded-lg px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer">取消</button>
              <button
                onClick={() => {
                  const targetRecipe = paramModal.recipe;
                  const vals = paramModal.values;
                  setParamModal(null);
                  void executeRpa(targetRecipe, vals);
                }}
                className="rounded-lg bg-purple-600 px-5 py-2 text-xs font-bold text-white hover:bg-purple-500 cursor-pointer"
              >
                🚀 带参执行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入 Skill 弹窗 */}
      {showImportSkillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 border border-slate-700 text-slate-100 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-white">📥 导入 / 粘贴 Skill 验收标准</h3>
              <button onClick={() => setShowImportSkillModal(false)} className="text-slate-400 hover:text-white cursor-pointer">✕</button>
            </div>
            <textarea
              rows={6}
              value={importInput}
              onChange={(e) => setImportInput(e.target.value)}
              placeholder={`# 示例验收 Skill\n- [目标页面] https://job.haiercash.com\n- [验收标准] 成功加载校招职位\n- [文本包含] 校招职位\n- [URL包含] haiercash`}
              className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 font-mono text-xs text-white outline-none focus:border-blue-500"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button onClick={() => setShowImportSkillModal(false)} className="rounded-lg px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer">取消</button>
              <button
                disabled={!importInput.trim()}
                onClick={() => void handleImportSkill(importInput)}
                className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-40 cursor-pointer"
              >
                解析并存入库
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<WorkbenchApp />);
