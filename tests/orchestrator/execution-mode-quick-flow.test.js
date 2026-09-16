import { describe, expect, jest, test } from '@jest/globals';
import {
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from '../../public/scripts/extensions/orchestrator/defaults.js';
import {
    QUICK_FLOW_FAILURE,
    buildQuickSingleNodeFlowPayload,
    createQuickSingleNodeFlowPreset,
} from '../../public/scripts/extensions/orchestrator/execution-mode-quick-flow.js';

function makeDeps(overrides = {}) {
    return {
        getDisplayedScope: jest.fn(() => 'global'),
        getCurrentAvatar: jest.fn(() => ''),
        getCharacterIndexByAvatar: jest.fn(() => -1),
        getCharacterExtensionDataByAvatar: jest.fn(() => ({})),
        persistOrchestratorCharacterExtension: jest.fn(async () => true),
        getActivePresetId: jest.fn(() => 'old'),
        createPreset: jest.fn(() => 'new'),
        setActivePresetId: jest.fn(() => true),
        writeActivePreset: jest.fn(() => ({ ok: true })),
        deletePreset: jest.fn(() => true),
        ...overrides,
    };
}

function makeLegacySettings() {
    return {
        executionMode: ORCH_EXECUTION_MODE_SINGLE,
        singleAgentModeEnabled: true,
        singleAgentSystemPrompt: 'legacy system',
        singleAgentUserPromptTemplate: 'legacy user {{last_user}}',
    };
}

describe('quick Flow single-node conversion', () => {
    test('builds the one-stage one-worker Flow payload from legacy prompts', () => {
        const payload = buildQuickSingleNodeFlowPayload(makeLegacySettings());
        expect(payload.spec).toEqual({
            stages: [{
                id: 'single',
                mode: 'serial',
                nodes: [{ id: 'single_agent', preset: 'single_agent' }],
            }],
        });
        expect(payload.presets.single_agent).toEqual({
            systemPrompt: 'legacy system',
            userPromptTemplate: 'legacy user {{last_user}}',
        });
    });

    test('commits global preset first and leaves executionMode switching to the UI', async () => {
        const settings = makeLegacySettings();
        const context = { saveSettings: jest.fn(async () => {}) };
        const deps = makeDeps();

        const result = await createQuickSingleNodeFlowPreset({
            context,
            settings,
            presetName: 'Migrated',
            legacyConversion: true,
            deps,
        });

        expect(result).toMatchObject({ ok: true, scope: 'global', presetId: 'new', legacyConversion: true });
        expect(deps.createPreset).toHaveBeenCalledWith(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            'global',
            { name: 'Migrated' },
            { context, avatar: '' },
        );
        expect(deps.writeActivePreset).toHaveBeenCalledWith(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            'global',
            expect.objectContaining({ presets: expect.any(Object), spec: expect.any(Object) }),
            { context, avatar: '' },
        );
        expect(context.saveSettings).toHaveBeenCalledTimes(1);
        expect(settings.executionMode).toBe(ORCH_EXECUTION_MODE_SINGLE);
        expect(deps.deletePreset).not.toHaveBeenCalled();
    });

    test('rejects legacy conversion when legacy Single is not active', async () => {
        const settings = { executionMode: ORCH_EXECUTION_MODE_SPEC, singleAgentModeEnabled: false };
        const deps = makeDeps();
        const result = await createQuickSingleNodeFlowPreset({
            context: { saveSettings: jest.fn() },
            settings,
            legacyConversion: true,
            deps,
        });
        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.NOT_LEGACY_SINGLE });
        expect(deps.createPreset).not.toHaveBeenCalled();
    });

    test('rolls back the new preset when activation fails', async () => {
        const settings = makeLegacySettings();
        const deps = makeDeps({ setActivePresetId: jest.fn(() => false) });
        const context = { saveSettings: jest.fn() };
        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.ACTIVATE_FAILED });
        expect(deps.deletePreset).toHaveBeenCalledWith(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            'global',
            'new',
            { context, avatar: '' },
        );
        expect(deps.writeActivePreset).not.toHaveBeenCalled();
    });

    test('rolls back and restores previous active preset when writing fails', async () => {
        const settings = makeLegacySettings();
        const setActivePresetId = jest.fn(() => true);
        const deps = makeDeps({
            setActivePresetId,
            writeActivePreset: jest.fn(() => ({ ok: false, reason: 'validation_commit' })),
        });
        const context = { saveSettings: jest.fn() };
        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.WRITE_FAILED });
        expect(deps.deletePreset).toHaveBeenCalledTimes(1);
        expect(setActivePresetId).toHaveBeenNthCalledWith(
            2,
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            'global',
            'old',
            { context, avatar: '' },
        );
    });

    test('rolls back when global persistence throws', async () => {
        const settings = makeLegacySettings();
        const deps = makeDeps();
        const context = { saveSettings: jest.fn(async () => { throw new Error('disk failed'); }) };
        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.PERSIST_FAILED });
        expect(deps.deletePreset).toHaveBeenCalledTimes(1);
        expect(deps.setActivePresetId).toHaveBeenLastCalledWith(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            'global',
            'old',
            { context, avatar: '' },
        );
    });

    test('persists character Flow override without disturbing other override-enabled modes', async () => {
        const settings = makeLegacySettings();
        const extension = {
            override: { mode: ORCH_EXECUTION_MODE_SINGLE },
            overrideEnabled: { agenda: true },
            presetLibraries: { spec: { old: { name: 'Old' } } },
            activePresetIds: { spec: 'old' },
        };
        const persist = jest.fn(async () => true);
        const deps = makeDeps({
            getDisplayedScope: jest.fn(() => 'character'),
            getCurrentAvatar: jest.fn(() => 'card.png'),
            getCharacterIndexByAvatar: jest.fn(() => 3),
            getCharacterExtensionDataByAvatar: jest.fn(() => extension),
            persistOrchestratorCharacterExtension: persist,
        });
        const context = { saveSettings: jest.fn() };
        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toMatchObject({ ok: true, scope: 'character', avatar: 'card.png' });
        expect(persist).toHaveBeenCalledWith(
            context,
            3,
            expect.objectContaining({
                override: { mode: ORCH_EXECUTION_MODE_SPEC },
                overrideEnabled: expect.objectContaining({ agenda: true, spec: true }),
            }),
        );
        expect(extension).toEqual(expect.objectContaining({
            override: { mode: ORCH_EXECUTION_MODE_SPEC },
            overrideEnabled: expect.objectContaining({ agenda: true, spec: true }),
        }));
        expect(context.saveSettings).not.toHaveBeenCalled();
    });

    test('restores the exact character extension and compensates card persistence after a failed write', async () => {
        const settings = makeLegacySettings();
        const originalExtension = {
            override: { mode: ORCH_EXECUTION_MODE_SINGLE },
            overrideEnabled: { agenda: true },
            presetLibraries: { spec: { old: { name: 'Old', spec: { stages: [] }, presets: {} } } },
            activePresetIds: { spec: 'old' },
            privateMarker: { keep: true },
        };
        const extension = structuredClone(originalExtension);
        const createPreset = jest.fn(() => {
            extension.presetLibraries.spec.new = { name: 'New' };
            return 'new';
        });
        const setActivePresetId = jest.fn((_, __, ___, id) => {
            extension.activePresetIds.spec = id;
            return true;
        });
        const writeActivePreset = jest.fn(() => {
            extension.presetLibraries.spec.new = {
                name: 'New',
                spec: { stages: [{ id: 'single', mode: 'serial', nodes: [] }] },
                presets: {},
            };
            return { ok: true };
        });
        const persist = jest.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce(true);
        const deps = makeDeps({
            getDisplayedScope: jest.fn(() => 'character'),
            getCurrentAvatar: jest.fn(() => 'card.png'),
            getCharacterIndexByAvatar: jest.fn(() => 4),
            getCharacterExtensionDataByAvatar: jest.fn(() => extension),
            createPreset,
            setActivePresetId,
            writeActivePreset,
            persistOrchestratorCharacterExtension: persist,
        });

        const result = await createQuickSingleNodeFlowPreset({
            context: { saveSettings: jest.fn() },
            settings,
            deps,
        });

        expect(result).toEqual({ ok: false, reason: QUICK_FLOW_FAILURE.PERSIST_FAILED });
        expect(extension).toEqual(originalExtension);
        expect(persist).toHaveBeenCalledTimes(2);
        expect(persist).toHaveBeenNthCalledWith(
            2,
            expect.any(Object),
            4,
            originalExtension,
        );
        expect(deps.deletePreset).not.toHaveBeenCalled();
    });

    test('restores character mutations before falling back to the global library', async () => {
        const settings = makeLegacySettings();
        const originalExtension = {
            presetLibraries: { spec: {} },
            activePresetIds: { spec: '' },
            marker: 'original',
        };
        const extension = structuredClone(originalExtension);
        const createPreset = jest.fn((_, __, scope) => {
            if (scope === 'character') {
                extension.presetLibraries.spec.temporary = { name: 'Temporary' };
                extension.activePresetIds.spec = 'temporary';
                extension.marker = 'mutated';
                return '';
            }
            return 'global-new';
        });
        const deps = makeDeps({
            getDisplayedScope: jest.fn(() => 'character'),
            getCurrentAvatar: jest.fn(() => 'card.png'),
            getCharacterIndexByAvatar: jest.fn(() => 2),
            getCharacterExtensionDataByAvatar: jest.fn(() => extension),
            createPreset,
            getActivePresetId: jest.fn((_, __, { scope }) => scope === 'character' ? '' : 'global-old'),
        });
        const context = { saveSettings: jest.fn(async () => {}) };

        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toMatchObject({ ok: true, scope: 'global', avatar: '', presetId: 'global-new' });
        expect(extension).toEqual(originalExtension);
        expect(createPreset).toHaveBeenCalledTimes(2);
        expect(context.saveSettings).toHaveBeenCalledTimes(1);
        expect(deps.persistOrchestratorCharacterExtension).not.toHaveBeenCalled();
    });

    test('falls back to global when character scope has no writable preset container', async () => {
        const settings = makeLegacySettings();
        const createPreset = jest.fn()
            .mockReturnValueOnce('')
            .mockReturnValueOnce('global-new');
        const deps = makeDeps({
            getDisplayedScope: jest.fn(() => 'character'),
            getCurrentAvatar: jest.fn(() => 'card.png'),
            getCharacterIndexByAvatar: jest.fn(() => 2),
            createPreset,
            getActivePresetId: jest.fn((_, __, { scope }) => scope === 'character' ? '' : 'global-old'),
        });
        const context = { saveSettings: jest.fn(async () => {}) };
        const result = await createQuickSingleNodeFlowPreset({ context, settings, deps });

        expect(result).toMatchObject({ ok: true, scope: 'global', avatar: '', presetId: 'global-new' });
        expect(createPreset).toHaveBeenCalledTimes(2);
        expect(context.saveSettings).toHaveBeenCalledTimes(1);
        expect(deps.persistOrchestratorCharacterExtension).not.toHaveBeenCalled();
    });
});
