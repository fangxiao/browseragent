// 工作流配方 (Workflow Recipes) 存储与管理
import type { WorkflowRecipe, WorkflowStep } from './types';

const WORKFLOWS_STORAGE_KEY = 'workflows_recipe_store';

/** 获取所有已保存的工作流配方 */
export async function listWorkflowRecipes(): Promise<WorkflowRecipe[]> {
  try {
    if (typeof browser === 'undefined' || !browser.storage?.local) return [];
    const res = (await browser.storage.local.get(WORKFLOWS_STORAGE_KEY)) as {
      [WORKFLOWS_STORAGE_KEY]?: Record<string, WorkflowRecipe>;
    };
    const store = res[WORKFLOWS_STORAGE_KEY] || {};
    return Object.values(store).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** 保存或更新工作流配方 */
export async function saveWorkflowRecipe(
  name: string,
  steps: WorkflowStep[],
  options?: {
    id?: string;
    description?: string;
    mode?: import('./types').WorkflowMode;
    startUrl?: string;
    urlPattern?: string;
    parameters?: import('./types').RecipeParameter[];
    assertions?: import('./types').TestAssertion[];
    acceptanceCriteria?: string;
    lastTestReport?: import('./types').TestRunReport;
  },
): Promise<WorkflowRecipe> {
  const recipes = await listWorkflowRecipes();
  const storeMap: Record<string, WorkflowRecipe> = {};
  recipes.forEach((r) => (storeMap[r.id] = r));

  const now = Date.now();
  const recipeId = options?.id || `wf_${now}_${Math.random().toString(36).slice(2, 7)}`;
  const startUrl = options?.startUrl || steps[0]?.url || options?.urlPattern;
  const existing = storeMap[recipeId];
  const recipe: WorkflowRecipe = {
    id: recipeId,
    name: name.trim(),
    description: options?.description || `包含 ${steps.length} 个自动化操作步骤`,
    mode: options?.mode ?? existing?.mode ?? (options?.assertions && options.assertions.length > 0 ? 'qa' : 'rpa'),
    startUrl,
    urlPattern: options?.urlPattern || (startUrl ? new URL(startUrl).origin : undefined),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    steps,
    parameters: options?.parameters ?? existing?.parameters,
    assertions: options?.assertions ?? existing?.assertions,
    acceptanceCriteria: options?.acceptanceCriteria ?? existing?.acceptanceCriteria,
    lastTestReport: options?.lastTestReport ?? existing?.lastTestReport,
  };

  storeMap[recipeId] = recipe;
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [WORKFLOWS_STORAGE_KEY]: storeMap });
  }
  return recipe;
}

/** 获取指定名称或 ID 的工作流 */
export async function getWorkflowRecipe(nameOrId: string): Promise<WorkflowRecipe | null> {
  const recipes = await listWorkflowRecipes();
  const target = nameOrId.trim().toLowerCase();
  return (
    recipes.find(
      (r) => r.id.toLowerCase() === target || r.name.toLowerCase() === target || r.name.toLowerCase().includes(target),
    ) || null
  );
}

/** 删除指定工作流 */
export async function deleteWorkflowRecipe(nameOrId: string): Promise<boolean> {
  const recipes = await listWorkflowRecipes();
  const target = nameOrId.trim().toLowerCase();
  const recipe = recipes.find(
    (r) => r.id.toLowerCase() === target || r.name.toLowerCase() === target || r.name.toLowerCase().includes(target),
  );
  if (!recipe) return false;

  const storeMap: Record<string, WorkflowRecipe> = {};
  recipes.filter((r) => r.id !== recipe.id).forEach((r) => (storeMap[r.id] = r));

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [WORKFLOWS_STORAGE_KEY]: storeMap });
  }
  return true;
}

const TEST_SKILLS_STORAGE_KEY = 'qa_test_skills_store';

export const PRESET_TEST_SKILLS: import('./types').TestSkillTemplate[] = [
  {
    id: 'skill_preset_corporate_career',
    name: '🏢 企业官网与招聘体验验收 Skill',
    description: '验证能否成功进入企业官网、招聘/关于我们导航正常，且能查看到具体职位与岗位列表',
    targetUrl: 'https://job.haiercash.com',
    acceptanceCriteria: '进入企业官网后，能够顺畅加载企业简介并展示招聘职位列表，无白屏或 404',
    assertions: [
      { id: 'as_p1', type: 'text_contains', target: '职位', description: '页面包含「职位」' },
      { id: 'as_p2', type: 'text_contains', target: '招聘', description: '页面包含「招聘」' },
      { id: 'as_p3', type: 'url_contains', target: 'http', description: 'URL 为有效网络地址' },
    ],
    createdAt: 1700000000000,
    isPreset: true,
  },
  {
    id: 'skill_preset_search_flow',
    name: '🔍 搜索引擎与结果跳转验收 Skill',
    description: '验证搜索关键词后结果列表正常展示，并能成功点击跳转至第一条官方目标页面',
    targetUrl: 'https://www.baidu.com',
    acceptanceCriteria: '在搜索引擎输入目标词后，搜索结果列表展示正常，并能成功跳转至目标官网',
    assertions: [
      { id: 'as_p4', type: 'text_contains', target: '官网', description: '页面包含「官网」' },
      { id: 'as_p5', type: 'url_contains', target: 'http', description: 'URL 为有效网络地址' },
    ],
    createdAt: 1700000000000,
    isPreset: true,
  },
  {
    id: 'skill_preset_form_submit',
    name: '📝 表单提交与成功状态验收 Skill',
    description: '验证表单填写并提交后，页面给出明确的成功提示且无必填校验错误',
    targetUrl: 'https://oa.example.com/form',
    acceptanceCriteria: '表单提交后，页面弹出成功提示框且未触发字段报错',
    assertions: [
      { id: 'as_p6', type: 'text_contains', target: '成功', description: '页面包含「成功」提示' },
    ],
    createdAt: 1700000000000,
    isPreset: true,
  },
  {
    id: 'skill_preset_page_health',
    name: '⚡ 页面白屏与渲染完整性体检 Skill',
    description: '底线健康检查：验证页面完整渲染，无白屏崩溃，DOM 节点结构完整',
    acceptanceCriteria: '页面渲染完整，DOM 节点数 > 10，未发生白屏崩溃',
    assertions: [],
    createdAt: 1700000000000,
    isPreset: true,
  },
];

/** 获取所有测试验收 Skill (预设 + 自定义) */
export async function listTestSkills(): Promise<import('./types').TestSkillTemplate[]> {
  try {
    if (typeof browser === 'undefined' || !browser.storage?.local) return PRESET_TEST_SKILLS;
    const res = (await browser.storage.local.get(TEST_SKILLS_STORAGE_KEY)) as {
      [TEST_SKILLS_STORAGE_KEY]?: Record<string, import('./types').TestSkillTemplate>;
    };
    const store = res[TEST_SKILLS_STORAGE_KEY] || {};
    const customs = Object.values(store).sort((a, b) => b.createdAt - a.createdAt);
    return [...customs, ...PRESET_TEST_SKILLS];
  } catch {
    return PRESET_TEST_SKILLS;
  }
}

/** 保存自定义测试验收 Skill */
export async function saveTestSkill(
  name: string,
  acceptanceCriteria: string,
  assertions: import('./types').TestAssertion[],
  description?: string,
  targetUrl?: string,
): Promise<import('./types').TestSkillTemplate> {
  const all = await listTestSkills();
  const storeMap: Record<string, import('./types').TestSkillTemplate> = {};
  all.filter((s) => !s.isPreset).forEach((s) => (storeMap[s.id] = s));

  const now = Date.now();
  const skillId = `skill_${now}`;
  const skill: import('./types').TestSkillTemplate = {
    id: skillId,
    name: name.trim(),
    description: description || `包含 ${assertions.length} 条断言的验收 Skill`,
    targetUrl: targetUrl?.trim(),
    acceptanceCriteria: acceptanceCriteria.trim(),
    assertions,
    createdAt: now,
    isPreset: false,
  };

  storeMap[skillId] = skill;
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [TEST_SKILLS_STORAGE_KEY]: storeMap });
  }
  return skill;
}

/** 删除自定义测试验收 Skill */
export async function deleteTestSkill(id: string): Promise<boolean> {
  const all = await listTestSkills();
  const storeMap: Record<string, import('./types').TestSkillTemplate> = {};
  all.filter((s) => !s.isPreset && s.id !== id).forEach((s) => (storeMap[s.id] = s));

  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.set({ [TEST_SKILLS_STORAGE_KEY]: storeMap });
  }
  return true;
}

/** 清空所有工作流配方 */
export async function clearAllWorkflowRecipes(): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.remove([WORKFLOWS_STORAGE_KEY]);
  }
}

/** 清空所有自定义测试验收 Skill */
export async function clearCustomTestSkills(): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.remove([TEST_SKILLS_STORAGE_KEY]);
  }
}

/** 一键清空所有用户自定义录制配方与 Skill */
export async function clearAllWorkflowsAndSkills(): Promise<void> {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    await browser.storage.local.remove([WORKFLOWS_STORAGE_KEY, TEST_SKILLS_STORAGE_KEY, RECORDING_SESSION_KEY]);
  }
}

const RECORDING_SESSION_KEY = 'workflow_active_recording_session';

/** 获取当前跨页面活跃的录制会话 */
export async function getActiveRecordingSession(): Promise<import('./types').RecordingSession | null> {
  try {
    if (typeof browser === 'undefined' || !browser.storage?.local) return null;
    const res = (await browser.storage.local.get(RECORDING_SESSION_KEY)) as {
      [RECORDING_SESSION_KEY]?: import('./types').RecordingSession;
    };
    const session = res[RECORDING_SESSION_KEY] || null;
    if (session) {
      // 如果录制会话超过 5 分钟未结束或属于历史残留，自动清理并返回 null
      if (Date.now() - (session.startTime || 0) > 5 * 60 * 1000) {
        await browser.storage.local.remove([RECORDING_SESSION_KEY]);
        return null;
      }
    }
    return session;
  } catch {
    return null;
  }
}

/** 开启跨页面持久化录制会话 (自动锁定录制起始 URL) */
export async function startActiveRecordingSession(tabId?: number, startUrl?: string): Promise<void> {
  if (typeof browser === 'undefined' || !browser.storage?.local) return;
  const initialUrl = startUrl || (typeof window !== 'undefined' ? window.location.href : '');
  const session: import('./types').RecordingSession = {
    isRecording: true,
    tabId,
    startUrl: initialUrl,
    startTime: Date.now(),
    actions: [],
  };
  await browser.storage.local.set({ [RECORDING_SESSION_KEY]: session });
}

let sessionQueue: Promise<unknown> = Promise.resolve();

/** 实时向持久化会话中追加捕获动作 (使用异步互斥队列严格保序防竞态) */
export async function appendActionToSession(action: import('./types').CapturedAction): Promise<number> {
  return new Promise<number>((resolve) => {
    sessionQueue = sessionQueue.then(async () => {
      if (typeof browser === 'undefined' || !browser.storage?.local) {
        resolve(0);
        return;
      }
      try {
        const session = await getActiveRecordingSession();
        if (!session || !session.isRecording) {
          resolve(0);
          return;
        }

        // 若同一输入框且为 type 动作，合并更新值
        const last = session.actions[session.actions.length - 1];
        if (last && last.type === 'type' && action.type === 'type' && last.selector === action.selector) {
          last.value = action.value;
          last.timestamp = action.timestamp;
        } else {
          session.actions.push(action);
        }
        await browser.storage.local.set({ [RECORDING_SESSION_KEY]: session });
        resolve(session.actions.length);
      } catch {
        resolve(0);
      }
    });
  });
}

/** 结束持久化录制会话并返回捕获的所有动作清单及起始 URL */
export async function stopActiveRecordingSession(): Promise<{
  actions: import('./types').CapturedAction[];
  startUrl?: string;
}> {
  return new Promise<{ actions: import('./types').CapturedAction[]; startUrl?: string }>((resolve) => {
    sessionQueue = sessionQueue.then(async () => {
      if (typeof browser === 'undefined' || !browser.storage?.local) {
        resolve({ actions: [] });
        return;
      }
      try {
        const session = await getActiveRecordingSession();
        const actions = session?.actions || [];
        const startUrl = session?.startUrl || actions[0]?.url;
        await browser.storage.local.remove(RECORDING_SESSION_KEY);
        resolve({ actions, startUrl });
      } catch {
        resolve({ actions: [] });
      }
    });
  });
}
