import { describe, expect, it, vi } from 'vitest';
import {
  distillHabitHeuristic,
  distillHabitWithLLM,
  generalizeSelector,
} from '../../src/utils/workflow/skillDistiller';
import type { CapturedAction, WorkflowStep } from '../../src/utils/workflow/types';
import type { AiSettings } from '../../src/utils/ai/provider/types';

describe('AI Habit & Skill Distillation (习惯归纳与 Skill 提炼)', () => {
  it('generalizeSelector: 正确剥离 nth-child / nth-of-type 选择器', () => {
    expect(generalizeSelector('table > tbody > tr:nth-child(2) > td > a')).toBe('table > tbody > tr > td > a');
    expect(generalizeSelector('ul.list > li:nth-of-type(4)')).toBe('ul.list > li');
    expect(generalizeSelector('#app div:nth-child(1) > button')).toBe('#app div > button');
  });

  it('distillHabitHeuristic: 单次示范识别为批量审批习惯并生成循环步骤与子动作 (One-shot Approval Demonstration)', () => {
    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: 'table.ant-table-tbody > tr:nth-child(1) > td.action > a',
        targetText: '查看审批详情',
        tag: 'a',
        url: 'https://beisen.example.com/workflow/pending',
        title: '北森待办审批',
      },
      {
        type: 'type',
        timestamp: Date.now() + 500,
        selector: 'textarea[name="comment"]',
        targetText: '审批意见',
        tag: 'textarea',
        value: '同意，符合规范',
        url: 'https://beisen.example.com/workflow/pending',
        title: '北森待办审批',
      },
      {
        type: 'click',
        timestamp: Date.now() + 1000,
        selector: 'button.btn-agree',
        targetText: '同意并流转',
        tag: 'button',
        url: 'https://beisen.example.com/workflow/pending',
        title: '北森待办审批',
      },
    ];

    const rawSteps: WorkflowStep[] = [
      { id: '1', type: 'click', description: '点击「查看审批详情」', selector: rawActions[0]!.selector },
      { id: '2', type: 'type', description: '在「审批意见」输入「同意，符合规范」', selector: rawActions[1]!.selector, value: '同意，符合规范' },
      { id: '3', type: 'click', description: '点击「同意并流转」', selector: rawActions[2]!.selector },
    ];

    const habit = distillHabitHeuristic(rawActions, rawSteps, 'https://beisen.example.com/workflow/pending');

    expect(habit.isBatchPattern).toBe(true);
    expect(habit.name).toContain('全量待办记录自动批量审批');
    expect(habit.loopTarget?.selector).toBe('table.ant-table-tbody > tr > td.action > a');
    expect(habit.steps.length).toBe(1);
    expect(habit.steps[0]!.isLoop).toBe(true);
    expect(habit.steps[0]!.subSteps?.length).toBe(3);
    expect(habit.parameters?.length).toBe(1);
    expect(habit.parameters?.[0]!.key).toBe('approvalComment');
    expect(habit.parameters?.[0]!.defaultValue).toBe('同意，符合规范');
  });

  it('distillHabitHeuristic: 先点击多个导航链接再做列表审批，前置导航步骤与批量循环步骤均完整保留', () => {
    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: 'nav.header-nav > a.menu-item:nth-child(1)',
        targetText: '协同办公',
        tag: 'a',
        url: 'https://oa.example.com/home',
        title: 'OA 系统',
      },
      {
        type: 'click',
        timestamp: Date.now() + 300,
        selector: 'aside.sidebar > ul > li:nth-child(2) > a',
        targetText: '我的待办列表',
        tag: 'a',
        url: 'https://oa.example.com/pending',
        title: '我的待办',
      },
      {
        type: 'click',
        timestamp: Date.now() + 600,
        selector: 'table.ant-table-tbody > tr:nth-child(1) > td.action > a',
        targetText: '查看审批详情',
        tag: 'a',
        url: 'https://oa.example.com/pending',
        title: '我的待办',
      },
      {
        type: 'type',
        timestamp: Date.now() + 900,
        selector: 'textarea[name="comment"]',
        targetText: '审批意见',
        tag: 'textarea',
        value: '同意',
        url: 'https://oa.example.com/pending',
        title: '我的待办',
      },
      {
        type: 'click',
        timestamp: Date.now() + 1200,
        selector: 'button.btn-submit',
        targetText: '提交审批',
        tag: 'button',
        url: 'https://oa.example.com/pending',
        title: '我的待办',
      },
    ];

    const rawSteps = [
      { id: '1', type: 'click' as const, description: '点击「协同办公」', selector: rawActions[0]!.selector },
      { id: '2', type: 'click' as const, description: '点击「我的待办列表」', selector: rawActions[1]!.selector },
      { id: '3', type: 'click' as const, description: '点击「查看审批详情」', selector: rawActions[2]!.selector },
      { id: '4', type: 'type' as const, description: '输入「同意」', selector: rawActions[3]!.selector, value: '同意' },
      { id: '5', type: 'click' as const, description: '点击「提交审批」', selector: rawActions[4]!.selector },
    ];

    const habit = distillHabitHeuristic(rawActions, rawSteps, 'https://oa.example.com/pending');

    expect(habit.isBatchPattern).toBe(true);
    // 前置步骤 2 步 + 1 步批量循环 = 共 3 步
    expect(habit.steps.length).toBe(3);
    expect(habit.steps[0]!.description).toContain('协同办公');
    expect(habit.steps[1]!.description).toContain('我的待办列表');
    expect(habit.steps[2]!.isLoop).toBe(true);
    expect(habit.steps[2]!.subSteps?.length).toBe(3);
    expect(habit.parameters?.[0]!.defaultValue).toBe('同意');
  });

  it('distillHabitHeuristic: 非列表操作保持单次线性模式', () => {
    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: '#btn-login',
        targetText: '登录',
        tag: 'button',
        url: 'https://example.com/login',
        title: '系统登录',
      },
    ];
    const steps: WorkflowStep[] = [{ id: '1', type: 'click', description: '点击「登录」', selector: '#btn-login' }];

    const habit = distillHabitHeuristic(rawActions, steps, 'https://example.com/login');
    expect(habit.isBatchPattern).toBe(false);
    expect(habit.steps.length).toBe(1);
    expect(habit.steps[0]!.isLoop).toBeUndefined();
  });

  it('distillHabitWithLLM: 支持模型返回结构化 JSON 泛化 Skill', async () => {
    const mockSettings: AiSettings = {
      providers: [
        {
          id: 'test-p',
          kind: 'openai-compat',
          label: 'Test',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-4o',
        },
      ],
      activeProviderId: 'test-p',
      maxDocChars: 10000,
      confirmOnSend: false,
      rememberSession: true,
      trustedSession: true,
    };

    const mockJsonResponse = JSON.stringify({
      name: '北森已审批记录全量批量流转 Skill',
      description: '针对审批列表所有待办项自动填写同意并提交',
      isBatchPattern: true,
      loopTarget: {
        name: '待审批表格行',
        selector: 'table.ant-table-tbody tr',
      },
      subSteps: [
        { type: 'click', description: '点击进入记录', selector: 'td a' },
        { type: 'type', description: '填写意见', selector: 'textarea', value: '{{approvalComment}}' },
        { type: 'click', description: '提交', selector: 'button.submit' },
      ],
      parameters: [
        { key: 'approvalComment', label: '审批意见', defaultValue: '同意' },
      ],
      acceptanceCriteria: '完成全量列表批量流转',
    });

    // Mock fetch SSE response
    const mockFetch = vi.fn().mockImplementation(async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: mockJsonResponse } }] })}\n\n`),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });

    vi.stubGlobal('fetch', mockFetch);

    const rawActions: CapturedAction[] = [
      {
        type: 'click',
        timestamp: Date.now(),
        selector: 'table > tr:nth-child(1) > td > a',
        tag: 'a',
        url: 'https://oa.test.com',
        title: 'OA',
      },
    ];

    const habit = await distillHabitWithLLM(rawActions, [], 'https://oa.test.com', mockSettings);
    expect(habit.name).toBe('北森已审批记录全量批量流转 Skill');
    expect(habit.isBatchPattern).toBe(true);
    expect(habit.loopTarget?.selector).toBe('table.ant-table-tbody tr');
    expect(habit.subSteps?.length).toBe(3);
    expect(habit.parameters?.[0]?.defaultValue).toBe('同意');

    vi.unstubAllGlobals();
  });
});
