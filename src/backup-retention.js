import fs from 'node:fs';
import path from 'node:path';

import { getConfigValue } from './util.js';
import { getAllUserHandles, getUserDirectories } from './users.js';

const DEFAULT_MAX_PER_ENTITY = 20;
const DEFAULT_MAX_TOTAL_BACKUPS = 500;
const DEFAULT_MAX_TOTAL_SIZE_BYTES = 1024 * 1024 * 1024;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const MIN_CLEANUP_INTERVAL_MS = 10_000;
const BACKUP_TIMESTAMP_MARKER = /_\d{4}-\d{2}-\d{2}@/;
const BACKUP_RETENTION_SETTINGS_FILE = 'backup-retention.json';
const PERSISTED_POLICY_KEYS = Object.freeze([
    'enabled',
    'maxPerEntity',
    'maxTotalBackups',
    'maxTotalSizeBytes',
]);

let schedulerStarted = false;

function normalizeLimit(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizePersistedLimit(value, key) {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < -1) {
        throw new TypeError(`${key} must be an integer greater than or equal to -1.`);
    }
    return numeric;
}

function isUnlimited(limit) {
    return limit < 0;
}

function getRetentionSettingsPath(userDirectories) {
    return userDirectories?.root
        ? path.join(userDirectories.root, BACKUP_RETENTION_SETTINGS_FILE)
        : null;
}

/**
 * Returns the server-level defaults for backup retention.
 * A value of -1 disables the corresponding limit.
 *
 * @returns {{ enabled: boolean, maxPerEntity: number, maxTotalBackups: number, maxTotalSizeBytes: number, cleanupIntervalMs: number }}
 */
export function getDefaultBackupRetentionConfig() {
    return {
        enabled: !!getConfigValue('backups.retention.enabled', true, 'boolean'),
        maxPerEntity: normalizeLimit(
            getConfigValue('backups.retention.maxPerEntity', DEFAULT_MAX_PER_ENTITY, 'number'),
            DEFAULT_MAX_PER_ENTITY,
        ),
        maxTotalBackups: normalizeLimit(
            getConfigValue('backups.retention.maxTotalBackups', DEFAULT_MAX_TOTAL_BACKUPS, 'number'),
            DEFAULT_MAX_TOTAL_BACKUPS,
        ),
        maxTotalSizeBytes: normalizeLimit(
            getConfigValue('backups.retention.maxTotalSizeBytes', DEFAULT_MAX_TOTAL_SIZE_BYTES, 'number'),
            DEFAULT_MAX_TOTAL_SIZE_BYTES,
        ),
        cleanupIntervalMs: Math.max(
            MIN_CLEANUP_INTERVAL_MS,
            normalizeLimit(
                getConfigValue('backups.retention.cleanupIntervalMs', DEFAULT_CLEANUP_INTERVAL_MS, 'number'),
                DEFAULT_CLEANUP_INTERVAL_MS,
            ),
        ),
    };
}

/**
 * Returns the effective policy for one user. A per-user JSON override is
 * merged onto the server defaults so older installations need no migration.
 *
 * @param {object} [userDirectories] Per-user directory map
 * @returns {{ enabled: boolean, maxPerEntity: number, maxTotalBackups: number, maxTotalSizeBytes: number, cleanupIntervalMs: number }}
 */
export function getBackupRetentionConfig(userDirectories = undefined) {
    const defaults = getDefaultBackupRetentionConfig();
    const settingsPath = getRetentionSettingsPath(userDirectories);
    if (!settingsPath || !fs.existsSync(settingsPath)) {
        return defaults;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return defaults;
        }

        const policy = { ...defaults };
        if (typeof parsed.enabled === 'boolean') {
            policy.enabled = parsed.enabled;
        }
        for (const key of ['maxPerEntity', 'maxTotalBackups', 'maxTotalSizeBytes']) {
            if (Object.hasOwn(parsed, key)) {
                const value = Number(parsed[key]);
                if (Number.isSafeInteger(value) && value >= -1) {
                    policy[key] = value;
                }
            }
        }
        return policy;
    } catch (error) {
        console.warn(`Could not read backup retention settings from ${settingsPath}:`, error?.message || error);
        return defaults;
    }
}

/**
 * Whether the current user has explicitly saved an override policy.
 *
 * @param {object} userDirectories Per-user directory map
 * @returns {boolean}
 */
export function hasBackupRetentionOverride(userDirectories) {
    const settingsPath = getRetentionSettingsPath(userDirectories);
    return Boolean(settingsPath && fs.existsSync(settingsPath));
}

/**
 * Validates and persists a per-user retention policy.
 *
 * @param {object} userDirectories Per-user directory map
 * @param {object} input Policy payload
 * @returns {{ enabled: boolean, maxPerEntity: number, maxTotalBackups: number, maxTotalSizeBytes: number, cleanupIntervalMs: number }}
 */
export function saveBackupRetentionConfig(userDirectories, input) {
    if (!userDirectories?.root) {
        throw new TypeError('User root directory is required.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('Backup retention settings must be an object.');
    }
    if (typeof input.enabled !== 'boolean') {
        throw new TypeError('enabled must be a boolean.');
    }

    const persisted = {
        enabled: input.enabled,
        maxPerEntity: normalizePersistedLimit(input.maxPerEntity, 'maxPerEntity'),
        maxTotalBackups: normalizePersistedLimit(input.maxTotalBackups, 'maxTotalBackups'),
        maxTotalSizeBytes: normalizePersistedLimit(input.maxTotalSizeBytes, 'maxTotalSizeBytes'),
    };

    fs.mkdirSync(userDirectories.root, { recursive: true });
    const settingsPath = getRetentionSettingsPath(userDirectories);
    const tempPath = `${settingsPath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(persisted, null, 4)}\n`, 'utf8');
    fs.renameSync(tempPath, settingsPath);

    return getBackupRetentionConfig(userDirectories);
}

/**
 * Removes a user's override and returns the server defaults.
 *
 * @param {object} userDirectories Per-user directory map
 * @returns {{ enabled: boolean, maxPerEntity: number, maxTotalBackups: number, maxTotalSizeBytes: number, cleanupIntervalMs: number }}
 */
export function resetBackupRetentionConfig(userDirectories) {
    const settingsPath = getRetentionSettingsPath(userDirectories);
    if (settingsPath) {
        fs.rmSync(settingsPath, { force: true });
        fs.rmSync(`${settingsPath}.tmp`, { force: true });
    }
    return getBackupRetentionConfig(userDirectories);
}

/**
 * Maps a Luker backup filename to the logical entity it belongs to.
 * Both chat backups and settings snapshots end with `_YYYY-MM-DD@...`.
 * Unknown files are deliberately ignored by the retention manager.
 *
 * @param {string} fileName Backup filename
 * @returns {string|null} Logical entity key, or null when this is not a managed backup
 */
export function getBackupEntityKey(fileName) {
    const extension = path.extname(fileName).toLowerCase();
    const isManagedType = extension === '.json' || extension === '.jsonl';
    const isManagedPrefix = fileName.startsWith('chat_') || fileName.startsWith('settings_');
    if (!isManagedType || !isManagedPrefix) {
        return null;
    }

    const stem = fileName.slice(0, -extension.length);
    const match = BACKUP_TIMESTAMP_MARKER.exec(stem);
    if (!match || match.index <= 0) {
        return null;
    }

    return stem.slice(0, match.index);
}

function listBackupRecords(directory) {
    if (!directory || !fs.existsSync(directory)) {
        return [];
    }

    const records = [];
    for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!dirent.isFile()) {
            continue;
        }

        const entityKey = getBackupEntityKey(dirent.name);
        if (!entityKey) {
            continue;
        }

        const filePath = path.join(directory, dirent.name);
        try {
            const stat = fs.statSync(filePath);
            records.push({
                name: dirent.name,
                path: filePath,
                entityKey,
                modifiedMs: stat.mtimeMs,
                size: stat.size,
            });
        } catch (error) {
            console.warn(`Could not inspect backup file ${filePath}:`, error?.message || error);
        }
    }

    return records;
}

/**
 * Returns non-destructive usage statistics for the managed backup files.
 *
 * @param {string} directory Backup directory
 * @returns {{ scanned: number, remaining: number, remainingBytes: number, chatBackups: number, settingsBackups: number }}
 */
export function getBackupDirectoryUsage(directory) {
    const records = listBackupRecords(directory);
    return {
        scanned: records.length,
        remaining: records.length,
        remainingBytes: records.reduce((sum, record) => sum + record.size, 0),
        chatBackups: records.filter(record => record.name.startsWith('chat_')).length,
        settingsBackups: records.filter(record => record.name.startsWith('settings_')).length,
    };
}

/**
 * Prunes a single backup directory using the same three-tier policy as
 * TauriTavern: per-entity count, global count, then global byte budget.
 * Oldest backups are removed first and unrelated files are never touched.
 *
 * @param {string} directory Backup directory
 * @param {{ enabled?: boolean, maxPerEntity?: number, maxTotalBackups?: number, maxTotalSizeBytes?: number }} [policy]
 * @returns {{ scanned: number, deleted: number, remaining: number, remainingBytes: number, deletedFiles: string[] }}
 */
export function pruneBackupDirectory(directory, policy = undefined) {
    const effectivePolicy = policy ?? getBackupRetentionConfig();
    const enabled = effectivePolicy.enabled ?? true;
    const records = listBackupRecords(directory);

    if (!enabled || records.length === 0) {
        return {
            scanned: records.length,
            deleted: 0,
            remaining: records.length,
            remainingBytes: records.reduce((sum, record) => sum + record.size, 0),
            deletedFiles: [],
        };
    }

    const maxPerEntity = normalizeLimit(effectivePolicy.maxPerEntity, DEFAULT_MAX_PER_ENTITY);
    const maxTotalBackups = normalizeLimit(effectivePolicy.maxTotalBackups, DEFAULT_MAX_TOTAL_BACKUPS);
    const maxTotalSizeBytes = normalizeLimit(effectivePolicy.maxTotalSizeBytes, DEFAULT_MAX_TOTAL_SIZE_BYTES);

    const deletionSet = new Set();

    if (!isUnlimited(maxPerEntity)) {
        const grouped = new Map();
        for (const record of records) {
            const group = grouped.get(record.entityKey) ?? [];
            group.push(record);
            grouped.set(record.entityKey, group);
        }

        for (const group of grouped.values()) {
            group.sort((a, b) => b.modifiedMs - a.modifiedMs || b.name.localeCompare(a.name));
            for (const record of group.slice(Math.max(0, maxPerEntity))) {
                deletionSet.add(record.path);
            }
        }
    }

    let remaining = records.filter(record => !deletionSet.has(record.path));
    remaining.sort((a, b) => a.modifiedMs - b.modifiedMs || a.name.localeCompare(b.name));

    let remainingBytes = remaining.reduce((sum, record) => sum + record.size, 0);
    while (
        remaining.length > 0
        && (
            (!isUnlimited(maxTotalBackups) && remaining.length > maxTotalBackups)
            || (!isUnlimited(maxTotalSizeBytes) && remainingBytes > maxTotalSizeBytes)
        )
    ) {
        const oldest = remaining.shift();
        deletionSet.add(oldest.path);
        remainingBytes -= oldest.size;
    }

    const deletedFiles = [];
    for (const filePath of deletionSet) {
        try {
            fs.unlinkSync(filePath);
            deletedFiles.push(path.basename(filePath));
        } catch (error) {
            console.warn(`Could not delete old backup ${filePath}:`, error?.message || error);
        }
    }

    if (deletedFiles.length > 0) {
        const survivingRecords = listBackupRecords(directory);
        remainingBytes = survivingRecords.reduce((sum, record) => sum + record.size, 0);
        return {
            scanned: records.length,
            deleted: deletedFiles.length,
            remaining: survivingRecords.length,
            remainingBytes,
            deletedFiles,
        };
    }

    return {
        scanned: records.length,
        deleted: 0,
        remaining: records.length,
        remainingBytes: records.reduce((sum, record) => sum + record.size, 0),
        deletedFiles,
    };
}

/**
 * Applies retention to every user's backup directory.
 *
 * @returns {Promise<void>}
 */
export async function pruneAllUserBackups() {
    const handles = await getAllUserHandles();
    for (const handle of handles) {
        try {
            const directories = getUserDirectories(handle);
            const policy = getBackupRetentionConfig(directories);
            if (!policy.enabled) {
                continue;
            }
            const result = pruneBackupDirectory(directories.backups, policy);
            if (result.deleted > 0) {
                console.info(`[Backup retention] ${handle}: removed ${result.deleted} old backup(s); ${result.remaining} remain.`);
            }
        } catch (error) {
            console.warn(`[Backup retention] Failed for ${handle}:`, error?.message || error);
        }
    }
}

/**
 * Starts a lightweight periodic cleanup loop. Timers are unref'd so they do
 * not keep Node alive during shutdown or tests.
 */
export function startBackupRetentionScheduler() {
    if (schedulerStarted) {
        return;
    }
    schedulerStarted = true;

    const policy = getDefaultBackupRetentionConfig();
    const runCleanup = () => {
        void pruneAllUserBackups().catch((error) => {
            console.warn('[Backup retention] Cleanup failed:', error?.message || error);
        });
    };

    const initialTimer = setTimeout(runCleanup, 5_000);
    initialTimer.unref?.();

    const intervalTimer = setInterval(runCleanup, policy.cleanupIntervalMs);
    intervalTimer.unref?.();
}

export const backupRetentionPolicyKeys = PERSISTED_POLICY_KEYS;
