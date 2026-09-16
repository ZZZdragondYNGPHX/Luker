import {
    DEFAULT_SINGLE_AGENT_SYSTEM_PROMPT,
    DEFAULT_SINGLE_AGENT_USER_PROMPT_TEMPLATE,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from './defaults.js';

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
    // Production registers the canonical preset-library actions through
    // execution-mode-quick-flow-browser-deps.js. Keeping those imports out of
    // this transaction core prevents the full browser/sanitizer graph from
    // being pulled into Node/Jest just to test commit/rollback semantics.
    createPreset: () => '',
    deletePreset: () => false,
    getActivePresetId: () => '',
    setActivePresetId: () => false,
    writeActivePreset: () => ({ ok: false }),
    getDisplayedScope: () => 'global',
    getCurrentAvatar: fallbackGetCurrentAvatar,
    getCharacterExtensionDataByAvatar: fallbackGetCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar: fallbackGetCharacterIndexByAvatar,
    persistOrchestratorCharacterExtension: async () => false,
});

let configuredRuntimeDeps = {};

/**
 * Register production/browser dependency adapters without making this core
 * module import editor/display/preset-library modules at evaluation time.
 * Tests can import the transaction service in a pure Node environment; the
 * real orchestrator bootstrap injects the existing canonical helpers.
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
        // Preset-library character writes mutate the live card extension in
        // place, while the mode pin + enabled flag are assembled on a cloned
        // payload for writeExtensionField. Mirror the committed payload back
        // into the same live object so memory and card state cannot diverge.
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

    if (!presetId && scope === 'character') {
        // Failed character creation is allowed to fall back to global, but an
        // implementation may already have touched the live card container.
        // Restore that container before switching scopes.
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

    // Explicit Legacy Single conversion preserves the old effective prompts.
    // Ordinary quick-Flow creation uses shipped defaults, not stale hidden
    // legacy customization.
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
