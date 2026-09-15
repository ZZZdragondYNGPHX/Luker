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
        title: 'Flow · Workflow',
        summary: 'Use a fixed workflow with explicit roles and Review / Rerun quality gates.',
        mentalModel: 'I decide the flow',
        capabilityLabel: 'Serial/parallel · Review / Rerun',
        topology: 'fixed',
        agents: 'multi',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: 'Output: orchestration guidance',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_AGENDA]: defineMode({
        id: ORCH_EXECUTION_MODE_AGENDA,
        title: 'Planner · Dynamic dispatch',
        summary: 'Let the Planner maintain the task board and dynamically dispatch experts as needed.',
        mentalModel: 'AI chooses which experts to use',
        capabilityLabel: 'TODO · Dynamic dispatch · Final Agent',
        topology: 'dynamic',
        agents: 'multi',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: 'Output: orchestration guidance',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_LOOP]: defineMode({
        id: ORCH_EXECUTION_MODE_LOOP,
        title: 'Agent Loop · Autonomous loop',
        summary: 'One Agent keeps using tools and self-correcting in the same session until it finishes.',
        mentalModel: 'One Agent investigates until done',
        capabilityLabel: 'Single Agent · Tool loop · Self-correction',
        topology: 'autonomous-single',
        agents: 'single',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: 'Output: orchestration guidance',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_DIRECTOR]: defineMode({
        id: ORCH_EXECUTION_MODE_DIRECTOR,
        title: 'Director · Generation takeover',
        summary: 'The main Director can dispatch sub-agents and directly write or revise the final assistant reply.',
        mentalModel: 'AI team writes the final reply',
        capabilityLabel: 'Main Director · Sub-Agents · Message writing',
        topology: 'dynamic-hierarchical',
        agents: 'main+subagents',
        output: ORCH_EXECUTION_OUTPUT_TAKEOVER,
        outputLabel: 'Output: final reply',
        presetLibrary: true,
        selectable: true,
        legacy: false,
    }),
    [ORCH_EXECUTION_MODE_SINGLE]: defineMode({
        id: ORCH_EXECUTION_MODE_SINGLE,
        title: 'Legacy Single Agent (compatibility mode)',
        summary: 'Existing legacy configs keep running; new configs should use Flow with the quick single-node template.',
        mentalModel: 'Legacy compatibility entry',
        capabilityLabel: 'Legacy · Single-node Spec',
        topology: 'fixed-single',
        agents: 'single',
        output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        outputLabel: 'Output: orchestration guidance',
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
