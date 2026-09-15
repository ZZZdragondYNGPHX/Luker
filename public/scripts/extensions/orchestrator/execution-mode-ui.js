import {
    DEFAULT_SINGLE_AGENT_SYSTEM_PROMPT,
    DEFAULT_SINGLE_AGENT_USER_PROMPT_TEMPLATE,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from './defaults.js';
import {
    getOrchExecutionModeDefinition,
    listSelectableOrchExecutionModes,
} from './execution-mode-registry.js';
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

const MODULE_NAME = 'orchestrator';
const MODE_SELECT_ID = 'luker_orch_execution_mode';
const MODE_UI_ATTR = 'data-luker-orch-mode-ui';
const QUICK_FLOW_PRESET_NAME = '快速单节点（迁移自旧版 Single）';

function getContext() {
    try {
        return globalThis.Luker?.getContext?.() || null;
    } catch (_) {
        return null;
    }
}

function getSettings(context) {
    const settings = context?.extensionSettings?.[MODULE_NAME];
    return settings && typeof settings === 'object' ? settings : null;
}

function notify(kind, message) {
    const text = String(message || '');
    const toastr = globalThis.toastr;
    if (toastr && typeof toastr[kind] === 'function') {
        toastr[kind](text);
        return;
    }
    if (kind === 'error') console.error(`[${MODULE_NAME}] ${text}`);
}

function buildQuickSingleNodeFlowPayload(settings) {
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

async function persistPresetScope(context, scope, avatar) {
    if (scope !== 'character') {
        if (typeof context?.saveSettings === 'function') {
            await context.saveSettings();
        }
        return true;
    }

    const characterIndex = getCharacterIndexByAvatar(context, avatar);
    const extension = getCharacterExtensionDataByAvatar(context, avatar);
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
    return Boolean(await persistOrchestratorCharacterExtension(context, characterIndex, nextExtension));
}

async function convertLegacySingleToFlow(select) {
    const context = getContext();
    const settings = getSettings(context);
    if (!context || !settings) {
        notify('error', '无法读取编排设置，未执行转换。');
        return false;
    }
    if (String(settings.executionMode || '') !== ORCH_EXECUTION_MODE_SINGLE
        && settings.singleAgentModeEnabled !== true) {
        return false;
    }

    let scope = getDisplayedScope(context, settings) === 'character' ? 'character' : 'global';
    let avatar = String(getCurrentAvatar(context) || '').trim();
    if (scope === 'character' && (!avatar || getCharacterIndexByAvatar(context, avatar) < 0)) {
        scope = 'global';
        avatar = '';
    }

    let options = { context, avatar };
    let previousActiveId = getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
    let presetId = createPreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        { name: QUICK_FLOW_PRESET_NAME },
        options,
    );

    // A legacy Single configuration can exist without a character preset
    // container. Falling back to global keeps conversion explicit and avoids
    // creating a new character override behind the user's back.
    if (!presetId && scope === 'character') {
        scope = 'global';
        avatar = '';
        options = { context, avatar };
        previousActiveId = getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
        presetId = createPreset(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            scope,
            { name: QUICK_FLOW_PRESET_NAME },
            options,
        );
    }
    if (!presetId) {
        notify('error', '无法创建 Flow 快速单节点预设，旧版 Single 保持不变。');
        return false;
    }

    const finalOptions = { context, avatar };
    const finalPreviousActiveId = previousActiveId;
    setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, finalOptions);
    const writeResult = writeActivePreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        buildQuickSingleNodeFlowPayload(settings),
        finalOptions,
    );

    if (!writeResult || writeResult.ok === false) {
        deletePreset(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, finalOptions);
        if (finalPreviousActiveId) {
            setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, finalPreviousActiveId, finalOptions);
        }
        notify('error', '写入 Flow 快速单节点预设失败，旧版 Single 保持不变。');
        return false;
    }

    const persisted = await persistPresetScope(context, scope, avatar);
    if (!persisted) {
        deletePreset(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, finalOptions);
        if (finalPreviousActiveId) {
            setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, finalPreviousActiveId, finalOptions);
        }
        notify('error', '保存 Flow 快速单节点预设失败，旧版 Single 保持不变。');
        return false;
    }

    select.value = ORCH_EXECUTION_MODE_SPEC;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    notify('success', '已转换为 Flow 快速单节点预设；旧版 Single 提示词仍保留作兼容。');
    return true;
}

function modeCard(definition, selectedMode) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'luker-orch-mode-card';
    button.dataset.mode = definition.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', definition.id === selectedMode ? 'true' : 'false');
    button.innerHTML = `
        <span class="luker-orch-mode-card-title"></span>
        <span class="luker-orch-mode-card-summary"></span>
        <span class="luker-orch-mode-card-meta">
            <span class="luker-orch-mode-card-capability"></span>
            <span class="luker-orch-mode-card-output"></span>
        </span>`;
    button.querySelector('.luker-orch-mode-card-title').textContent = definition.title;
    button.querySelector('.luker-orch-mode-card-summary').textContent = definition.summary;
    button.querySelector('.luker-orch-mode-card-capability').textContent = definition.capabilityLabel;
    button.querySelector('.luker-orch-mode-card-output').textContent = definition.outputLabel;
    return button;
}

function syncModeUi(select, host) {
    const currentMode = String(select.value || ORCH_EXECUTION_MODE_SPEC);
    host.querySelectorAll('.luker-orch-mode-card').forEach((card) => {
        const active = card.dataset.mode === currentMode;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    let legacy = host.querySelector('.luker-orch-mode-legacy');
    if (currentMode !== ORCH_EXECUTION_MODE_SINGLE) {
        legacy?.remove();
        return;
    }
    if (legacy) return;

    const definition = getOrchExecutionModeDefinition(ORCH_EXECUTION_MODE_SINGLE);
    legacy = document.createElement('div');
    legacy.className = 'luker-orch-mode-legacy';
    legacy.innerHTML = `
        <div class="luker-orch-mode-legacy-copy">
            <strong></strong>
            <span></span>
        </div>
        <button type="button" class="menu_button luker-orch-mode-convert">转换为 Flow 快速单节点</button>`;
    legacy.querySelector('strong').textContent = definition.title;
    legacy.querySelector('.luker-orch-mode-legacy-copy span').textContent = definition.summary;
    legacy.querySelector('.luker-orch-mode-convert').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await convertLegacySingleToFlow(select);
        } catch (error) {
            console.error(`[${MODULE_NAME}] legacy Single conversion failed:`, error);
            notify('error', '转换失败，旧版 Single 保持不变。');
        } finally {
            button.disabled = false;
        }
    });
    host.prepend(legacy);
}

function decorateModeSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.getAttribute(MODE_UI_ATTR) === '1') return;

    const host = document.createElement('div');
    host.className = 'luker-orch-mode-picker';
    host.setAttribute('role', 'radiogroup');
    host.setAttribute('aria-label', '执行模式');

    const intro = document.createElement('div');
    intro.className = 'luker-orch-mode-picker-intro';
    intro.textContent = '选择谁负责流程，以及最终产物由谁写入正文。';
    host.appendChild(intro);

    const grid = document.createElement('div');
    grid.className = 'luker-orch-mode-grid';
    for (const definition of listSelectableOrchExecutionModes()) {
        const card = modeCard(definition, String(select.value || ''));
        card.addEventListener('click', () => {
            if (select.value === definition.id) return;
            select.value = definition.id;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        grid.appendChild(card);
    }
    host.appendChild(grid);

    select.insertAdjacentElement('afterend', host);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.setAttribute(MODE_UI_ATTR, '1');
    select.addEventListener('change', () => syncModeUi(select, host));
    syncModeUi(select, host);
}

function ensureModePickerStyles() {
    if (document.getElementById('luker-orch-mode-picker-styles')) return;
    const style = document.createElement('style');
    style.id = 'luker-orch-mode-picker-styles';
    style.textContent = `
        .luker-orch-mode-picker { display: grid; gap: 10px; margin: 4px 0 10px; }
        .luker-orch-mode-picker-intro { opacity: .75; font-size: .92em; }
        .luker-orch-mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .luker-orch-mode-card { display: grid; gap: 6px; min-width: 0; padding: 10px; text-align: left; border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; background: var(--SmartThemeBlurTintColor); color: inherit; cursor: pointer; }
        .luker-orch-mode-card:hover { filter: brightness(1.08); }
        .luker-orch-mode-card.is-active { outline: 2px solid var(--SmartThemeQuoteColor); outline-offset: -2px; }
        .luker-orch-mode-card-title { font-weight: 700; }
        .luker-orch-mode-card-summary { opacity: .82; font-size: .9em; line-height: 1.35; }
        .luker-orch-mode-card-meta { display: flex; flex-wrap: wrap; gap: 5px; }
        .luker-orch-mode-card-meta > span { padding: 2px 6px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 999px; font-size: .78em; opacity: .9; }
        .luker-orch-mode-legacy { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px dashed var(--SmartThemeQuoteColor); border-radius: 8px; }
        .luker-orch-mode-legacy-copy { display: grid; gap: 3px; min-width: 0; }
        .luker-orch-mode-legacy-copy span { opacity: .8; font-size: .9em; }
        .luker-orch-mode-convert { flex: 0 0 auto; }
        @media (max-width: 700px) {
            .luker-orch-mode-grid { grid-template-columns: 1fr; }
            .luker-orch-mode-legacy { align-items: stretch; flex-direction: column; }
        }
    `;
    document.head.appendChild(style);
}

function scanModePickers(root = document) {
    const select = root instanceof Element && root.id === MODE_SELECT_ID
        ? root
        : root.querySelector?.(`#${MODE_SELECT_ID}`);
    if (select) decorateModeSelect(select);
}

function initExecutionModeUi() {
    ensureModePickerStyles();
    scanModePickers();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                scanModePickers(node);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExecutionModeUi, { once: true });
    } else {
        initExecutionModeUi();
    }
}

export { buildQuickSingleNodeFlowPayload, convertLegacySingleToFlow };
