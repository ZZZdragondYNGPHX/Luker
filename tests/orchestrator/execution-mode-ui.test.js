/** @jest-environment jsdom */

import { describe, expect, jest, test } from '@jest/globals';
import {
    ORCH_EXECUTION_MODE_AGENDA,
    ORCH_EXECUTION_MODE_DIRECTOR,
    ORCH_EXECUTION_MODE_LOOP,
    ORCH_EXECUTION_MODE_SINGLE,
    ORCH_EXECUTION_MODE_SPEC,
} from '../../public/scripts/extensions/orchestrator/defaults.js';

function renderLegacySelect(selected = ORCH_EXECUTION_MODE_SPEC) {
    document.body.innerHTML = `
        <div id="orchestrator_settings">
            <label for="luker_orch_execution_mode">Execution mode</label>
            <select id="luker_orch_execution_mode">
                <option value="${ORCH_EXECUTION_MODE_SPEC}">Spec</option>
                <option value="${ORCH_EXECUTION_MODE_SINGLE}">Single</option>
                <option value="${ORCH_EXECUTION_MODE_AGENDA}">Agenda</option>
                <option value="${ORCH_EXECUTION_MODE_LOOP}">Loop</option>
                <option value="${ORCH_EXECUTION_MODE_DIRECTOR}">Director</option>
            </select>
        </div>`;
    const select = document.getElementById('luker_orch_execution_mode');
    select.value = selected;
    return select;
}

async function loadUi() {
    await import('../../public/scripts/extensions/orchestrator/execution-mode-ui.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await Promise.resolve();
}

describe('execution mode picker UI', () => {
    test('presents four first-class modes, Legacy Single compatibility, and native change routing', async () => {
        const select = renderLegacySelect(ORCH_EXECUTION_MODE_SPEC);
        const onChange = jest.fn();
        select.addEventListener('change', onChange);
        await loadUi();

        const cards = [...document.querySelectorAll('.luker-orch-mode-card')];
        expect(cards.map(card => card.dataset.mode)).toEqual([
            ORCH_EXECUTION_MODE_SPEC,
            ORCH_EXECUTION_MODE_AGENDA,
            ORCH_EXECUTION_MODE_LOOP,
            ORCH_EXECUTION_MODE_DIRECTOR,
        ]);
        expect(cards.some(card => card.dataset.mode === ORCH_EXECUTION_MODE_SINGLE)).toBe(false);
        expect(select.hidden).toBe(true);
        expect(select.getAttribute('aria-hidden')).toBe('true');
        expect(document.querySelector('.luker-orch-mode-legacy')).toBeNull();
        expect(document.querySelector('.luker-orch-mode-quick-flow').hidden).toBe(false);

        // Existing Legacy Single remains runnable/readable but is represented
        // as a compatibility panel, never as a fifth first-class card.
        select.value = ORCH_EXECUTION_MODE_SINGLE;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(document.querySelectorAll('.luker-orch-mode-card')).toHaveLength(4);
        expect(document.querySelector('.luker-orch-mode-legacy')).not.toBeNull();
        expect(document.querySelector('.luker-orch-mode-convert')).not.toBeNull();
        expect(document.querySelector('.luker-orch-mode-quick-flow').hidden).toBe(true);

        // Mode-card clicks deliberately reuse main.js' existing select change
        // chain instead of owning a second execution-mode state machine.
        onChange.mockClear();
        const planner = document.querySelector(`.luker-orch-mode-card[data-mode="${ORCH_EXECUTION_MODE_AGENDA}"]`);
        planner.click();
        expect(select.value).toBe(ORCH_EXECUTION_MODE_AGENDA);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(planner.classList.contains('is-active')).toBe(true);
        expect(planner.getAttribute('aria-checked')).toBe('true');
        expect(document.querySelector('.luker-orch-mode-legacy')).toBeNull();
        expect(document.querySelector(`.luker-orch-mode-card[data-mode="${ORCH_EXECUTION_MODE_SPEC}"]`).getAttribute('aria-checked')).toBe('false');
    });
});
