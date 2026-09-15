import {
    ORCH_EXECUTION_MODE_AGENDA,
    ORCH_EXECUTION_MODE_DIRECTOR,
    ORCH_EXECUTION_MODE_LOOP,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from './defaults.js';

export const ORCH_EXECUTION_OUTPUT_CAPSULE = 'capsule';
export const ORCH_EXECUTION_OUTPUT_TAKEOVER = 'takeover';

const defineMode = (definition) => Object.freeze({ ...definition });

/**
 * Product-level execution mode registry.
 *
 * Runtime/persisted ids deliberately remain byte-compatible with older
 * settings and portable profiles. `selectable` only controls whether a mode
 * is offered as a first-class choice to users; legacy ids can remain valid at
 * runtime without being re-advertised in the picker.
 */
export const ORCH_EXECUTION_MODE_REGISTRY = Object.freeze({
    [ORCH_EXECUTION_MODE_SPEC]: defineMode({
        id: ORCH_EXECUTION_MODE_SPEC,
        title: 'Flow · 流程编排',
        summary: '固定流程、明确分工，并通过 Review / Rerun 控制质量。',
        mentalModel: '我决定流程',
        capabilityLabel: '串并行 · Review / Rerun',
        topology: 'fixed',
        agents: 'multi',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: '产物：编排建议',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_AGENDA]: defineMode({
        id: ORCH_EXECUTION_MODE_AGENDA,
        title: 'Planner · 动态调度',
        summary: '由 Planner 维护任务板，并按局势动态选择与调度专家。',
        mentalModel: 'AI 决定用哪些专家',
        capabilityLabel: 'TODO · 动态派工 · Final Agent',
        topology: 'dynamic',
        agents: 'multi',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: '产物：编排建议',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_LOOP]: defineMode({
        id: ORCH_EXECUTION_MODE_LOOP,
        title: 'Agent Loop · 自治循环',
        summary: '一个 Agent 在同一会话里持续调用工具、自我修正，直到主动完成。',
        mentalModel: '一个 Agent 自己查到搞定',
        capabilityLabel: '单 Agent · 工具循环 · 自我修正',
        topology: 'autonomous-single',
        agents: 'single',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: '产物：编排建议',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_DIRECTOR]: defineMode({
        id: ORCH_EXECUTION_MODE_DIRECTOR,
        title: 'Director · 导演接管',
        summary: '主导演可调度子 Agent，并直接撰写、修改最终助手正文。',
        mentalModel: 'AI 团队直接把正文写完',
        capabilityLabel: '主导演 · 子 Agent · 正文写入',
        topology: 'dynamic-hierarchical',
        agents: 'main+subagents',
        output: ORCH_EXECUTION_OUTPUT_TAKEOVER,
        outputLabel: '产物：最终正文',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_SINGLE]: defineMode({
        id: ORCH_EXECUTION_MODE_SINGLE,
        title: '旧版单 Agent（兼容模式）',
        summary: '保留旧配置可继续运行；新配置请使用 Flow 的快速单节点模板。',
        mentalModel: '旧版兼容入口',
        capabilityLabel: 'Legacy · 单节点 Spec',
        topology: 'fixed-single',
        agents: 'single',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: '产物：编排建议',
        presetLibrary: false,
        selectable: false,
        legacy: true,
    }),
});

export const ORCH_SELECTABLE_EXECUTION_MODES = Object.freeze([
    ORCH_EXECUTION_MODE_SPEC,
    ORCH_EXECUTION_MODE_AGENDA,
    ORCH_EXECUTION_MODE_LOOP,
    ORCH_EXECUTION_MODE_DIRECTOR,
]);

export function getOrchExecutionModeDefinition(mode) {
    return ORCH_EXECUTION_MODE_REGISTRY[String(mode || '')]
        || ORCH_EXECUTION_MODE_REGISTRY[ORCH_EXECUTION_MODE_SPEC];
}

export function listSelectableOrchExecutionModes() {
    return ORCH_SELECTABLE_EXECUTION_MODES.map(mode => ORCH_EXECUTION_MODE_REGISTRY[mode]);
}

export function isSelectableOrchExecutionMode(mode) {
    return ORCH_SELECTABLE_EXECUTION_MODES.includes(String(mode || ''));
}
