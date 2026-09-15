import express from 'express';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-filename';
import { CHAT_BACKUPS_PREFIX, getChatInfo } from './chats.js';
import {
    getBackupDirectoryUsage,
    getBackupRetentionConfig,
    hasBackupRetentionOverride,
    pruneBackupDirectory,
    resetBackupRetentionConfig,
    saveBackupRetentionConfig,
    startBackupRetentionScheduler,
} from '../backup-retention.js';

export const router = express.Router();

if (process.env.NODE_ENV !== 'test') {
    startBackupRetentionScheduler();
}

router.post('/chat/get', async (request, response) => {
    try {
        // Keep the visible backup list consistent with the current user's
        // retention policy even if the periodic cleanup has not run yet.
        const policy = getBackupRetentionConfig(request.user.directories);
        pruneBackupDirectory(request.user.directories.backups, policy);

        const backupModels = [];
        const backupFiles = await fsPromises
            .readdir(request.user.directories.backups, { withFileTypes: true })
            .then(d => d.filter(d => d.isFile() && path.extname(d.name) === '.jsonl' && d.name.startsWith(CHAT_BACKUPS_PREFIX)).map(d => d.name));

        for (const name of backupFiles) {
            const filePath = path.join(request.user.directories.backups, name);
            const info = await getChatInfo(filePath);
            if (!info || !info.file_name) {
                continue;
            }
            backupModels.push(info);
        }

        return response.json(backupModels);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/retention/status', async (request, response) => {
    try {
        const policy = getBackupRetentionConfig(request.user.directories);
        const usage = getBackupDirectoryUsage(request.user.directories.backups);
        return response.json({
            policy,
            usage,
            source: hasBackupRetentionOverride(request.user.directories) ? 'user' : 'default',
        });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/retention/settings', async (request, response) => {
    try {
        const policy = saveBackupRetentionConfig(request.user.directories, request.body);
        const cleanup = pruneBackupDirectory(request.user.directories.backups, policy);
        const usage = { ...getBackupDirectoryUsage(request.user.directories.backups), deleted: cleanup.deleted };
        return response.json({ policy, usage, source: 'user' });
    } catch (error) {
        if (error instanceof TypeError) {
            return response.status(400).json({ error: error.message });
        }
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/retention/reset', async (request, response) => {
    try {
        const policy = resetBackupRetentionConfig(request.user.directories);
        const cleanup = pruneBackupDirectory(request.user.directories.backups, policy);
        const usage = { ...getBackupDirectoryUsage(request.user.directories.backups), deleted: cleanup.deleted };
        return response.json({ policy, usage, source: 'default' });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/retention/cleanup', async (request, response) => {
    try {
        const policy = getBackupRetentionConfig(request.user.directories);
        const cleanup = pruneBackupDirectory(request.user.directories.backups, policy);
        const usage = { ...getBackupDirectoryUsage(request.user.directories.backups), deleted: cleanup.deleted };
        return response.json({ policy, usage, source: hasBackupRetentionOverride(request.user.directories) ? 'user' : 'default' });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/delete', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to delete non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        await fsPromises.unlink(filePath);
        return response.sendStatus(200);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/chat/download', async (request, response) => {
    try {
        const { name } = request.body;
        const filePath = path.join(request.user.directories.backups, sanitize(name));

        if (!path.parse(filePath).base.startsWith(CHAT_BACKUPS_PREFIX)) {
            console.warn('Attempt to download non-chat backup file:', name);
            return response.sendStatus(400);
        }

        if (!fs.existsSync(filePath)) {
            return response.sendStatus(404);
        }

        return response.download(filePath);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});
