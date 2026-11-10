// 侧边栏极简伴随式流程自动化 (Companion Flow Automation Bar for Sidepanel)
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
  startActiveRecordingSession,
  getActiveRecordingSession,
  stopActiveRecordingSession,
  listTestSkills,
  saveTestSkill,
  interpolateStepVariables,
  exportWorkflowRecipesJson,
  importWorkflowRecipesJson,
} from '@/utils/workflow/storage';
import { buildWorkflowSteps } from '@/utils/workflow/recorder';
import { sendWorkflowMessageToTab } from '@/utils/workflow/client';
import { distillHabitWithLLM, type DistilledHabit } from '@/utils/workflow/skillDistiller';

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


/** 从录制步骤中智能提炼业务 Skill 规则 */
function distillSkillFromSteps(steps: WorkflowStep[], startUrl: string): {
  defaultName: string;
  acceptanceCriteria: string;
  assertions: TestAssertion[];
} {
  const hasLoop = steps.some((s) => s.isLoop);
  let defaultName = hasLoop ? '智能批量遍历与流转 Skill' : '智能业务自动化 Skill';

  if (/italent|beisen|北森/i.test(startUrl)) {
    defaultName = hasLoop ? '北森已审批记录全量遍历 Skill' : '北森待办智能审批与流转 Skill';
  } else if (/baidu|百度/i.test(startUrl)) {
    defaultName = '百度搜索与官方结果跳转 Skill';
  } else if (/oa|审批|workflow/i.test(startUrl)) {
    defaultName = hasLoop ? 'OA 列表全量巡检与批量审批 Skill' : 'OA 协同流程自动化 Skill';
  }

  const assertions: TestAssertion[] = [];

  if (hasLoop) {
    assertions.push({
      id: `as_distill_loop_${Date.now()}`,
      type: 'element_visible',
      target: 'table, .ant-table, .ant-list, ul.list',
      description: '成功定位并展示目标记录列表/表格',
    });
  }

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

  let criteria = '';
  if (hasLoop) {
    criteria = '进入目标页面 -> 切换至对应业务视图 -> 自动循环遍历当前列表/表格中的全部记录项并逐一查看';
  } else if (steps.length > 0) {
    criteria = `完成 ${steps.map((s) => s.description).join(' -> ')}，并确保关键节点正确响应`;
  } else {
    criteria = '成功完成业务流程操作并校验页面正常响应';
  }

  return { defaultName, acceptanceCriteria: criteria, assertions };
}

export function WorkflowManagerCard() {
  const [recipes, setRecipes] = useState<WorkflowRecipe[]>([]);
  const [skillsList, setSkillsList] = useState<TestSkillTemplate[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingCount, setRecordingCount] = useState(0);
  const [recordedSteps, setRecordedSteps] = useState<WorkflowStep[]>([]);
  const [rawRecordedSteps, setRawRecordedSteps] = useState<WorkflowStep[]>([]);
  const [recordedStartUrl, setRecordedStartUrl] = useState('');
  const [newRecipeName, setNewRecipeName] = useState('');
  const [customCriteria, setCustomCriteria] = useState('');
  const [saveMode, setSaveMode] = useState<'rpa' | 'qa' | 'skill'>('skill');

  // AI 习惯归纳状态
  const [distilledHabit, setDistilledHabit] = useState<DistilledHabit | null>(null);
  const [isBatchPattern, setIsBatchPattern] = useState(false);
  const [loopItemSelector, setLoopItemSelector] = useState('table tbody tr');
  const [subSteps, setSubSteps] = useState<WorkflowStep[]>([]);
  const [parameters, setParameters] = useState<RecipeParameter[]>([]);
  const [showSubStepsDetails, setShowSubStepsDetails] = useState(false);

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
        setRecordingCount(activeSession.actions?.length || 0);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshAllData();
  }, []);

  // 录制过程中实时轮询捕获动作计数 (与 content 脚本及 background 保持毫秒级同步)
  useEffect(() => {
    if (!isRecording) {
      setRecordingCount(0);
      return;
    }
    const pollCount = async () => {
      try {
        const session = await getActiveRecordingSession();
        if (session && session.isRecording) {
          setRecordingCount(session.actions?.length || 0);
        }
      } catch {
        /* ignore */
      }
    };
    void pollCount();
    const timer = setInterval(pollCount, 600);
    return () => clearInterval(timer);
  }, [isRecording]);

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
          // 1. 侧边栏直接预建立活跃持久化录制会话
          await startActiveRecordingSession(activeTab.id, activeTab.url);
          setRecordingCount(0);

          // 2. 向目标网页发送启动指令
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

  /** 停止录制并智能调用 AI 归纳习惯 */
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

      let rawActions: any[] = [];
      if (!res || !res.steps || res.steps.length === 0) {
        const sessionRes = await stopActiveRecordingSession();
        rawActions = sessionRes.actions;
        if (rawActions.length > 0) {
          const steps = buildWorkflowSteps(rawActions);
          res = { ok: true, steps, actionCount: rawActions.length, startUrl: sessionRes.startUrl };
        }
      }

      setIsRecording(false);
      if (res && res.steps && res.steps.length > 0) {
        const startUrl = res.startUrl || res.steps[0]?.url || '';
        setStatusMsg({ type: 'info', text: '🧠 AI 正在根据您的操作示范智能归纳自动化习惯...' });

        let habit: DistilledHabit;
        try {
          habit = await distillHabitWithLLM(rawActions, res.steps, startUrl);
        } catch {
          const fallback = distillSkillFromSteps(res.steps, startUrl);
          habit = {
            name: fallback.defaultName,
            description: fallback.acceptanceCriteria,
            isBatchPattern: res.steps.some((s) => s.isLoop),
            steps: res.steps,
            acceptanceCriteria: fallback.acceptanceCriteria,
            assertions: fallback.assertions,
          };
        }

        setDistilledHabit(habit);
        setIsBatchPattern(Boolean(habit.isBatchPattern));
        setLoopItemSelector(habit.loopTarget?.selector || 'table tbody tr');
        setSubSteps(habit.subSteps || []);
        setParameters(habit.parameters || []);
        setRecordedSteps(habit.steps);
        setRawRecordedSteps(res.steps);
        setRecordedStartUrl(startUrl);
        setNewRecipeName(habit.name);
        setCustomCriteria(habit.acceptanceCriteria || '');
        setSaveMode('skill'); // 默认推荐提炼为 Skill
        setShowSaveModal(true);
        setStatusMsg({
          type: 'success',
          text: `✅ 录制完成！AI 已归纳为「${habit.name}」(${habit.isBatchPattern ? '🔁 批量循环' : '⚡ 线性流程'})`,
        });
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
    if (!newRecipeName.trim()) return;
    try {
      const name = newRecipeName.trim();
      const habit = distilledHabit;

      // 1. 生成并存入 Skill 库 (提炼出的业务规则与断言)
      const assertionsToSave = habit?.assertions || [];
      const criteriaToSave = customCriteria.trim() || habit?.acceptanceCriteria || '自动执行业务操作并校验结果';
      const savedSkill = await saveTestSkill(
        `${name} 验收规则`,
        criteriaToSave,
        assertionsToSave,
        habit?.description || `由 ${recordedSteps.length} 步操作示范提炼的业务 Skill`,
        recordedStartUrl,
      );

      // 2. 构建步骤序列: 如果开启了批量循环模式，保留前置导航步骤并打包批量步骤
      let stepsToSave: WorkflowStep[] = recordedSteps;
      if (isBatchPattern) {
        const preSteps = recordedSteps.filter((s) => !s.isLoop);
        stepsToSave = [
          ...preSteps,
          {
            id: `step_loop_${preSteps.length + 1}`,
            type: 'loop',
            description: `🔁 自动批量循环遍历「${loopItemSelector.trim()}」并执行流转`,
            isLoop: true,
            loopItemSelector: loopItemSelector.trim() || 'table tbody tr',
            subSteps: subSteps.length > 0 ? subSteps : undefined,
            maxLoopCount: 50,
            onItemError: 'skip',
            loopSummary: habit?.description,
          },
        ];
      } else {
        stepsToSave = rawRecordedSteps.length > 0 ? rawRecordedSteps : recordedSteps;
      }

      // 3. 同时生成 RPA/QA 流程，并【自动串联绑定】该 Skill 规则与验收标准
      const savedRecipe = await saveWorkflowRecipe(name, stepsToSave, {
        mode: saveMode === 'qa' ? 'qa' : 'rpa',
        startUrl: recordedStartUrl || stepsToSave[0]?.url,
        parameters: parameters.length > 0 ? parameters : habit?.parameters,
        assertions: savedSkill.assertions,
        acceptanceCriteria: savedSkill.acceptanceCriteria,
        description: habit?.description || `包含 ${stepsToSave.length} 步操作，已自动串联「${savedSkill.name}」`,
      });

      await refreshAllData();
      setLastCreatedSkill(savedSkill);
      setShowSaveModal(false);
      setRecordedSteps([]);
      setNewRecipeName('');
      setDistilledHabit(null);
      setStatusMsg({
        type: 'success',
        text: `✨ 已保存「${savedRecipe.name}」并自动沉淀为 Skill！`,
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
        const step = interpolateStepVariables(rawStep, variables);
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
          if (step.isLoop) {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_loop_${Date.now()}`,
                name: 'loopElements',
                args: {
                  selector: step.selector,
                  itemSelector: step.loopItemSelector,
                  subSteps: step.subSteps,
                  maxItems: step.maxLoopCount || 50,
                  delayMs: step.waitMs || 400,
                  onItemError: step.onItemError || 'skip',
                },
              },
            });
          } else if (step.type === 'click') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `run_${Date.now()}`, name: 'clickElement', args: { selector: step.selector, targetText: step.targetText } },
            });
          } else if (step.type === 'type') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: {
                id: `run_${Date.now()}`,
                name: 'typeInto',
                args: { selector: step.selector, targetText: step.targetText, text: step.value || '', humanLike: true },
              },
            });
          } else if (step.type === 'pressEnter') {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `run_${Date.now()}`, name: 'pressEnter', args: { selector: step.selector, targetText: step.targetText } },
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

        if (res && res.result && !res.result.ok) {
          hasStepError = true;
          setStatusMsg({ type: 'error', text: `⚠️ 步骤 ${stepIndex} 未执行成功: ${res.result.error || '未找到目标元素'}` });
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      // 如果绑定了 Skill，执行业务结果校验
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
              ? `🎉 代办「${recipe.name}」已全部执行完毕并通过业务 Skill 校验！`
              : `⚠️ 代办动作已执行，但业务 Skill 校验未完全通过 (${passedAssertions}/${totalAssertions})`,
          });
          return;
        } catch {
          /* ignore */
        }
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
          if (step.isLoop) {
            res = await sendWorkflowMessageToTab(currentTabId, {
              type: 'TOOL:CALL',
              call: { id: `test_loop_${Date.now()}`, name: 'loopElements', args: { selector: step.selector, itemSelector: step.loopItemSelector } },
            });
          } else if (step.type === 'click') {
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
          <span className="font-semibold text-gray-900 text-xs">流程自动化</span>
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
              <span>完成录制{recordingCount > 0 ? ` (${recordingCount} 步)` : ''}</span>
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

      {/* 录制完成保存与习惯微调弹窗 */}
      {showSaveModal && (
        <div className="rounded-lg border border-purple-200 bg-purple-50/70 p-3 space-y-2.5 animate-in fade-in">
          <div className="flex items-center justify-between text-purple-950 font-bold text-[11.5px]">
            <div className="flex items-center gap-1.5">
              <span>🧠 AI 习惯归纳与微调</span>
              {isBatchPattern ? (
                <span className="rounded bg-blue-100 border border-blue-300 text-blue-800 px-1.5 py-0.2 text-[9.5px] font-bold">
                  🔁 批量循环遍历
                </span>
              ) : (
                <span className="rounded bg-gray-100 border border-gray-300 text-gray-700 px-1.5 py-0.2 text-[9.5px]">
                  ⚡ 线性单次执行
                </span>
              )}
            </div>
            <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>

          {/* AI 归纳意图说明提示 */}
          {distilledHabit && (
            <div className="rounded bg-white border border-purple-200/80 p-2 text-[10.5px] space-y-1">
              <div className="font-semibold text-purple-950 flex items-center gap-1">
                <span>💡</span>
                <span>{distilledHabit.description}</span>
              </div>
              {distilledHabit.reasoning && (
                <div className="text-[9.5px] text-gray-500 leading-tight">
                  {distilledHabit.reasoning}
                </div>
              )}
            </div>
          )}

          {/* 模式选择 */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                setIsBatchPattern(true);
                if (distilledHabit?.steps) setRecordedSteps(distilledHabit.steps);
              }}
              className={`py-1 px-2 rounded border text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${
                isBatchPattern
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>🔁 批量循环模式</span>
              <span className="text-[9px] opacity-80">
                ({recordedSteps.filter((s) => !s.isLoop).length > 0 ? `${recordedSteps.filter((s) => !s.isLoop).length}步导航 + ` : ''}批量审批)
              </span>
            </button>
            <button
              onClick={() => {
                setIsBatchPattern(false);
                if (rawRecordedSteps.length > 0) setRecordedSteps(rawRecordedSteps);
              }}
              className={`py-1 px-2 rounded border text-[10px] font-medium transition-all flex items-center justify-center gap-1 cursor-pointer ${
                !isBatchPattern
                  ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>⚡ 线性单次模式</span>
              <span className="text-[9px] opacity-80">(全部 {rawRecordedSteps.length || recordedSteps.length} 步单次重放)</span>
            </button>
          </div>

          {/* 前置页面导航步骤预览 (如果有) */}
          {isBatchPattern && recordedSteps.filter((s) => !s.isLoop).length > 0 && (
            <div className="rounded border border-indigo-100 bg-indigo-50/60 p-2 space-y-1 text-[10.5px]">
              <div className="font-semibold text-indigo-950 text-[10px] flex items-center justify-between">
                <span>🧭 前置导航与页面入口 ({recordedSteps.filter((s) => !s.isLoop).length} 步):</span>
                <span className="text-[9px] text-indigo-600 font-medium">执行时先进入审批页</span>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto pl-1">
                {recordedSteps
                  .filter((s) => !s.isLoop)
                  .map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[9.5px] text-gray-700 bg-white/90 p-1 rounded border border-indigo-100">
                      <span className="font-mono text-indigo-600 font-bold">{i + 1}.</span>
                      <span className="truncate">{s.description}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 批量循环参数微调 */}
          {isBatchPattern && (
            <div className="rounded border border-blue-200 bg-white/90 p-2 space-y-2 text-[10.5px]">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-gray-600 font-medium">
                  <span>循环列表项选择器 (Target Selector):</span>
                  <span className="text-[9px] text-blue-600">自适应匹配整表/整列表</span>
                </div>
                <input
                  type="text"
                  value={loopItemSelector}
                  onChange={(e) => setLoopItemSelector(e.target.value)}
                  placeholder="如 table tbody tr 或 .ant-table-row"
                  className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-[10.5px] font-mono text-gray-800 outline-none focus:border-blue-500"
                />
                {/* 候选快捷标签 */}
                <div className="flex items-center gap-1 flex-wrap pt-0.5">
                  <span className="text-[9px] text-gray-400">快速推荐:</span>
                  {['table tbody tr', '.ant-table-row', 'ul.list > li', '.el-table__row', '.item-row'].map((sel) => (
                    <button
                      key={sel}
                      onClick={() => setLoopItemSelector(sel)}
                      className="rounded bg-gray-100 hover:bg-blue-50 text-[9px] font-mono text-gray-600 hover:text-blue-700 px-1 py-0.2 border border-gray-200 cursor-pointer"
                    >
                      {sel}
                    </button>
                  ))}
                </div>
              </div>

              {/* 单项子步骤 (Sub-steps) 折叠/展开查看 */}
              {subSteps.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-gray-100">
                  <button
                    onClick={() => setShowSubStepsDetails(!showSubStepsDetails)}
                    className="flex items-center justify-between w-full text-[10px] text-blue-700 hover:text-blue-800 font-semibold cursor-pointer"
                  >
                    <span>每条记录执行的子动作 ({subSteps.length} 步):</span>
                    <span>{showSubStepsDetails ? '收起 ▲' : '展开微调 ▼'}</span>
                  </button>
                  {showSubStepsDetails && (
                    <div className="space-y-1 max-h-28 overflow-y-auto bg-slate-50 p-1.5 rounded border border-slate-200">
                      {subSteps.map((sub, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 text-[9.5px] text-gray-700 bg-white p-1 rounded border border-gray-100">
                          <span className="font-mono text-blue-600 font-bold shrink-0">{idx + 1}.</span>
                          <span className="font-medium truncate">{sub.description}</span>
                          {sub.value && (
                            <span className="text-[9px] text-purple-700 font-mono bg-purple-50 px-1 rounded truncate">
                              {sub.value}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 动态入参配置 */}
          {parameters.length > 0 && (
            <div className="rounded border border-purple-200 bg-white/90 p-2 space-y-1.5 text-[10.5px]">
              <div className="font-semibold text-purple-900 text-[10px]">
                📝 提取的动态入参 (执行时可按需修改):
              </div>
              <div className="space-y-1">
                {parameters.map((p, idx) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <span className="text-[10px] font-medium text-gray-600 shrink-0 w-16">{p.label}:</span>
                    <input
                      type="text"
                      value={p.defaultValue}
                      onChange={(e) => {
                        const updated = [...parameters];
                        updated[idx] = { ...p, defaultValue: e.target.value };
                        setParameters(updated);
                      }}
                      className="flex-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] outline-none focus:border-purple-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Skill 名称与 SOP 验收标准 */}
          <div className="space-y-1">
            <div className="text-[10px] text-gray-500 font-medium">Skill 名称:</div>
            <input
              type="text"
              value={newRecipeName}
              onChange={(e) => setNewRecipeName(e.target.value)}
              placeholder="如：全量待办记录自动批量审批 Skill"
              className="w-full rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] outline-none focus:border-blue-500 font-semibold"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-gray-500 font-medium">
              <span>🎯 操作 SOP 与验收规则:</span>
              <span className="text-[9.5px] text-blue-600">{distilledHabit?.assertions?.length || 0} 条断言</span>
            </div>
            <textarea
              rows={2}
              value={customCriteria}
              onChange={(e) => setCustomCriteria(e.target.value)}
              placeholder="描述执行目标与验收标准..."
              className="w-full rounded border border-gray-300 bg-white p-1.5 text-[10px] text-gray-800 outline-none focus:border-blue-500"
            />
          </div>

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
                className="rounded bg-blue-600 hover:bg-blue-700 px-3.5 py-1 text-[10.5px] font-bold text-white shadow-xs cursor-pointer disabled:opacity-40"
              >
                ✨ 确认并沉淀为 Skill
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
