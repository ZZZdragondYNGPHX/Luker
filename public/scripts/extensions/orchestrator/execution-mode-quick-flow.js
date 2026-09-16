import {
    DEFAULT_SINGLE_AGENT_SYSTEM_PROMPT,
    DEFAULT_SINGLE_AGENT_USER_PROMPT_TEMPLATE,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from './defaults.js';
import {
    createPreset,
    deletePreset,
    getActivePresetId,
    setActivePresetId,
    writeActivePreset,
} from './preset-library.js';
import { getDisplayedScope } from './editor-display.js';
import { getCurrentAvatar } from './snapshot-cache.js';
import {
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
} from './character-overrides.js';
import { persistOrchestratorCharacterExtension } from './editor-persist.js';

export const QUICK_FLOW_FAILURE = Object.freeze({
    SETTINGS_UNAVAILABLE: 'settings_unavailable',
    NOT_LEGACY_SINGLE: 'not_legacy_single',
    CREATE_FAILED: 'create_failed',
    ACTIVATE_FAILED: 'activate_failed',
    WRITE_FAILED: 'write_failed',
    PERSIST_FAILED: 'persist_failed',
});

export function buildQuickSingleNodeFlowPayload(settings) {
    return {
        spec: {
            stages: [{
                id: 'single',
                mode: 'serial',
                nodes: [{
                    id: 'single_agent',
                    preset: 'single_agent',
                }],
            }],
        },
        presets: {
            single_agent: {
                systemPrompt: String(settings?.singleAgentSystemPrompt || DEFAULT_SINGLE_AGENT_SYSTEM_PROMPT),
                userPromptTemplate: String(settings?.singleAgentUserPromptTemplate || DEFAULT_SINGLE_AGENT_USER_PROMPT_TEMPLATE),
            },
        },
    };
}

const DEFAULT_DEPS = Object.freeze({
    createPreset,
    deletePreset,
    getActivePresetId,
    setActivePresetId,
    writeActivePreset,
    getDisplayedScope,
    getCurrentAvatar,
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
    persistOrchestratorCharacterExtension,
});

function failed(reason, extra = {}) {
    return { ok: false, reason, ...extra };
}

async function persistPresetScope(context, scope, avatar, deps) {
    if (scope !== 'character') {
        if (typeof context?.saveSettings === 'function') {
            await context.saveSettings();
        }
        return true;
    }

    const characterIndex = deps.getCharacterIndexByAvatar(context, avatar);
    const extension = deps.getCharacterExtensionDataByAvatar(context, avatar);
    if (characterIndex < 0 || !extension || typeof extension !== 'object') return false;
    const nextExtension = {
        ...extension,
        override: { mode: ORCH_EXECUTION_MODE_SPEC },
        overrideEnabled: {
            ...(extension.overrideEnabled && typeof extension.overrideEnabled === 'object'
                ? extension.overrideEnabled
                : {}),
            [ORCH_EXECUTION_MODE_SPEC]: true,
        },
    };
    return Boolean(await deps.persistOrchestratorCharacterExtension(context, characterIndex, nextExtension));
}

function rollbackPreset(settings, scope, avatar, presetId, previousActiveId, deps) {
    const options = { context: null, avatar };
    // The context is filled by the caller before use. Keeping rollback in one
    // helper ensures every post-create failure restores the same library state.
    return { settings, scope, presetId, previousActiveId, options, deps };
}

function applyRollback(context, snapshot) {
    const { settings, scope, avatar, presetId, previousActiveId, deps } = snapshot;
    const options = { context, avatar };
    deps.deletePreset(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, options);
    if (previousActiveId) {
        deps.setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, previousActiveId, options);
    }
}

/**
 * Create a Flow preset equivalent to the legacy Single runtime profile.
 *
 * This is intentionally transactional from the caller's point of view:
 * mode switching is NOT performed here. The UI only switches to `spec` after
 * this function returns ok=true. Any create/activate/write/persist failure
 * removes the newly-created preset and restores the previous active id.
 */
export async function createQuickSingleNodeFlowPreset({
    context,
    settings,
    presetName = 'Quick single-node',
    legacyConversion = false,
    deps: injectedDeps = null,
} = {}) {
    const deps = injectedDeps ? { ...DEFAULT_DEPS, ...injectedDeps } : DEFAULT_DEPS;
    if (!context || !settings || typeof settings !== 'object') {
        return failed(QUICK_FLOW_FAILURE.SETTINGS_UNAVAILABLE);
    }
    if (legacyConversion
        && String(settings.executionMode || '') !== ORCH_EXECUTION_MODE_SINGLE
        && settings.singleAgentModeEnabled !== true) {
        return failed(QUICK_FLOW_FAILURE.NOT_LEGACY_SINGLE);
    }

    let scope = deps.getDisplayedScope(context, settings) === 'character' ? 'character' : 'global';
    let avatar = String(deps.getCurrentAvatar(context) || '').trim();
    if (scope === 'character' && (!avatar || deps.getCharacterIndexByAvatar(context, avatar) < 0)) {
        scope = 'global';
        avatar = '';
    }

    let options = { context, avatar };
    let previousActiveId = deps.getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
    let presetId = deps.createPreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        { name: String(presetName || 'Quick single-node') },
        options,
    );

    // Character preset libraries are intentionally not auto-created by read
    // accessors. If no writable card-scoped container exists, fall back to the
    // established global library instead of inventing a phantom override.
    if (!presetId && scope === 'character') {
        scope = 'global';
        avatar = '';
        options = { context, avatar };
        previousActiveId = deps.getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
        presetId = deps.createPreset(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            scope,
            { name: String(presetName || 'Quick single-node') },
            options,
        );
    }
    if (!presetId) return failed(QUICK_FLOW_FAILURE.CREATE_FAILED);

    const rollback = rollbackPreset(settings, scope, avatar, presetId, previousActiveId, deps);
    const activated = deps.setActivePresetId(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        presetId,
        options,
    );
    if (!activated) {
        applyRollback(context, rollback);
        return failed(QUICK_FLOW_FAILURE.ACTIVATE_FAILED);
    }

    const writeResult = deps.writeActivePreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        buildQuickSingleNodeFlowPayload(settings),
        options,
    );
    if (!writeResult || writeResult.ok === false) {
        applyRollback(context, rollback);
        return failed(QUICK_FLOW_FAILURE.WRITE_FAILED);
    }

    let persisted = false;
    try {
        persisted = await persistPresetScope(context, scope, avatar, deps);
    } catch (error) {
        console.error('[orchestrator] quick Flow preset persistence failed:', error);
        persisted = false;
    }
    if (!persisted) {
        applyRollback(context, rollback);
        return failed(QUICK_FLOW_FAILURE.PERSIST_FAILED);
    }

    return {
        ok: true,
        scope,
        avatar,
        presetId,
        previousActiveId,
        legacyConversion: Boolean(legacyConversion),
    };
}
