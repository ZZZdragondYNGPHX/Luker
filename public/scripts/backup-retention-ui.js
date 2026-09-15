import { getRequestHeaders } from '../script.js';

const STORAGE_UNITS = Object.freeze({
    MiB: 1024 * 1024,
    GiB: 1024 * 1024 * 1024,
});
const MANAGER_WAIT_INTERVAL_MS = 50;
const MANAGER_WAIT_ATTEMPTS = 100;

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '无限制';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let amount = bytes;
    let unitIndex = -1;
    do {
        amount /= 1024;
        unitIndex += 1;
    } while (amount >= 1024 && unitIndex < units.length - 1);
    return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`;
}

function createRetentionSection() {
    const section = document.createElement('section');
    section.className = 'backupRetentionSection marginBot10';
    section.innerHTML = `
        <hr class="sysHR marginTopBot10">
        <h4 class="marginBot5 flex-container alignItemsCenter flexGap5">
            <i class="fa-fw fa-solid fa-clock-rotate-left"></i>
            <span>聊天备份保留</span>
        </h4>
        <div class="menu_button_note marginBot10">
            限制自动生成的聊天备份和设置快照，避免 <code>backups</code> 目录持续膨胀。只管理 <code>chat_*.jsonl</code> 和 <code>settings_*.json</code>。
        </div>
        <label class="checkbox_label marginBot10">
            <input class="backupRetentionEnabled" type="checkbox">
            <span>自动清理旧备份</span>
        </label>
        <div class="flex-container flexFlowColumn flexGap10 marginBot10">
            <label class="flex-container flexFlowColumn flexGap5">
                <span>每个角色、群聊或设置项的备份数上限</span>
                <input class="text_pole backupRetentionMaxPerEntity" type="number" min="-1" step="1" inputmode="numeric">
            </label>
            <label class="flex-container flexFlowColumn flexGap5">
                <span>备份文件总数上限</span>
                <input class="text_pole backupRetentionMaxTotalBackups" type="number" min="-1" step="1" inputmode="numeric">
            </label>
            <label class="flex-container flexFlowColumn flexGap5">
                <span>备份存储空间上限</span>
                <div class="flex-container flexGap5">
                    <input class="text_pole backupRetentionMaxSize flex1" type="number" min="-1" step="0.1" inputmode="decimal">
                    <select class="text_pole backupRetentionSizeUnit">
                        <option value="MiB">MiB</option>
                        <option value="GiB">GiB</option>
                    </select>
                </div>
            </label>
        </div>
        <div class="menu_button_note marginBot10">
            填写 <b>-1</b> 表示该项无限制；填写 <b>0</b> 会删除对应范围内的全部受管备份。超过任一限制时优先删除最旧的备份。
        </div>
        <div class="backupRetentionUsage menu_button_note marginBot10">正在读取备份占用情况…</div>
        <div class="backupRetentionActions flex-container flexGap10 flexWrap">
            <button type="button" class="menu_button menu_button_icon backupRetentionSaveButton">
                <i class="fa-fw fa-solid fa-floppy-disk"></i><span>保存并应用</span>
            </button>
            <button type="button" class="menu_button menu_button_icon backupRetentionCleanupButton">
                <i class="fa-fw fa-solid fa-broom"></i><span>立即清理</span>
            </button>
            <button type="button" class="menu_button menu_button_icon backupRetentionResetButton">
                <i class="fa-fw fa-solid fa-rotate-left"></i><span>恢复默认</span>
            </button>
        </div>
    `;
    return section;
}

async function postJson(path, body = {}) {
    const response = await fetch(path, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data;
}

function setBusy(section, busy) {
    section.querySelectorAll('button, input, select').forEach((element) => {
        element.disabled = Boolean(busy);
    });
}

function renderUsage(section, payload) {
    const usage = payload?.usage || {};
    const policySource = payload?.source === 'user' ? '用户自定义' : '服务器默认';
    const deleted = Number(usage.deleted || 0);
    const suffix = deleted > 0 ? `；本次已删除 ${deleted} 个旧备份` : '';
    section.querySelector('.backupRetentionUsage').textContent =
        `当前：${Number(usage.remaining || 0)} 个受管备份（聊天 ${Number(usage.chatBackups || 0)} / 设置 ${Number(usage.settingsBackups || 0)}），` +
        `占用 ${formatBytes(Number(usage.remainingBytes || 0))}；策略来源：${policySource}${suffix}`;
}

function applyPolicyToForm(section, payload) {
    const policy = payload?.policy || {};
    section.querySelector('.backupRetentionEnabled').checked = Boolean(policy.enabled);
    section.querySelector('.backupRetentionMaxPerEntity').value = String(policy.maxPerEntity ?? 20);
    section.querySelector('.backupRetentionMaxTotalBackups').value = String(policy.maxTotalBackups ?? 500);

    const bytes = Number(policy.maxTotalSizeBytes ?? STORAGE_UNITS.GiB);
    const unit = bytes > 0 && bytes < STORAGE_UNITS.GiB ? 'MiB' : 'GiB';
    section.querySelector('.backupRetentionSizeUnit').value = unit;
    section.querySelector('.backupRetentionMaxSize').value = bytes < 0
        ? '-1'
        : String(bytes / STORAGE_UNITS[unit]);

    section.querySelector('.backupRetentionCleanupButton').disabled = !policy.enabled;
    renderUsage(section, payload);
}

function readIntegerInput(section, selector, label) {
    const raw = section.querySelector(selector).value.trim();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < -1) {
        throw new Error(`${label}必须是大于等于 -1 的整数。`);
    }
    return value;
}

function readPolicyFromForm(section) {
    const sizeRaw = section.querySelector('.backupRetentionMaxSize').value.trim();
    const sizeValue = Number(sizeRaw);
    if (!Number.isFinite(sizeValue) || sizeValue < -1) {
        throw new Error('备份存储空间上限必须是大于等于 -1 的数字。');
    }
    const unit = section.querySelector('.backupRetentionSizeUnit').value;
    if (!Object.hasOwn(STORAGE_UNITS, unit)) {
        throw new Error('无效的存储空间单位。');
    }
    const maxTotalSizeBytes = sizeValue < 0 ? -1 : Math.round(sizeValue * STORAGE_UNITS[unit]);
    if (!Number.isSafeInteger(maxTotalSizeBytes)) {
        throw new Error('备份存储空间上限过大。');
    }

    return {
        enabled: section.querySelector('.backupRetentionEnabled').checked,
        maxPerEntity: readIntegerInput(section, '.backupRetentionMaxPerEntity', '每个角色或群聊的备份数上限'),
        maxTotalBackups: readIntegerInput(section, '.backupRetentionMaxTotalBackups', '备份文件总数上限'),
        maxTotalSizeBytes,
    };
}

async function refresh(section) {
    setBusy(section, true);
    try {
        const payload = await postJson('/api/backups/retention/status');
        applyPolicyToForm(section, payload);
    } catch (error) {
        console.error('Failed to load backup retention settings:', error);
        section.querySelector('.backupRetentionUsage').textContent = `读取备份保留设置失败：${error.message}`;
    } finally {
        setBusy(section, false);
        const enabled = section.querySelector('.backupRetentionEnabled').checked;
        section.querySelector('.backupRetentionCleanupButton').disabled = !enabled;
    }
}

async function save(section) {
    let policy;
    try {
        policy = readPolicyFromForm(section);
    } catch (error) {
        toastr.warning(error.message);
        return;
    }

    setBusy(section, true);
    try {
        const payload = await postJson('/api/backups/retention/settings', policy);
        applyPolicyToForm(section, payload);
        toastr.success('备份保留设置已保存并应用。');
    } catch (error) {
        console.error('Failed to save backup retention settings:', error);
        toastr.error(`保存备份保留设置失败：${error.message}`);
    } finally {
        setBusy(section, false);
        section.querySelector('.backupRetentionCleanupButton').disabled = !section.querySelector('.backupRetentionEnabled').checked;
    }
}

async function cleanup(section) {
    setBusy(section, true);
    try {
        const payload = await postJson('/api/backups/retention/cleanup');
        applyPolicyToForm(section, payload);
        const deleted = Number(payload?.usage?.deleted || 0);
        toastr.success(deleted > 0 ? `已清理 ${deleted} 个旧备份。` : '当前备份已符合保留规则。');
    } catch (error) {
        console.error('Failed to prune backups:', error);
        toastr.error(`清理备份失败：${error.message}`);
    } finally {
        setBusy(section, false);
        section.querySelector('.backupRetentionCleanupButton').disabled = !section.querySelector('.backupRetentionEnabled').checked;
    }
}

async function reset(section) {
    setBusy(section, true);
    try {
        const payload = await postJson('/api/backups/retention/reset');
        applyPolicyToForm(section, payload);
        toastr.success('已恢复服务器默认的备份保留设置。');
    } catch (error) {
        console.error('Failed to reset backup retention settings:', error);
        toastr.error(`恢复默认设置失败：${error.message}`);
    } finally {
        setBusy(section, false);
        section.querySelector('.backupRetentionCleanupButton').disabled = !section.querySelector('.backupRetentionEnabled').checked;
    }
}

function initializeManager(manager) {
    if (!(manager instanceof HTMLElement) || manager.dataset.backupRetentionReady === 'true') {
        return;
    }
    manager.dataset.backupRetentionReady = 'true';

    const section = createRetentionSection();
    const heading = manager.querySelector('h3');
    if (heading?.parentNode) {
        heading.insertAdjacentElement('afterend', section);
    } else {
        manager.prepend(section);
    }

    section.querySelector('.backupRetentionSaveButton').addEventListener('click', () => void save(section));
    section.querySelector('.backupRetentionCleanupButton').addEventListener('click', () => void cleanup(section));
    section.querySelector('.backupRetentionResetButton').addEventListener('click', () => void reset(section));
    section.querySelector('.backupRetentionEnabled').addEventListener('change', (event) => {
        section.querySelector('.backupRetentionCleanupButton').disabled = !event.currentTarget.checked;
    });

    void refresh(section);
}

function initializeVisibleManagers() {
    document.querySelectorAll('.userBackupManager').forEach(initializeManager);
}

let managerWaitGeneration = 0;
function waitForManager(generation, attempt = 0) {
    if (generation !== managerWaitGeneration) {
        return;
    }

    const managers = document.querySelectorAll('.userBackupManager');
    if (managers.length > 0) {
        managers.forEach(initializeManager);
        return;
    }

    if (attempt >= MANAGER_WAIT_ATTEMPTS) {
        return;
    }

    setTimeout(() => waitForManager(generation, attempt + 1), MANAGER_WAIT_INTERVAL_MS);
}

document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.userBackupButton')) {
        return;
    }

    managerWaitGeneration += 1;
    waitForManager(managerWaitGeneration);
});

initializeVisibleManagers();
