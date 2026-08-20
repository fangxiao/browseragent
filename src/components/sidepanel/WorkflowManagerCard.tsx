// 侧边栏极简伴随式流程与测试遥控器 (Companion Remote Bar for Sidepanel)
import React, { useEffect, useState } from 'react';
import type {
  WorkflowRecipe,
  WorkflowStep,
  WorkflowMode,
  RecipeParameter,
  TestAssertion,
  TestRunReport,
  AssertionResult,
  TestSkillTemplate,
} from '@/utils/workflow/types';
import {
  listWorkflowRecipes,
  saveWorkflowRecipe,
  deleteWorkflowRecipe,
  getActiveRecordingSession,
  stopActiveRecordingSession,
  listTestSkills,
  saveTestSkill,
} from '@/utils/workflow/storage';
import { buildWorkflowSteps } from '@/utils/workflow/recorder';
import { sendWorkflowMessageToTab } from '@/utils/workflow/client';

export function isQaRecipe(r: WorkflowRecipe): boolean {
  if (r.mode === 'qa') return true;
  if (r.mode === 'rpa') return false;
  return Boolean(
    (r.assertions && r.assertions.length > 0) ||
      r.acceptanceCriteria ||
      /测试|test|smoke/i.test(r.name),
  );
}

export function isRpaRecipe(r: WorkflowRecipe): boolean {
  return !isQaRecipe(r);
}

/** 打开独立全屏工作台 */
export function openWorkbench(tab?: 'rpa' | 'qa' | 'skills' | 'reports') {
  if (typeof browser !== 'undefined' && browser.tabs?.create && browser.runtime?.getURL) {
    const url = browser.runtime.getURL(`/workbench.html${tab ? `?tab=${tab}` : ''}`);
    void browser.tabs.create({ url });
  }
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
  await new Promise((r) => setTimeout(r, 350));
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

/** 从录制步骤中智能提炼业务 Skill 规则 */
function distillSkillFromSteps(steps: WorkflowStep[], startUrl: string): {
  defaultName: string;
  acceptanceCriteria: string;
  assertions: TestAssertion[];
} {
  let defaultName = '智能业务自动化 Skill';
  if (/italent|beisen|北森/i.test(startUrl)) {
    defaultName = '北森待办智能审批与流转 Skill';
  } else if (/baidu|百度/i.test(startUrl)) {
    defaultName = '百度搜索与官方结果跳转 Skill';
  } else if (/oa|审批|workflow/i.test(startUrl)) {
    defaultName = 'OA 协同流程自动化 Skill';
  }

  const assertions: TestAssertion[] = [];
  const textKeywords = steps
    .map((s) => s.targetText?.trim())
    .filter((t): t is string => Boolean(t && t.length >= 2 && !/^(svg|button|div|span|input|click)$/i.test(t)));

  const uniqueKeywords = Array.from(new Set(textKeywords));
  uniqueKeywords.slice(0, 4).forEach((kw, idx) => {
    assertions.push({
      id: `as_distill_${Date.now()}_${idx}`,
      type: 'text_contains',
      target: kw,
      description: `页面成功渲染并包含「${kw}」`,
    });
  });

  if (startUrl && /^https?:/i.test(startUrl)) {
    try {
      const u = new URL(startUrl);
      assertions.push({
        id: `as_distill_url_${Date.now()}`,
        type: 'url_contains',
        target: u.hostname,
        description: `页面 URL 处于 ${u.hostname} 域内`,
      });
    } catch {
      /* ignore */
    }
  }

  const criteria = steps.length > 0
    ? `完成 ${steps.map((s) => s.description).join(' -> ')}，并确保关键节点正确响应`
    : '成功完成业务流程操作并校验页面正常响应';

  return { defaultName, acceptanceCriteria: criteria, assertions };
}

export function WorkflowManagerCard() {
  const [recipes, setRecipes] = useState<WorkflowRecipe[]>([]);
  const [skillsList, setSkillsList] = useState<TestSkillTemplate[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSteps, setRecordedSteps] = useState<WorkflowStep[]>([]);
  const [recordedStartUrl, setRecordedStartUrl] = useState('');
  const [newRecipeName, setNewRecipeName] = useState('');
  const [saveMode, setSaveMode] = useState<'rpa' | 'qa' | 'skill'>('skill');

  // 新生成 Skill 反显卡片
  const [lastCreatedSkill, setLastCreatedSkill] = useState<TestSkillTemplate | null>(null);

  // 运行状态
  const [runningId, setRunningId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // 弹窗状态
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [paramRunModal, setParamRunModal] = useState<{
    recipe: WorkflowRecipe;
    values: Record<string, string>;
  } | null>(null);

  const refreshAllData = async () => {
    try {
      const list = await listWorkflowRecipes();
      setRecipes(list);
      const skills = await listTestSkills();
      setSkillsList(skills);
      const activeSession = await getActiveRecordingSession();
      if (activeSession && activeSession.isRecording) {
        setIsRecording(true);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshAllData();
  }, []);

  /** 开启录制 */
  const handleStartRecord = async () => {
    setStatusMsg({ type: 'info', text: '🔴 正在连接目标网页并启动录制器...' });
    try {
      if (typeof browser !== 'undefined' && browser.tabs?.query) {
        const allTabs = await browser.tabs.query({ currentWindow: true });
        let activeTab = allTabs.find((t) => t.active);

        const isRestricted = (url?: string) =>
          !url ||
          /^(chrome|edge|about|chrome-extension):/i.test(url) ||
          /chromewebstore|addons\.mozilla/i.test(url);

        // 如果当前停留在浏览器系统内部页 (如 chrome://extensions)
        if (!activeTab || isRestricted(activeTab.url)) {
          // 查找窗口中是否已有打开的普通业务网页并自动切过去
          const validWebTab = allTabs.find((t) => !isRestricted(t.url));
          if (validWebTab && validWebTab.id) {
            await browser.tabs.update(validWebTab.id, { active: true });
            activeTab = validWebTab;
            await waitForTabReady(validWebTab.id);
          } else {
            setStatusMsg({
              type: 'error',
              text: '⚠️ 当前停留在浏览器内部系统页（扩展管理/空白页），请先打开或切换到目标业务网站（如北森、OA、百度等）后再点击录制',
            });
            return;
          }
        }

        if (activeTab?.id) {
          const res = await sendWorkflowMessageToTab(activeTab.id, { type: 'WORKFLOW:START_RECORDING' });
          setIsRecording(true);
          setStatusMsg({
            type: 'info',
            text: res?.message || '🔴 录制已启动！请直接在网页上操作，完成后点击「⏹️ 完成录制」',
          });
          return;
        }
      }
      setStatusMsg({ type: 'error', text: '未找到可用的活动标签页' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `启动录制提示: ${(err as Error).message}` });
    }
  };

  /** 停止录制 */
  const handleStopRecord = async () => {
    try {
      let res: { ok: boolean; steps: WorkflowStep[]; actionCount: number; startUrl?: string } | null = null;
      if (typeof browser !== 'undefined' && browser.tabs?.query) {
        const [activeTabTab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (activeTabTab?.id) {
          try {
            res = (await sendWorkflowMessageToTab(activeTabTab.id, {
              type: 'WORKFLOW:STOP_RECORDING',
            })) as { ok: boolean; steps: WorkflowStep[]; actionCount: number; startUrl?: string };
          } catch {
            /* ignore */
          }
        }
      }

      if (!res || !res.steps || res.steps.length === 0) {
        const { actions: rawActions, startUrl } = await stopActiveRecordingSession();
        if (rawActions.length > 0) {
          const steps = buildWorkflowSteps(rawActions);
          res = { ok: true, steps, actionCount: rawActions.length, startUrl };
        }
      }

      setIsRecording(false);
      if (res && res.steps && res.steps.length > 0) {
        const startUrl = res.startUrl || res.steps[0]?.url || '';
        const distilled = distillSkillFromSteps(res.steps, startUrl);
        setRecordedSteps(res.steps);
        setRecordedStartUrl(startUrl);
        setNewRecipeName(distilled.defaultName);
        setSaveMode('skill'); // 默认推荐提炼为 Skill
        setShowSaveModal(true);
        setStatusMsg({ type: 'success', text: `✅ 录制完成！捕获 ${res.steps.length} 步操作，可直接提炼为 AI Skill` });
      } else {
        setStatusMsg({ type: 'info', text: '录制已结束，未捕获到操作步骤' });
      }
    } catch (err) {
      setIsRecording(false);
      setStatusMsg({ type: 'error', text: `停止录制失败: ${(err as Error).message}` });
    }
  };

  /** 保存录制为配方并自动串联绑定 Skill */
  const handleSave = async (openWorkbenchAfter = false) => {
    if (!newRecipeName.trim() || recordedSteps.length === 0) return;
    try {
      const name = newRecipeName.trim();
      const distilled = distillSkillFromSteps(recordedSteps, recordedStartUrl);

      // 1. 生成并存入 Skill 库 (提炼出的业务规则与断言)
      const savedSkill = await saveTestSkill(
        `${name} 验收规则`,
        distilled.acceptanceCriteria,
        distilled.assertions,
        `由 ${recordedSteps.length} 步操作示范提炼的业务 Skill`,
        recordedStartUrl,
      );

      // 2. 同时生成 RPA/QA 流程，并【自动串联绑定】该 Skill 规则与验收标准
      const savedRecipe = await saveWorkflowRecipe(name, recordedSteps, {
        mode: saveMode === 'qa' ? 'qa' : 'rpa',
        startUrl: recordedStartUrl || recordedSteps[0]?.url,
        assertions: savedSkill.assertions,
        acceptanceCriteria: savedSkill.acceptanceCriteria,
        description: `包含 ${recordedSteps.length} 步操作，已自动串联「${savedSkill.name}」`,
      });

      await refreshAllData();
      setLastCreatedSkill(savedSkill);
      setShowSaveModal(false);
      setRecordedSteps([]);
      setNewRecipeName('');
      setStatusMsg({
        type: 'success',
        text: `✨ 已保存「${savedRecipe.name}」并自动串联「${savedSkill.name}」！`,
      });
      if (openWorkbenchAfter) {
        openWorkbench(saveMode === 'qa' ? 'qa' : 'rpa');
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `保存失败: ${(err as Error).message}` });
    }
  };

  /** 执行 Skill 一键验收验证 */
  const executeSkillRun = async (skill: TestSkillTemplate) => {
    setRunningId(skill.id);
    setStatusMsg({ type: 'info', text: `🧪 正在对目标网页验证 Skill「${skill.name}」...` });
    try {
      if (typeof browser === 'undefined' || !browser.tabs?.query) return;
      const allTabs = await browser.tabs.query({ currentWindow: true });
      const webTabs = allTabs.filter((t) => t.id && t.url && !/^(chrome|edge|about|chrome-extension):/i.test(t.url));

      let targetTabId = webTabs[0]?.id;
      if (skill.targetUrl) {
        const originPrefix = skill.targetUrl.split('?')[0] || '';
        const existing = webTabs.find((t) => t.url && originPrefix && t.url.startsWith(originPrefix));
        if (existing && existing.id) {
          targetTabId = existing.id;
          await browser.tabs.update(existing.id, { active: true });
        } else {
          const newTab = await browser.tabs.create({ url: skill.targetUrl, active: true });
          targetTabId = newTab.id;
          await waitForTabReady(newTab.id!, 8000);
        }
      }

      if (!targetTabId) {
        setStatusMsg({ type: 'error', text: '未找到可执行的目标网页' });
        return;
      }

      const assertRes = await sendWorkflowMessageToTab(targetTabId, {
        type: 'TOOL:CALL',
        call: {
          id: `skill_run_${Date.now()}`,
          name: 'assertPage',
          args: { assertions: skill.assertions || [], acceptanceCriteria: skill.acceptanceCriteria || '' },
        },
      });

      const assertData = assertRes?.result?.data || {};
      const assertionsResults: AssertionResult[] = assertData.assertionsResults || [];
      const totalAssertions = skill.assertions?.length || assertionsResults.length;
      const passedAssertions = assertData.passedAssertions ?? assertionsResults.filter((a: any) => a.ok).length;
      const isPass = (totalAssertions === 0 || passedAssertions === totalAssertions) && !assertData.systemHealth?.isWhiteScreen;

      setStatusMsg({
        type: isPass ? 'success' : 'error',
        text: `🧪 Skill「${skill.name}」验收: ${isPass ? '🟢 全部通过 (PASS)' : '🔴 检查未通过 (FAIL)'}`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: `验收异常: ${(err as Error).message}` });
    } finally {
      setRunningId(null);
    }
  };

  /** 执行 RPA 流程 */
  const executeRpaWorkflow = async (recipe: WorkflowRecipe, variables: Record<string, string> = {}) => {
    setRunningId(recipe.id);
    setStatusMsg({ type: 'info', text: `▶️ 正在执行「${recipe.name}」...` });
    try {
      if (typeof browser === 'undefined' || !browser.tabs?.query) return;
      const [activeTabTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTabTab?.id) {
        setStatusMsg({ type: 'error', text: '未找到当前活动标签页' });
        return;
      }

      let stepIndex = 0;
      let lastTabId = activeTabTab.id;
      let hasStepError = false;

      for (const rawStep of recipe.steps) {
        stepIndex++;
        const step = interpolateStep(rawStep, variables);
        setStatusMsg({
          type: 'info',
          text: `▶️ [${stepIndex}/${recipe.steps.length}] ${step.description}...`,
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
              call: { id: `run_${Date.now()}`, name: 'clickElement', args: { selector: step.selector, targetText: step.targetText } },
            });
          } else if (step.type === 'type') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `run_${Date.now()}`, name: 'typeInto', args: { selector: step.selector, targetText: step.targetText, text: step.value || '', humanLike: true } },
            });
          } else if (step.type === 'pressEnter') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `run_${Date.now()}`, name: 'pressEnter', args: { selector: step.selector, targetText: step.targetText } },
            });
          } else if (step.type === 'hover') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `run_${Date.now()}`, name: 'hoverElement', args: { selector: step.selector, targetText: step.targetText } },
            });
          }
        } catch (stepErr) {
          const isNavClose = /closed before a response was received|message channel closed/i.test((stepErr as Error).message || '');
          if (isNavClose && (step.type === 'click' || step.type === 'pressEnter')) {
            res = { result: { ok: true, note: '触发了页面跳转' } };
          } else {
            res = { result: { ok: false, error: (stepErr as Error).message } };
          }
        }

        if (res && res.result && !res.result.ok) {
          hasStepError = true;
          setStatusMsg({ type: 'error', text: `⚠️ 步骤 ${stepIndex} 未执行成功: ${res.result.error || '未找到目标元素'}` });
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      if (!hasStepError) {
        setStatusMsg({ type: 'success', text: `🎉 「${recipe.name}」已执行完毕！` });
      }
    } catch (err) {
      setStatusMsg({ type: 'error', text: `执行异常: ${(err as Error).message}` });
    } finally {
      setRunningId(null);
    }
  };

  /** 执行 QA 测试 */
  const executeQaTest = async (recipe: WorkflowRecipe) => {
    setRunningId(recipe.id);
    setStatusMsg({ type: 'info', text: `🧪 正在执行自动化测试「${recipe.name}」...` });
    try {
      if (typeof browser === 'undefined' || !browser.tabs?.query) return;
      const [activeTabTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!activeTabTab?.id) return;

      let stepIndex = 0;
      let lastTabId = activeTabTab.id;
      let passedSteps = 0;

      for (const step of recipe.steps) {
        stepIndex++;
        let currentTabId = lastTabId;
        try {
          const [currentActive] = await browser.tabs.query({ active: true, currentWindow: true });
          if (currentActive?.id) {
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
              call: { id: `test_${Date.now()}`, name: 'clickElement', args: { selector: step.selector, targetText: step.targetText } },
            });
          } else if (step.type === 'type') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `test_${Date.now()}`,
                name: 'typeInto',
                args: { selector: step.selector, targetText: step.targetText, text: step.value || '', humanLike: true },
              },
            });
          } else if (step.type === 'pressEnter') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `test_${Date.now()}`, name: 'pressEnter', args: { selector: step.selector, targetText: step.targetText } },
            });
          }
        } catch (stepErr) {
          const isNavClose = /closed before a response was received|message channel closed/i.test((stepErr as Error).message || '');
          if (isNavClose && (step.type === 'click' || step.type === 'pressEnter')) {
            res = { result: { ok: true, note: '操作触发了页面跳转' } };
          } else {
            res = { result: { ok: false, error: (stepErr as Error).message } };
          }
        }

        if (res?.result?.ok) passedSteps++;
        await new Promise((r) => setTimeout(r, 400));
      }

      // 断言
      const assertRes = await sendWorkflowMessageToTab(lastTabId, {
        type: 'TOOL:CALL',
        call: {
          id: `assert_${Date.now()}`,
          name: 'assertPage',
          args: { assertions: recipe.assertions || [], acceptanceCriteria: recipe.acceptanceCriteria || '' },
        },
      });

      const assertData = assertRes?.result?.data || {};
      const assertionsResults: AssertionResult[] = assertData.assertionsResults || [];
      const totalAssertions = recipe.assertions?.length || assertionsResults.length;
      const passedAssertions = assertData.passedAssertions ?? assertionsResults.filter((a: any) => a.ok).length;
      const isPass = passedSteps === recipe.steps.length && (totalAssertions === 0 || passedAssertions === totalAssertions);

      setStatusMsg({
        type: isPass ? 'success' : 'error',
        text: `🧪 「${recipe.name}」测试完成: ${isPass ? '🟢 PASS 全部通过' : '🔴 FAIL 测试未通过'}`,
      });
      await refreshAllData();
    } catch (err) {
      setStatusMsg({ type: 'error', text: `测试异常: ${(err as Error).message}` });
    } finally {
      setRunningId(null);
    }
  };

  // 取最近 3 个常用流程
  const recentRecipes = recipes.slice(0, 3);
  const distilledPreview = distillSkillFromSteps(recordedSteps, recordedStartUrl);

  return (
    <div className="rounded-xl border border-purple-200 bg-white p-3 shadow-xs text-xs text-gray-800 space-y-2.5">
      {/* 头部精简标题与录制触发 */}
      <div className="flex items-center justify-between pb-1.5 border-b border-gray-100">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⚡</span>
          <span className="font-semibold text-gray-900 text-xs">快捷自动化遥控器</span>
        </div>
        <div className="flex items-center gap-1.5">
          {!isRecording ? (
            <button
              onClick={() => void handleStartRecord()}
              className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 text-[10.5px] font-medium text-white hover:bg-purple-700 active:scale-[0.98] transition-all cursor-pointer shadow-2xs"
              title="开始录制您在网页上的真实操作"
            >
              <span>🔴</span>
              <span>录制新流程</span>
            </button>
          ) : (
            <button
              onClick={() => void handleStopRecord()}
              className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-3 py-1 text-[10.5px] font-bold text-white hover:bg-rose-700 animate-pulse transition-all cursor-pointer shadow-xs"
              title="完成录制并提炼为 Skill 或配方"
            >
              <span>⏹️</span>
              <span>完成录制</span>
            </button>
          )}
        </div>
      </div>

      {/* 状态提示条 */}
      {statusMsg && (
        <div
          className={`rounded p-1.5 text-[11px] flex items-center justify-between ${
            statusMsg.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : statusMsg.type === 'info'
                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button onClick={() => setStatusMsg(null)} className="text-gray-400 hover:text-gray-600 ml-2">✕</button>
        </div>
      )}

      {/* ✨ 新生成 Skill 反显卡片 */}
      {lastCreatedSkill && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-2.5 space-y-1.5 animate-in fade-in shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-xs">✨</span>
              <span className="font-bold text-blue-950 text-[11px]">已成功提炼生成 AI 智能 Skill</span>
            </div>
            <button onClick={() => setLastCreatedSkill(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
          </div>
          <div className="text-xs font-semibold text-gray-900">{lastCreatedSkill.name}</div>
          <div className="text-[10.5px] text-gray-600 leading-tight">🎯 {lastCreatedSkill.acceptanceCriteria}</div>
          {lastCreatedSkill.targetUrl && (
            <div className="text-[10px] text-blue-700 font-mono truncate">🌐 {lastCreatedSkill.targetUrl}</div>
          )}
          <div className="flex items-center justify-between pt-1 border-t border-blue-200/60">
            <span className="text-[9.5px] text-blue-600 font-medium">包含 {lastCreatedSkill.assertions.length} 条智能断言</span>
            <button
              disabled={runningId === lastCreatedSkill.id}
              onClick={() => void executeSkillRun(lastCreatedSkill)}
              className="rounded bg-blue-600 px-2.5 py-0.5 text-[10px] font-bold text-white hover:bg-blue-700 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {runningId === lastCreatedSkill.id ? '验证中...' : '🧪 立即验证此 Skill'}
            </button>
          </div>
        </div>
      )}

      {/* 录制完成保存弹窗 (支持提炼为 AI Skill、RPA 或 QA) */}
      {showSaveModal && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/70 p-3 space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between text-purple-950 font-bold text-[11.5px]">
            <span>录制完成 ({recordedSteps.length} 个步骤):</span>
            <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>

          {/* 模式切换 (默认推荐提炼为 AI 智能 Skill) */}
          <div className="grid grid-cols-3 gap-1">
            <button
              onClick={() => setSaveMode('skill')}
              className={`py-1 rounded border text-[10px] font-bold transition-all ${
                saveMode === 'skill'
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              🧠 提炼 AI Skill
            </button>
            <button
              onClick={() => setSaveMode('rpa')}
              className={`py-1 rounded border text-[10px] font-medium transition-all ${
                saveMode === 'rpa'
                  ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              🤖 RPA 代办
            </button>
            <button
              onClick={() => setSaveMode('qa')}
              className={`py-1 rounded border text-[10px] font-medium transition-all ${
                saveMode === 'qa'
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              🧪 QA 测试
            </button>
          </div>

          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 font-medium">
              {saveMode === 'skill' ? 'Skill 规则名称:' : '流程配方名称:'}
            </div>
            <input
              type="text"
              value={newRecipeName}
              onChange={(e) => setNewRecipeName(e.target.value)}
              placeholder="输入名称"
              className="w-full rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] outline-none focus:border-blue-500"
              autoFocus
            />
          </div>

          {/* Skill 提炼智能反显预览 */}
          {saveMode === 'skill' && (
            <div className="rounded border border-blue-200 bg-white/80 p-2 space-y-1 text-[10.5px]">
              <div className="font-semibold text-blue-900 flex items-center justify-between">
                <span>🎯 智能提炼预览:</span>
                <span className="text-[9.5px] text-blue-600">{distilledPreview.assertions.length} 条断言</span>
              </div>
              <div className="text-gray-600 text-[10px] line-clamp-2">
                <b>验收标准: </b>{distilledPreview.acceptanceCriteria}
              </div>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {distilledPreview.assertions.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 text-[9.5px] text-gray-700 bg-gray-50 p-1 rounded">
                    <span className="text-blue-500 font-mono">✓</span>
                    <span className="truncate">{a.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-1 border-t border-purple-200/50">
            <button
              onClick={() => void handleSave(true)}
              className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium hover:underline cursor-pointer"
            >
              在全屏工作台中查看 ↗
            </button>
            <div className="flex gap-1.5">
              <button
                onClick={() => setShowSaveModal(false)}
                className="rounded px-2.5 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 cursor-pointer"
              >
                取消
              </button>
              <button
                disabled={!newRecipeName.trim()}
                onClick={() => void handleSave(false)}
                className={`rounded px-3.5 py-0.5 text-[10.5px] font-bold text-white shadow-xs cursor-pointer disabled:opacity-40 ${
                  saveMode === 'skill' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'
                }`}
              >
                {saveMode === 'skill' ? '✨ 确认生成 Skill' : '快捷保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 参数输入弹窗 */}
      {paramRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-xs rounded-xl bg-white p-3.5 shadow-2xl border border-gray-100 text-xs text-gray-800 space-y-2.5">
            <div className="flex items-center justify-between pb-1 border-b border-gray-100">
              <span className="font-bold text-gray-900 text-[11px]">填入代办参数:</span>
              <button onClick={() => setParamRunModal(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {paramRunModal.recipe.parameters?.map((p) => (
                <div key={p.key} className="space-y-0.5">
                  <div className="text-[10px] font-medium text-gray-600">{p.label}</div>
                  <input
                    type="text"
                    value={paramRunModal.values[p.key] || ''}
                    onChange={(e) => {
                      setParamRunModal({
                        ...paramRunModal,
                        values: { ...paramRunModal.values, [p.key]: e.target.value },
                      });
                    }}
                    placeholder={`默认: ${p.defaultValue || '空'}`}
                    className="w-full rounded border border-gray-200 px-2 py-0.5 text-[10.5px] outline-none focus:border-purple-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-1.5 pt-1">
              <button onClick={() => setParamRunModal(null)} className="rounded px-2 py-0.5 text-[10px] text-gray-500">取消</button>
              <button
                onClick={() => {
                  const targetRecipe = paramRunModal.recipe;
                  const vals = paramRunModal.values;
                  setParamRunModal(null);
                  void executeRpaWorkflow(targetRecipe, vals);
                }}
                className="rounded bg-purple-600 px-3 py-0.5 text-[10.5px] font-medium text-white hover:bg-purple-700"
              >
                🚀 执行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 常用快捷列表 */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10.5px] text-gray-400 font-medium">
          <span>常用流程 ({recipes.length}):</span>
          <span className="text-[10px] text-gray-400">已存 {skillsList.length} 个 Skill</span>
        </div>

        {recentRecipes.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 bg-gray-50/50 p-2 text-center text-[10.5px] text-gray-400">
            暂无已存流程，点击「🔴 录制新流程」即可捕获！
          </div>
        ) : (
          recentRecipes.map((r) => {
            const isQa = isQaRecipe(r);
            const isRunning = runningId === r.id;
            return (
              <div
                key={r.id}
                className="flex items-center justify-between bg-gray-50/80 hover:bg-purple-50/40 p-1.5 rounded-md border border-gray-200/80 text-[11px] transition-all"
              >
                <div className="flex items-center gap-1.5 min-w-0 pr-1">
                  <span className={`rounded px-1 py-0.2 text-[8.5px] font-bold shrink-0 ${
                    isQa ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {isQa ? 'QA' : 'RPA'}
                  </span>
                  <span className="font-medium text-gray-800 truncate">{r.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {isQa ? (
                    <button
                      disabled={isRunning}
                      onClick={() => void executeQaTest(r)}
                      className="rounded bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 text-[9.5px] font-medium disabled:opacity-50 cursor-pointer shadow-2xs"
                      title="运行自动化测试"
                    >
                      {isRunning ? '测试中' : '🧪 测试'}
                    </button>
                  ) : (
                    <button
                      disabled={isRunning}
                      onClick={() => {
                        if (r.parameters && r.parameters.length > 0) {
                          const initialVals: Record<string, string> = {};
                          r.parameters.forEach((p) => (initialVals[p.key] = p.defaultValue || ''));
                          setParamRunModal({ recipe: r, values: initialVals });
                        } else {
                          void executeRpaWorkflow(r);
                        }
                      }}
                      className="rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 text-[9.5px] font-medium disabled:opacity-50 cursor-pointer shadow-2xs"
                      title="执行业务代办"
                    >
                      {isRunning ? '执行中' : '▶️ 代办'}
                    </button>
                  )}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(`确定要删除「${r.name}」吗？`)) {
                        await deleteWorkflowRecipe(r.id);
                        await refreshAllData();
                      }
                    }}
                    className="text-gray-400 hover:text-rose-600 p-0.5 text-xs cursor-pointer ml-0.5"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部单一、清晰的全屏工作台入口 */}
      <button
        onClick={() => openWorkbench()}
        className="w-full flex items-center justify-between rounded-lg bg-gradient-to-r from-purple-50 to-indigo-50 p-2 border border-purple-200 text-left hover:border-purple-300 transition-all cursor-pointer group"
      >
        <div className="flex items-center gap-1.5 text-[10.5px]">
          <span>📊</span>
          <span className="font-semibold text-purple-950 group-hover:text-purple-700">进入全屏自动化工作台与 Skill 库</span>
        </div>
        <span className="text-purple-600 text-xs font-bold group-hover:translate-x-0.5 transition-transform">
          ↗
        </span>
      </button>
    </div>
  );
}
