import { describe, expect, test } from '@jest/globals';
import {
    ORCH_EXECUTION_MODE_AGENDA,
    ORCH_EXECUTION_MODE_DIRECTOR,
    ORCH_EXECUTION_MODE_LOOP,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from '../../public/scripts/extensions/orchestrator/defaults.js';
import {
    ORCH_EXECUTION_MODE_REGISTRY,
    ORCH_EXECUTION_OUTPUT_CAPSULE,
    ORCH_EXECUTION_OUTPUT_TAKEOVER,
    ORCH_SELECTABLE_EXECUTION_MODES,
    getOrchExecutionModeDefinition,
    isSelectableOrchExecutionMode,
    listSelectableOrchExecutionModes,
} from '../../public/scripts/extensions/orchestrator/execution-mode-registry.js';

describe('execution mode registry', () => {
    test('exposes exactly four first-class selectable modes', () => {
        expect(ORCH_SELECTABLE_EXECUTION_MODES).toEqual([
            ORCH_EXECUTION_MODE_SPEC,
            ORCH_EXECUTION_MODE_AGENDA,
            ORCH_EXECUTION_MODE_LOOP,
            ORCH_EXECUTION_MODE_DIRECTOR,
        ]);
        expect(listSelectableOrchExecutionModes().map(mode => mode.id)).toEqual(ORCH_SELECTABLE_EXECUTION_MODES);
    });

    test('keeps legacy single runnable but out of the first-class picker', () => {
        const legacy = ORCH_EXECUTION_MODE_REGISTRY[ORCH_EXECUTION_MODE_SINGLE];
        expect(legacy).toMatchObject({
            id: ORCH_EXECUTION_MODE_SINGLE,
            selectable: false,
            legacy: true,
            presetLibrary: false,
            output: ORCH_EXECUTION_OUTPUT_CAPSULE,
        });
        expect(isSelectableOrchExecutionMode(ORCH_EXECUTION_MODE_SINGLE)).toBe(false);
    });

    test('only Director owns the final assistant message', () => {
        const takeoverModes = listSelectableOrchExecutionModes()
            .filter(mode => mode.output === ORCH_EXECUTION_OUTPUT_TAKEOVER)
            .map(mode => mode.id);
        expect(takeoverModes).toEqual([ORCH_EXECUTION_MODE_DIRECTOR]);
        expect(ORCH_EXECUTION_MODE_REGISTRY[ORCH_EXECUTION_MODE_SPEC].output).toBe(ORCH_EXECUTION_OUTPUT_CAPSULE);
        expect(ORCH_EXECUTION_MODE_REGISTRY[ORCH_EXECUTION_MODE_AGENDA].output).toBe(ORCH_EXECUTION_OUTPUT_CAPSULE);
        expect(ORCH_EXECUTION_MODE_REGISTRY[ORCH_EXECUTION_MODE_LOOP].output).toBe(ORCH_EXECUTION_OUTPUT_CAPSULE);
    });

    test('unknown ids fall back to Flow metadata without changing persisted ids', () => {
        expect(getOrchExecutionModeDefinition('unknown-mode').id).toBe(ORCH_EXECUTION_MODE_SPEC);
        expect(isSelectableOrchExecutionMode('unknown-mode')).toBe(false);
    });
});
