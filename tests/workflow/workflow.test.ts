import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildWorkflowSteps } from '../../src/utils/workflow/recorder';
import {
  saveWorkflowRecipe,
  listWorkflowRecipes,
  getWorkflowRecipe,
  deleteWorkflowRecipe,
} from '../../src/utils/workflow/storage';
import type { CapturedAction } from '../../src/utils/workflow/types';

describe('Workflow System (流程自动化与工作流配方)', () => {
  let mockStore: Record<string, any> = {};

  beforeEach(() => {
    mockStore = {};
    (globalThis as any).browser = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: mockStore[key] })),
          set: vi.fn(async (obj: Record<string, any>) => {
            Object.assign(mockStore, obj);
          }),
          remove: vi.fn(async (key: string) => {
            delete mockStore[key];
          }),
        },
      },
    };
  });

  it('buildWorkflowSteps: 正确将原始捕获序列提炼为可读工作流步骤', () => {
    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: '#nav-workbench',
        targetText: '工作台',
        tag: 'button',
        url: 'https://oa.example.com/home',
        title: 'OA 系统',
      },
      {
        type: 'type',
        timestamp: Date.now(),
        selector: 'input[name="username"]',
        targetText: '用户名',
        tag: 'input',
        value: 'admin',
        url: 'https://oa.example.com/login',
        title: '登录',
      },
      {
        type: 'click',
        timestamp: Date.now(),
        selector: '.btn-sign',
        targetText: '打卡签到',
        tag: 'button',
        url: 'https://oa.example.com/workbench',
        title: '工作台',
      },
    ];

    const steps = buildWorkflowSteps(rawActions);
    expect(steps.length).toBe(3);
    expect(steps[0]!.type).toBe('click');
    expect(steps[0]!.description).toBe('点击「工作台」');
    expect(steps[1]!.type).toBe('type');
    expect(steps[1]!.description).toBe('在「用户名」输入「admin」');
    expect(steps[1]!.value).toBe('admin');
    expect(steps[2]!.type).toBe('click');
    expect(steps[2]!.description).toBe('点击「打卡签到」');
  });

  it('buildWorkflowSteps: 自动过滤输入框前置聚焦冗余点击并支持回车提交动作', () => {
    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: '#kw',
        targetText: '搜索框',
        tag: 'input',
        url: 'https://www.baidu.com',
        title: '百度',
      },
      {
        type: 'type',
        timestamp: Date.now() + 100,
        selector: '#kw',
        targetText: '搜索框',
        tag: 'input',
        value: 'AI Agent',
        url: 'https://www.baidu.com',
        title: '百度',
      },
      {
        type: 'pressEnter',
        timestamp: Date.now() + 200,
        selector: '#kw',
        targetText: '搜索框',
        tag: 'input',
        url: 'https://www.baidu.com',
        title: '百度',
      },
    ];

    const steps = buildWorkflowSteps(rawActions);
    // 冗余的 click on #kw 应该被自动过滤，保留 type 和 pressEnter
    expect(steps.length).toBe(2);
    expect(steps[0]!.type).toBe('type');
    expect(steps[0]!.value).toBe('AI Agent');
    expect(steps[1]!.type).toBe('pressEnter');
    expect(steps[1]!.description).toContain('回车');
  });

  it('saveWorkflowRecipe & listWorkflowRecipes: 支持保存与查询工作流', async () => {
    const steps = [
      { id: '1', type: 'click' as const, description: '点击「打卡」', selector: '#btn-checkin' },
    ];
    const saved = await saveWorkflowRecipe('每日打卡', steps, {
      description: '每天早上 9 点打卡',
      urlPattern: 'https://oa.example.com',
    });

    expect(saved.id).toBeDefined();
    expect(saved.name).toBe('每日打卡');
    expect(saved.steps.length).toBe(1);

    const list = await listWorkflowRecipes();
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe('每日打卡');
  });

  it('getWorkflowRecipe & deleteWorkflowRecipe: 支持按名称/ID 获取与删除工作流', async () => {
    const steps = [{ id: '1', type: 'click' as const, description: '点击提交' }];
    await saveWorkflowRecipe('周报提交', steps);

    const found = await getWorkflowRecipe('周报提交');
    expect(found).toBeDefined();
    expect(found?.name).toBe('周报提交');

    const deleted = await deleteWorkflowRecipe('周报提交');
    expect(deleted).toBe(true);

    const remaining = await listWorkflowRecipes();
    expect(remaining.length).toBe(0);
  });

  it('activeRecordingSession: 支持跨页面/跳转过程中的动作追加与持久化结算', async () => {
    const {
      startActiveRecordingSession,
      getActiveRecordingSession,
      appendActionToSession,
      stopActiveRecordingSession,
    } = await import('../../src/utils/workflow/storage');

    await startActiveRecordingSession(101);
    const session = await getActiveRecordingSession();
    expect(session?.isRecording).toBe(true);

    await appendActionToSession({
      type: 'type',
      timestamp: Date.now(),
      selector: '#kw',
      targetText: '搜索框',
      tag: 'input',
      value: 'AI Agent',
      url: 'https://www.baidu.com',
      title: '百度',
    });

    await appendActionToSession({
      type: 'click',
      timestamp: Date.now(),
      selector: '#su',
      targetText: '百度一下',
      tag: 'input',
      url: 'https://www.baidu.com',
      title: '百度',
    });

    const { actions: stoppedActions, startUrl } = await stopActiveRecordingSession();
    expect(stoppedActions.length).toBe(2);
    expect(startUrl).toBe('https://www.baidu.com');
    expect(stoppedActions[0]!.value).toBe('AI Agent');
    expect(stoppedActions[1]!.targetText).toBe('百度一下');

    const sessionAfterStop = await getActiveRecordingSession();
    expect(sessionAfterStop).toBeNull();
  });

  it('支持保存自动化测试断言、验收标准并持久化测试执行报告快照', async () => {
    const steps = [
      {
        id: 's1',
        type: 'type' as const,
        description: '在「搜索框」输入「海尔消费金融」',
        value: '海尔消费金融',
        url: 'https://www.baidu.com',
      },
      {
        id: 's2',
        type: 'click' as const,
        description: '点击「百度一下」',
        url: 'https://www.baidu.com',
      },
    ];

    const assertions = [
      {
        id: 'as_1',
        type: 'text_contains' as const,
        target: '海尔消费金融官网',
        description: '验证页面包含「海尔消费金融官网」',
      },
      {
        id: 'as_2',
        type: 'url_contains' as const,
        target: 'haiercash',
        description: '验证 URL 包含「haiercash」',
      },
    ];

    const saved = await saveWorkflowRecipe('海尔招聘自动化测试', steps, {
      startUrl: 'https://www.baidu.com',
      acceptanceCriteria: '进入官网后能够正常加载招聘与业务栏目',
      assertions,
    });

    expect(saved.assertions?.length).toBe(2);
    expect(saved.acceptanceCriteria).toBe('进入官网后能够正常加载招聘与业务栏目');

    const loaded = await getWorkflowRecipe(saved.id);
    expect(loaded?.assertions?.length).toBe(2);
    expect(loaded?.assertions?.[0]?.target).toBe('海尔消费金融官网');
  });

  it('支持管理与复用验收标准 Skill 技能库 (预设 + 自定义 Skill 模版)', async () => {
    const { listTestSkills, saveTestSkill, deleteTestSkill } = await import(
      '../../src/utils/workflow/storage'
    );

    // 1. 获取预设 Skill
    const initialSkills = await listTestSkills();
    expect(initialSkills.length).toBeGreaterThanOrEqual(4);
    const preset = initialSkills.find((s) => s.id === 'skill_preset_corporate_career');
    expect(preset?.name).toContain('企业官网与招聘体验验收 Skill');
    expect(preset?.assertions.length).toBeGreaterThan(0);

    // 2. 新增自定义 Skill
    const savedSkill = await saveTestSkill(
      '电商下单验收 Skill',
      '商品成功加入购物车并跳转至结算页',
      [
        { id: 'as_cart_1', type: 'text_contains', target: '结算', description: '包含结算按钮' },
        { id: 'as_cart_2', type: 'url_contains', target: '/checkout', description: 'URL 进入结算页' },
      ],
      '用于电商核心交易链路验收',
    );
    expect(savedSkill.name).toBe('电商下单验收 Skill');
    expect(savedSkill.isPreset).toBe(false);

    const skillsAfterSave = await listTestSkills();
    expect(skillsAfterSave.some((s) => s.id === savedSkill.id)).toBe(true);

    // 3. 删除自定义 Skill
    await deleteTestSkill(savedSkill.id);
    const skillsAfterDelete = await listTestSkills();
    expect(skillsAfterDelete.some((s) => s.id === savedSkill.id)).toBe(false);
  });

  it('支持流程双模分流模式 (RPA 业务代办 vs QA 自动化测试) 与动态入参模板存储', async () => {
    // 1. RPA 业务代办工作流 (带动态参数 {{variable}})
    const rpaRecipe = await saveWorkflowRecipe(
      '智能打卡与填报',
      [
        {
          id: 'step_1',
          type: 'type',
          description: '输入工号「{{emp_id}}」',
          value: '{{emp_id}}',
          selector: '#emp-input',
        },
        {
          id: 'step_2',
          type: 'click',
          description: '点击打卡',
          selector: '#btn-checkin',
        },
      ],
      {
        mode: 'rpa',
        parameters: [
          { key: 'emp_id', label: '员工工号', defaultValue: 'E1001', description: '登录员工工号' },
        ],
      },
    );

    expect(rpaRecipe.mode).toBe('rpa');
    expect(rpaRecipe.parameters?.length).toBe(1);
    expect(rpaRecipe.parameters?.[0]?.key).toBe('emp_id');
    expect(rpaRecipe.parameters?.[0]?.defaultValue).toBe('E1001');

    // 2. QA 自动化测试用例 (带断言与报告)
    const qaRecipe = await saveWorkflowRecipe(
      '职位搜索自动化冒烟测试',
      [
        {
          id: 'step_qa_1',
          type: 'click',
          description: '点击校园招聘',
          selector: '.campus-link',
        },
      ],
      {
        mode: 'qa',
        acceptanceCriteria: '页面展示校招岗位列表',
        assertions: [
          {
            id: 'as_qa_1',
            type: 'text_contains',
            target: '校招岗位',
            description: '包含校招岗位',
          },
        ],
      },
    );

    expect(qaRecipe.mode).toBe('qa');
    expect(qaRecipe.assertions?.length).toBe(1);

    const all = await listWorkflowRecipes();
    expect(all.length).toBe(2);
    const rpaList = all.filter((r) => r.mode === 'rpa');
    const qaList = all.filter((r) => r.mode === 'qa');
    expect(rpaList.length).toBe(1);
    expect(qaList.length).toBe(1);
  });
});

