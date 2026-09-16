import { describe, expect, jest, test } from '@jest/globals';
import {
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from '../../public/scripts/extensions/orchestrator/defaults.js';
import {
    QUICK_FLOW_FAILURE,
    createQuickSingleNodeFlowPreset,
} from '../../public/scripts/extensions/orchestrator/execution-mode-quick-flow.js';

function makeSettings() {
    return {
        executionMode: ORCH_EXECUTION_MODE_SINGLE,
        singleAgentModeEnabled: true,
        singleAgentSystemPrompt: 'legacy real system',
        singleAgentUserPromptTemplate: 'legacy real user {{last_user}}',
        presetLibraries: {
            spec: {
                old: {
                    name: 'Old',
                    spec: {
                        stages: [{
                            id: 'old_stage',
                            mode: 'serial',
                            nodes: [{ id: 'old_agent', preset: 'old_agent' }],
                        }],
                    },
                    presets: {
                        old_agent: {
                            systemPrompt: 'old',
                            userPromptTemplate: 'old',
                        },
                    },
                },
            },
            agenda: {},
            loop: {},
            director: {},
        },
        activePresetIds: {
            spec: 'old',
            agenda: '',
            loop: '',
            director: '',
        },
    };
}

function makeCharacterExtension() {
    return {
        override: { mode: ORCH_EXECUTION_MODE_SINGLE },
        overrideEnabled: { agenda: true },
        presetLibraries: {
            spec: {
                old: {
                    name: 'Character Old',
                    spec: {
                        stages: [{
                            id: 'card_stage',
                            mode: 'serial',
                            nodes: [{ id: 'card_agent', preset: 'card_agent' }],
                        }],
                    },
                    presets: {
                        card_agent: {
                            systemPrompt: 'card old',
                            userPromptTemplate: 'card old',
                        },
                    },
                },
            },
            agenda: {},
            loop: {},
            director: {},
        },
        activePresetIds: {
            spec: 'old',
            agenda: '',
            loop: '',
            director: '',
        },
        privateMarker: {
            preserveMe: true,
            nested: { value: 42 },
        },
    };
}

function makeCharacterContext(extension) {
    return {
        saveSettings: jest.fn(async () => {}),
        characters: [{
            avatar: 'card.png',
            data: {
                extensions: {
                    orchestrator: extension,
                },
            },
        }],
    };
}

describe('quick Flow + real preset library', () => {
    test('creates and activates a sanitized single-node Flow preset from Legacy Single', async () => {
        const settings = makeSettings();
        const context = { saveSettings: jest.fn(async () => {}) };

        const result = await createQuickSingleNodeFlowPreset({
            context,
            settings,
            presetName: 'Migrated real preset',
            legacyConversion: true,
            deps: {
                getDisplayedScope: () => 'global',
                getCurrentAvatar: () => '',
            },
        });

        expect(result.ok).toBe(true);
        expect(result.scope).toBe('global');
        expect(result.previousActiveId).toBe('old');
        expect(result.presetId).not.toBe('old');
        expect(settings.executionMode).toBe(ORCH_EXECUTION_MODE_SINGLE);
        expect(settings.activePresetIds.spec).toBe(result.presetId);

        const migrated = settings.presetLibraries.spec[result.presetId];
        expect(migrated.name).toBe('Migrated real preset');
        expect(migrated.spec.stages).toEqual([
            expect.objectContaining({
                id: 'single',
                mode: 'serial',
                nodes: [expect.objectContaining({
                    id: 'single_agent',
                    preset: 'single_agent',
                })],
            }),
        ]);
        expect(migrated.presets.single_agent).toEqual(expect.objectContaining({
            systemPrompt: 'legacy real system',
            userPromptTemplate: 'legacy real user {{last_user}}',
        }));
        expect(context.saveSettings).toHaveBeenCalledTimes(1);

        // The service only commits the preset. The existing main.js select
        // change handler remains the sole owner of switching executionMode.
        expect(settings.executionMode).not.toBe(ORCH_EXECUTION_MODE_SPEC);
    });

    test('uses the real live character preset container and preserves private fields', async () => {
        const settings = makeSettings();
        const extension = makeCharacterExtension();
        const context = makeCharacterContext(extension);
        const persist = jest.fn(async () => true);

        const result = await createQuickSingleNodeFlowPreset({
            context,
            settings,
            presetName: 'Character migrated',
            legacyConversion: true,
            deps: {
                getDisplayedScope: () => 'character',
                getCurrentAvatar: () => 'card.png',
                persistOrchestratorCharacterExtension: persist,
            },
        });

        expect(result).toMatchObject({
            ok: true,
            scope: 'character',
            avatar: 'card.png',
            previousActiveId: 'old',
        });
        expect(extension.activePresetIds.spec).toBe(result.presetId);
        expect(extension.presetLibraries.spec[result.presetId]).toBeDefined();
        expect(extension.override).toEqual({ mode: ORCH_EXECUTION_MODE_SPEC });
        expect(extension.overrideEnabled).toEqual(expect.objectContaining({ agenda: true, spec: true }));
        expect(extension.privateMarker).toEqual({ preserveMe: true, nested: { value: 42 } });
        expect(persist).toHaveBeenCalledTimes(1);
        expect(persist.mock.calls[0][2]).toEqual(expect.objectContaining({
            privateMarker: { preserveMe: true, nested: { value: 42 } },
            override: { mode: ORCH_EXECUTION_MODE_SPEC },
        }));
        expect(context.saveSettings).not.toHaveBeenCalled();
    });

    test('restores the real live character container and private fields when card persistence fails', async () => {
        const settings = makeSettings();
        const extension = makeCharacterExtension();
        const original = structuredClone(extension);
        const context = makeCharacterContext(extension);
        const persist = jest.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);

        const result = await createQuickSingleNodeFlowPreset({
            context,
            settings,
            presetName: 'Should rollback',
            legacyConversion: true,
            deps: {
                getDisplayedScope: () => 'character',
                getCurrentAvatar: () => 'card.png',
                persistOrchestratorCharacterExtension: persist,
            },
        });

        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.PERSIST_FAILED });
        expect(extension).toEqual(original);
        expect(persist).toHaveBeenCalledTimes(2);
        expect(persist.mock.calls[1][2]).toEqual(original);
        expect(context.saveSettings).not.toHaveBeenCalled();
    });
});
