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

function fallbackGetCurrentAvatar(context) {
    const characterId = Number(context?.characterId);
    if (!Number.isInteger(characterId) || characterId < 0) return '';
    return String(context?.characters?.[characterId]?.avatar || '');
}

function fallbackGetCharacterIndexByAvatar(context, avatar) {
    const target = String(avatar || '');
    if (!target) return -1;
    return (context?.characters || []).findIndex(char => String(char?.avatar || '') === target);
}

function fallbackGetCharacterExtensionDataByAvatar(context, avatar) {
    const index = fallbackGetCharacterIndexByAvatar(context, avatar);
    if (index < 0) return {};
    const payload = context?.characters?.[index]?.data?.extensions?.orchestrator;
    return payload && typeof payload === 'object' ? payload : {};
}

const DEFAULT_DEPS = Object.freeze({
    createPreset,
    deletePreset,
    getActivePresetId,
    setActivePresetId,
    writeActivePreset,
    // Browser/UI-specific sources of truth are registered by
    // execution-mode-quick-flow-browser-deps.js. Pure fallbacks keep this
    // transaction module importable under Node/Jest and make global-scope
    // callers deterministic even outside the UI bootstrap.
    getDisplayedScope: () => 'global',
    getCurrentAvatar: fallbackGetCurrentAvatar,
    getCharacterExtensionDataByAvatar: fallbackGetCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar: fallbackGetCharacterIndexByAvatar,
    persistOrchestratorCharacterExtension: async () => false,
});

let configuredRuntimeDeps = {};

/**
 * Register production/browser dependency adapters without making this core
 * module import editor/display modules at evaluation time. Tests can import
 * the transaction service in a pure Node environment; the real orchestrator
 * bootstrap injects the existing scope/avatar/card persistence helpers.
 */
export function configureQuickFlowRuntimeDeps(deps = {}) {
    if (!deps || typeof deps !== 'object') return;
    configuredRuntimeDeps = { ...configuredRuntimeDeps, ...deps };
}

function failed(reason, extra = {}) {
    return { ok: false, reason, ...extra };
}

function clonePlainObject(value) {
    if (!value || typeof value !== 'object') return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function restoreObjectInPlace(target, snapshot) {
    if (!target || typeof target !== 'object') return false;
    for (const key of Object.keys(target)) delete target[key];
    if (snapshot && typeof snapshot === 'object') {
        Object.assign(target, clonePlainObject(snapshot));
    }
    return true;
}

function captureCharacterSnapshot(context, avatar, deps) {
    if (!avatar) return null;
    const extension = deps.getCharacterExtensionDataByAvatar(context, avatar);
    return extension && typeof extension === 'object'
        ? clonePlainObject(extension)
        : null;
}

function restoreCharacterSnapshot(context, avatar, snapshot, deps) {
    if (!avatar || !snapshot || typeof snapshot !== 'object') return false;
    const extension = deps.getCharacterExtensionDataByAvatar(context, avatar);
    return restoreObjectInPlace(extension, snapshot);
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
    const persisted = Boolean(await deps.persistOrchestratorCharacterExtension(context, characterIndex, nextExtension));
    if (persisted) {
        // `createPreset` / `writeActivePreset` mutate the live character
        // extension container in place, while the mode pin + enabled flag are
        // assembled on a cloned payload for `writeExtensionField`. Mirror the
        // committed payload back into the same live object so the current
        // session and the on-card value cannot diverge when the persistence
        // helper does not itself replace the in-memory extension object.
        restoreObjectInPlace(extension, nextExtension);
    }
    return persisted;
}

function applyRollback(context, {
    settings,
    scope,
    avatar,
    presetId,
    previousActiveId,
    characterSnapshot,
    deps,
}) {
    if (scope === 'character' && characterSnapshot) {
        restoreCharacterSnapshot(context, avatar, characterSnapshot, deps);
        return;
    }

    const options = { context, avatar };
    deps.deletePreset(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, options);
    if (previousActiveId) {
        deps.setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, previousActiveId, options);
    }
}

async function compensateGlobalPersistence(context) {
    if (typeof context?.saveSettings !== 'function') return true;
    try {
        await context.saveSettings();
        return true;
    } catch (error) {
        console.warn('[orchestrator] quick Flow global rollback persistence failed:', error);
        return false;
    }
}

async function compensateCharacterPersistence(context, avatar, snapshot, deps) {
    if (!avatar || !snapshot || typeof snapshot !== 'object') return true;
    const characterIndex = deps.getCharacterIndexByAvatar(context, avatar);
    if (characterIndex < 0) return false;
    try {
        return Boolean(await deps.persistOrchestratorCharacterExtension(
            context,
            characterIndex,
            clonePlainObject(snapshot),
        ));
    } catch (error) {
        console.warn('[orchestrator] quick Flow character rollback persistence failed:', error);
        return false;
    }
}

/**
 * Create a Flow preset equivalent to the legacy Single runtime profile, or a
 * clean default single-node Flow preset for normal (non-legacy) creation.
 *
 * This is intentionally transactional from the caller's point of view:
 * mode switching is NOT performed here. The UI only switches to `spec` after
 * this function returns ok=true. Any create/activate/write/persist failure
 * removes the newly-created preset and restores the previous active id.
 *
 * Character scope needs a stronger rollback boundary than global scope:
 * preset-library mutates the live card extension object before the async card
 * write runs. We therefore snapshot the complete orchestrator extension before
 * mutation, restore that object exactly on failure, and make a best-effort
 * compensating card write if the original persistence attempt failed after a
 * partial remote commit.
 *
 * Global persistence also gets a compensating save after rollback. This covers
 * the defensive edge case where `saveSettings()` writes part/all of the new
 * state and then rejects: the second save persists the restored preset library.
 */
export async function createQuickSingleNodeFlowPreset({
    context,
    settings,
    presetName = 'Quick single-node',
    legacyConversion = false,
    deps: injectedDeps = null,
} = {}) {
    const deps = {
        ...DEFAULT_DEPS,
        ...configuredRuntimeDeps,
        ...(injectedDeps && typeof injectedDeps === 'object' ? injectedDeps : {}),
    };
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

    let characterSnapshot = scope === 'character'
        ? captureCharacterSnapshot(context, avatar, deps)
        : null;
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
        // A failed character create is allowed to fall back to global, but the
        // attempted character path may already have touched live extension
        // containers. Put the card back exactly as it was before switching
        // scopes so the fallback itself cannot create a phantom override.
        if (characterSnapshot) {
            restoreCharacterSnapshot(context, avatar, characterSnapshot, deps);
        }
        scope = 'global';
        avatar = '';
        characterSnapshot = null;
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

    const rollback = {
        settings,
        scope,
        avatar,
        presetId,
        previousActiveId,
        characterSnapshot,
        deps,
    };
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

    // Explicit Legacy Single migration preserves the old effective prompts.
    // Ordinary Flow quick-template creation must be clean and deterministic,
    // so it intentionally seeds from the shipped defaults instead of hidden
    // legacy fields that may contain stale customization from years ago.
    const payloadSource = legacyConversion ? settings : null;
    const writeResult = deps.writeActivePreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        buildQuickSingleNodeFlowPayload(payloadSource),
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
        if (scope === 'character' && characterSnapshot) {
            const rollbackPersisted = await compensateCharacterPersistence(
                context,
                avatar,
                characterSnapshot,
                deps,
            );
            if (!rollbackPersisted) {
                console.warn('[orchestrator] quick Flow character rollback restored memory but could not confirm card persistence.');
            }
        } else if (scope === 'global') {
            const rollbackPersisted = await compensateGlobalPersistence(context);
            if (!rollbackPersisted) {
                console.warn('[orchestrator] quick Flow global rollback restored memory but could not confirm settings persistence.');
            }
        }
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
