import {
    ORCH_EXECUTION_MODE_SPEC,
} from './defaults.js';
import {
    ORCH_EXECUTION_OUTPUT_TAKEOVER,
    getOrchExecutionModeDefinition,
} from './execution-mode-registry.js';
import { i18n } from './i18n.js';

const MODULE_NAME = 'orchestrator';
const MODE_SELECT_ID = 'luker_orch_execution_mode';
const MODE_CHIP_SELECTOR = '.luker-studio-editor-topbar-meta .luker-studio-editor-chip';
const CAPSULE_BLOCK_SELECTOR = '[data-orch-mode-block="capsule"]';

function getContext() {
    try {
        return globalThis.Luker?.getContext?.() || null;
    } catch (_) {
        return null;
    }
}

export function getExecutionModeProductDefinition(mode) {
    return getOrchExecutionModeDefinition(mode || ORCH_EXECUTION_MODE_SPEC);
}

export function executionModeOwnsFinalReply(mode) {
    return getExecutionModeProductDefinition(mode).output === ORCH_EXECUTION_OUTPUT_TAKEOVER;
}

function resolveExecutionMode(root = document) {
    const select = root?.getElementById?.(MODE_SELECT_ID)
        || root?.querySelector?.(`#${MODE_SELECT_ID}`)
        || document?.getElementById?.(MODE_SELECT_ID);
    if (select?.value) return String(select.value);

    const context = getContext();
    return String(
        context?.extensionSettings?.[MODULE_NAME]?.executionMode
        || ORCH_EXECUTION_MODE_SPEC,
    );
}

function syncCapsuleVisibility(root, mode) {
    const shouldHide = executionModeOwnsFinalReply(mode);
    const blocks = root?.querySelectorAll?.(CAPSULE_BLOCK_SELECTOR) || [];
    for (const block of blocks) {
        // main.js still owns the broader per-mode workspace visibility path.
        // This narrow product-level override intentionally runs after render
        // so capsule ownership follows the registry rather than another
        // duplicated `mode === director` product rule.
        block.hidden = shouldHide;
        if (typeof globalThis.jQuery === 'function') {
            globalThis.jQuery(block).toggle(!shouldHide);
        } else if (block?.style) {
            block.style.display = shouldHide ? 'none' : '';
        }
    }
}

function syncModeChip(root, mode) {
    const title = i18n(getExecutionModeProductDefinition(mode).title);
    const executionModeLabel = String(i18n('Execution mode') || 'Execution mode').trim();
    const chips = root?.querySelectorAll?.(MODE_CHIP_SELECTOR) || [];
    for (const chip of chips) {
        const bold = chip.querySelector?.('b');
        if (!bold) continue;
        const text = String(chip.textContent || '').trim();
        if (!text.includes(executionModeLabel)) continue;
        bold.textContent = title;
    }
}

/**
 * Reconcile user-facing execution-mode metadata after main.js has rendered.
 *
 * Runtime dispatch stays in the mature per-mode runtimes. This module only
 * owns duplicated product metadata that should follow the central registry:
 * who owns the final reply (capsule visibility) and the public mode title in
 * the orchestration-editor topbar.
 */
export function syncExecutionModeProductUi(root = document, explicitMode = '') {
    if (typeof document === 'undefined') return;
    const mode = String(explicitMode || resolveExecutionMode(root));
    syncCapsuleVisibility(root, mode);
    syncModeChip(root, mode);
}

function deferSync(root = document) {
    const run = () => syncExecutionModeProductUi(root);
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(run);
    } else {
        Promise.resolve().then(run);
    }
}

function bindModeSelect(root = document) {
    const select = root?.getElementById?.(MODE_SELECT_ID)
        || root?.querySelector?.(`#${MODE_SELECT_ID}`);
    if (!select || select.dataset.lukerOrchProductSync === '1') return;
    select.dataset.lukerOrchProductSync = '1';
    select.addEventListener('change', () => deferSync(document));
}

function initExecutionModeProductSync() {
    bindModeSelect(document);
    syncExecutionModeProductUi(document);

    if (typeof MutationObserver !== 'function' || !document.body) return;
    const observer = new MutationObserver((mutations) => {
        let shouldSync = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes?.length) {
                shouldSync = true;
                break;
            }
        }
        if (!shouldSync) return;
        bindModeSelect(document);
        deferSync(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExecutionModeProductSync, { once: true });
    } else {
        initExecutionModeProductSync();
    }
}
