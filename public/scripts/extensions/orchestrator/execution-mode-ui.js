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
import { i18n } from './i18n.js';

const MODULE_NAME = 'orchestrator';

const EXECUTION_MODE_LOCALE_ZH_CN = Object.freeze({
    'Flow · Workflow': 'Flow · 流程编排',
    'Use a fixed workflow with explicit roles and Review / Rerun quality gates.': '固定流程、明确分工，并通过 Review / Rerun 控制质量。',
    'I decide the flow': '我决定流程',
    'Serial/parallel · Review / Rerun': '串并行 · Review / Rerun',
    'Planner · Dynamic dispatch': 'Planner · 动态调度',
    'Let the Planner maintain the task board and dynamically dispatch experts as needed.': '由 Planner 维护任务板，并按局势动态选择与调度专家。',
    'AI chooses which experts to use': 'AI 决定用哪些专家',
    'TODO · Dynamic dispatch · Final Agent': 'TODO · 动态派工 · Final Agent',
    'Agent Loop · Autonomous loop': 'Agent Loop · 自治循环',
    'One Agent keeps using tools and self-correcting in the same session until it finishes.': '一个 Agent 在同一会话里持续调用工具、自我修正，直到主动完成。',
    'One Agent investigates until done': '一个 Agent 自己查到搞定',
    'Single Agent · Tool loop · Self-correction': '单 Agent · 工具循环 · 自我修正',
    'Director · Generation takeover': 'Director · 导演接管',
    'The main Director can dispatch sub-agents and directly write or revise the final assistant reply.': '主导演可调度子 Agent，并直接撰写、修改最终助手正文。',
    'AI team writes the final reply': 'AI 团队直接把正文写完',
    'Main Director · Sub-Agents · Message writing': '主导演 · 子 Agent · 正文写入',
    'Output: orchestration guidance': '产物：编排建议',
    'Output: final reply': '产物：最终正文',
    'Legacy Single Agent (compatibility mode)': '旧版单 Agent（兼容模式）',
    'Existing legacy configs keep running; new configs should use Flow with the quick single-node template.': '保留旧配置可继续运行；新配置请使用 Flow 的快速单节点模板。',
    'Legacy compatibility entry': '旧版兼容入口',
    'Legacy · Single-node Spec': 'Legacy · 单节点 Spec',
    'Choose who owns the workflow and who writes the final reply.': '选择谁负责流程，以及最终产物由谁写入正文。',
    'Convert to Flow quick single-node': '转换为 Flow 快速单节点',
    'Quick single-node': '快速单节点',
    'Quick single-node (migrated from Legacy Single)': '快速单节点（迁移自旧版 Single）',
    'Create Flow quick single-node preset': '创建 Flow 快速单节点预设',
    'Could not read orchestration settings; conversion was not performed.': '无法读取编排设置，未执行转换。',
    'Could not create the Flow quick single-node preset.': '无法创建 Flow 快速单节点预设。',
    'Could not write the Flow quick single-node preset.': '写入 Flow 快速单节点预设失败。',
    'Could not save the Flow quick single-node preset.': '保存 Flow 快速单节点预设失败。',
    'Created a Flow quick single-node preset.': '已创建 Flow 快速单节点预设。',
    'Could not create the Flow quick single-node preset; Legacy Single was left unchanged.': '无法创建 Flow 快速单节点预设，旧版 Single 保持不变。',
    'Could not write the Flow quick single-node preset; Legacy Single was left unchanged.': '写入 Flow 快速单节点预设失败，旧版 Single 保持不变。',
    'Could not save the Flow quick single-node preset; Legacy Single was left unchanged.': '保存 Flow 快速单节点预设失败，旧版 Single 保持不变。',
    'Converted to a Flow quick single-node preset. Legacy Single prompts were kept for compatibility.': '已转换为 Flow 快速单节点预设；旧版 Single 提示词仍保留作兼容。',
    'Conversion failed; Legacy Single was left unchanged.': '转换失败，旧版 Single 保持不变。',
});

const EXECUTION_MODE_LOCALE_ZH_TW = Object.freeze({
    ...EXECUTION_MODE_LOCALE_ZH_CN,
    'Flow · Workflow': 'Flow · 流程編排',
    'Use a fixed workflow with explicit roles and Review / Rerun quality gates.': '固定流程、明確分工，並透過 Review / Rerun 控制品質。',
    'I decide the flow': '我決定流程',
    'Planner · Dynamic dispatch': 'Planner · 動態調度',
    'Let the Planner maintain the task board and dynamically dispatch experts as needed.': '由 Planner 維護任務板，並依情況動態選擇與調度專家。',
    'AI chooses which experts to use': 'AI 決定使用哪些專家',
    'Agent Loop · Autonomous loop': 'Agent Loop · 自治循環',
    'One Agent keeps using tools and self-correcting in the same session until it finishes.': '一個 Agent 在同一工作階段持續呼叫工具、自我修正，直到主動完成。',
    'Director · Generation takeover': 'Director · 導演接管',
    'Output: orchestration guidance': '產物：編排建議',
    'Output: final reply': '產物：最終正文',
    'Legacy Single Agent (compatibility mode)': '舊版單 Agent（相容模式）',
    'Existing legacy configs keep running; new configs should use Flow with the quick single-node template.': '保留舊設定繼續運作；新設定請使用 Flow 的快速單節點範本。',
    'Choose who owns the workflow and who writes the final reply.': '選擇誰負責流程，以及最終產物由誰寫入正文。',
    'Convert to Flow quick single-node': '轉換為 Flow 快速單節點',
    'Quick single-node': '快速單節點',
    'Create Flow quick single-node preset': '建立 Flow 快速單節點預設',
    'Could not create the Flow quick single-node preset.': '無法建立 Flow 快速單節點預設。',
    'Could not write the Flow quick single-node preset.': '寫入 Flow 快速單節點預設失敗。',
    'Could not save the Flow quick single-node preset.': '儲存 Flow 快速單節點預設失敗。',
    'Created a Flow quick single-node preset.': '已建立 Flow 快速單節點預設。',
});

function registerExecutionModeLocaleData(context) {
    const addLocaleData = context?.addLocaleData;
    if (typeof addLocaleData !== 'function') return;
    addLocaleData('zh-cn', EXECUTION_MODE_LOCALE_ZH_CN);
    addLocaleData('zh-tw', EXECUTION_MODE_LOCALE_ZH_TW);
}

function t(text) {
    return i18n(text);
}
const MODE_SELECT_ID = 'luker_orch_execution_mode';
const MODE_UI_ATTR = 'data-luker-orch-mode-ui';
const QUICK_FLOW_PRESET_NAME = 'Quick single-node';
const LEGACY_QUICK_FLOW_PRESET_NAME = 'Quick single-node (migrated from Legacy Single)';

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

async function createQuickSingleNodeFlowPreset(select, { legacyConversion = false } = {}) {
    const context = getContext();
    const settings = getSettings(context);
    if (!context || !settings) {
        notify('error', t('Could not read orchestration settings; conversion was not performed.'));
        return false;
    }
    if (legacyConversion
        && String(settings.executionMode || '') !== ORCH_EXECUTION_MODE_SINGLE
        && settings.singleAgentModeEnabled !== true) {
        return false;
    }

    let scope = getDisplayedScope(context, settings) === 'character' ? 'character' : 'global';
    let avatar = String(getCurrentAvatar(context) || '').trim();
    if (scope === 'character' && (!avatar || getCharacterIndexByAvatar(context, avatar) < 0)) {
        scope = 'global';
        avatar = '';
    }

    const presetName = legacyConversion ? LEGACY_QUICK_FLOW_PRESET_NAME : QUICK_FLOW_PRESET_NAME;
    let options = { context, avatar };
    let previousActiveId = getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
    let presetId = createPreset(
        settings,
        ORCH_EXECUTION_MODE_SPEC,
        scope,
        { name: t(presetName) },
        options,
    );

    // A card can be in a displayed character scope without owning a preset
    // container yet. Do not synthesize a new character extension envelope
    // from this UI helper; fall back to the existing global library instead.
    if (!presetId && scope === 'character') {
        scope = 'global';
        avatar = '';
        options = { context, avatar };
        previousActiveId = getActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, { scope, ...options });
        presetId = createPreset(
            settings,
            ORCH_EXECUTION_MODE_SPEC,
            scope,
            { name: t(presetName) },
            options,
        );
    }
    if (!presetId) {
        notify('error', t(legacyConversion
            ? 'Could not create the Flow quick single-node preset; Legacy Single was left unchanged.'
            : 'Could not create the Flow quick single-node preset.'));
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
        notify('error', t(legacyConversion
            ? 'Could not write the Flow quick single-node preset; Legacy Single was left unchanged.'
            : 'Could not write the Flow quick single-node preset.'));
        return false;
    }

    const persisted = await persistPresetScope(context, scope, avatar);
    if (!persisted) {
        deletePreset(settings, ORCH_EXECUTION_MODE_SPEC, scope, presetId, finalOptions);
        if (finalPreviousActiveId) {
            setActivePresetId(settings, ORCH_EXECUTION_MODE_SPEC, scope, finalPreviousActiveId, finalOptions);
        }
        notify('error', t(legacyConversion
            ? 'Could not save the Flow quick single-node preset; Legacy Single was left unchanged.'
            : 'Could not save the Flow quick single-node preset.'));
        return false;
    }

    // Reuse the native select's existing main.js handler as the one source of
    // truth for mode changes and workspace/preset refreshes. Dispatch even if
    // the value was already spec so the newly-active preset is rendered.
    select.value = ORCH_EXECUTION_MODE_SPEC;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    notify('success', t(legacyConversion
        ? 'Converted to a Flow quick single-node preset. Legacy Single prompts were kept for compatibility.'
        : 'Created a Flow quick single-node preset.'));
    return true;
}

async function convertLegacySingleToFlow(select) {
    return createQuickSingleNodeFlowPreset(select, { legacyConversion: true });
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
    button.querySelector('.luker-orch-mode-card-title').textContent = t(definition.title);
    button.querySelector('.luker-orch-mode-card-summary').textContent = t(definition.summary);
    button.querySelector('.luker-orch-mode-card-capability').textContent = t(definition.capabilityLabel);
    button.querySelector('.luker-orch-mode-card-output').textContent = t(definition.outputLabel);
    return button;
}

function syncModeUi(select, host) {
    const currentMode = String(select.value || ORCH_EXECUTION_MODE_SPEC);
    host.querySelectorAll('.luker-orch-mode-card').forEach((card) => {
        const active = card.dataset.mode === currentMode;
        card.classList.toggle('is-active', active);
        card.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    const quickFlowAction = host.querySelector('.luker-orch-mode-quick-flow');
    if (quickFlowAction) quickFlowAction.hidden = currentMode !== ORCH_EXECUTION_MODE_SPEC;

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
        <button type="button" class="menu_button luker-orch-mode-convert"></button>`;
    legacy.querySelector('strong').textContent = t(definition.title);
    legacy.querySelector('.luker-orch-mode-convert').textContent = t('Convert to Flow quick single-node');
    legacy.querySelector('.luker-orch-mode-legacy-copy span').textContent = t(definition.summary);
    legacy.querySelector('.luker-orch-mode-convert').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await convertLegacySingleToFlow(select);
        } catch (error) {
            console.error(`[${MODULE_NAME}] legacy Single conversion failed:`, error);
            notify('error', t('Conversion failed; Legacy Single was left unchanged.'));
        } finally {
            button.disabled = false;
        }
    });
    host.prepend(legacy);
}

function decorateModeSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.getAttribute(MODE_UI_ATTR) === '1') {
        const existingHost = select.nextElementSibling;
        if (existingHost?.classList?.contains('luker-orch-mode-picker')) {
            syncModeUi(select, existingHost);
        }
        return;
    }

    const host = document.createElement('div');
    host.className = 'luker-orch-mode-picker';
    host.setAttribute('role', 'radiogroup');
    host.setAttribute('aria-label', t('Execution mode'));

    const intro = document.createElement('div');
    intro.className = 'luker-orch-mode-picker-intro';
    intro.textContent = t('Choose who owns the workflow and who writes the final reply.');
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

    const actions = document.createElement('div');
    actions.className = 'luker-orch-mode-actions';
    const quickFlow = document.createElement('button');
    quickFlow.type = 'button';
    quickFlow.className = 'menu_button luker-orch-mode-quick-flow';
    quickFlow.textContent = t('Create Flow quick single-node preset');
    quickFlow.addEventListener('click', async () => {
        quickFlow.disabled = true;
        try {
            await createQuickSingleNodeFlowPreset(select);
        } catch (error) {
            console.error(`[${MODULE_NAME}] quick Flow preset creation failed:`, error);
            notify('error', t('Could not create the Flow quick single-node preset.'));
        } finally {
            quickFlow.disabled = false;
        }
    });
    actions.appendChild(quickFlow);
    host.appendChild(actions);

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
        .luker-orch-mode-actions { display: flex; justify-content: flex-start; gap: 8px; }
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
    registerExecutionModeLocaleData(getContext());
    ensureModePickerStyles();
    scanModePickers();

    const observer = new MutationObserver((mutations) => {
        let sawAddedNode = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                sawAddedNode = true;
                scanModePickers(node);
            }
        }
        if (sawAddedNode) scanModePickers(document);
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

export { buildQuickSingleNodeFlowPayload, convertLegacySingleToFlow, createQuickSingleNodeFlowPreset };
