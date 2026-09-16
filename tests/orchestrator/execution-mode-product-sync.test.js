import { describe, expect, test } from '@jest/globals';
import {
    ORCH_EXECUTION_MODE_AGENDA,
    ORCH_EXECUTION_MODE_DIRECTOR,
    ORCH_EXECUTION_MODE_LOOP,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from '../../public/scripts/extensions/orchestrator/defaults.js';
import {
    executionModeOwnsFinalReply,
    getExecutionModeProductDefinition,
    syncExecutionModeProductUi,
} from '../../public/scripts/extensions/orchestrator/execution-mode-product-sync.js';

describe('execution mode product sync', () => {
    test('derives final-reply ownership exclusively from registry metadata', () => {
        expect(executionModeOwnsFinalReply(ORCH_EXECUTION_MODE_DIRECTOR)).toBe(true);
        expect(executionModeOwnsFinalReply(ORCH_EXECUTION_MODE_SPEC)).toBe(false);
        expect(executionModeOwnsFinalReply(ORCH_EXECUTION_MODE_AGENDA)).toBe(false);
        expect(executionModeOwnsFinalReply(ORCH_EXECUTION_MODE_LOOP)).toBe(false);
        expect(executionModeOwnsFinalReply(ORCH_EXECUTION_MODE_SINGLE)).toBe(false);
    });

    test('uses the registry as the public title source including Legacy Single', () => {
        expect(getExecutionModeProductDefinition(ORCH_EXECUTION_MODE_SPEC)).toMatchObject({
            id: ORCH_EXECUTION_MODE_SPEC,
            title: 'Flow · Workflow',
        });
        expect(getExecutionModeProductDefinition(ORCH_EXECUTION_MODE_SINGLE)).toMatchObject({
            id: ORCH_EXECUTION_MODE_SINGLE,
            title: 'Legacy Single Agent (compatibility mode)',
            legacy: true,
        });
    });

    test('is safe to call in the node test environment without a DOM', () => {
        expect(() => syncExecutionModeProductUi(null, ORCH_EXECUTION_MODE_DIRECTOR)).not.toThrow();
    });
});
