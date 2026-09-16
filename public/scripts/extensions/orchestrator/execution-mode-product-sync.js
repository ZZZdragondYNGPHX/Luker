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
const PRODUCT_SURFACE_SELECTOR = `#${MODE_SELECT_ID}, ${MODE_CHIP_SELECTOR}, ${CAPSULE_BLOCK_SELECTOR}`;

function getContext() {
    try {
        return globalThis.Luker?.getContext?.() || null;
    } catch (_) {
        return null;
    }
}

function getDocument() {
    return typeof document !== 'undefined' ? document : null;
}

export function getExecutionModeProductDefinition(mode) {
    return getOrchExecutionModeDefinition(mode || ORCH_EXECUTION_MODE_SPEC);
}

export function executionModeOwnsFinalReply(mode) {
    return getExecutionModeProductDefinition(mode).output === ORCH_EXECUTION_OUTPUT_TAKEOVER;
}

function resolveExecutionMode(root = getDocument()) {
    const doc = getDocument();
    const select = root?.getElementById?.(MODE_SELECT_ID)
        || root?.querySelector?.(`#${MODE_SELECT_ID}`)
        || doc?.getElementById?.(MODE_SELECT_ID);
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
export function syncExecutionModeProductUi(root = getDocument(), explicitMode = '') {
    const doc = getDocument();
    if (!doc || !root) return;
    const mode = String(explicitMode || resolveExecutionMode(root));
    syncCapsuleVisibility(root, mode);
    syncModeChip(root, mode);
}

function deferSync(root = getDocument()) {
    if (!root) return;
    const run = () => syncExecutionModeProductUi(root);
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(run);
    } else {
        Promise.resolve().then(run);
    }
}

function bindModeSelect(root = getDocument()) {
    const select = root?.getElementById?.(MODE_SELECT_ID)
        || root?.querySelector?.(`#${MODE_SELECT_ID}`);
    if (!select || select.dataset.lukerOrchProductSync === '1') return;
    select.dataset.lukerOrchProductSync = '1';
    select.addEventListener('change', () => deferSync(getDocument()));
}

function isProductUiMutationNode(node) {
    if (!node || typeof node !== 'object') return false;
    if (node.id === MODE_SELECT_ID) return true;
    if (node.matches?.(MODE_CHIP_SELECTOR) || node.matches?.(CAPSULE_BLOCK_SELECTOR)) return true;
    if (node.closest?.(MODE_CHIP_SELECTOR) || node.closest?.(CAPSULE_BLOCK_SELECTOR)) return true;
    return Boolean(node.querySelector?.(PRODUCT_SURFACE_SELECTOR));
}

function initExecutionModeProductSync() {
    const doc = getDocument();
    if (!doc) return;
    bindModeSelect(doc);
    syncExecutionModeProductUi(doc);

    if (typeof MutationObserver !== 'function' || !doc.body) return;
    const observer = new MutationObserver((mutations) => {
        let shouldSync = false;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes || []) {
                if (!isProductUiMutationNode(node)) continue;
                shouldSync = true;
                break;
            }
            if (shouldSync) break;
        }
        if (!shouldSync) return;
        bindModeSelect(doc);
        deferSync(doc);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initExecutionModeProductSync, { once: true });
    } else {
        initExecutionModeProductSync();
    }
}
