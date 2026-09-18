import { describe, expect, test } from '@jest/globals';
import { collectExtractTransaction, EXTRACT_DONE, validateExtractTransaction } from '../../public/scripts/extensions/memory-graph/extract-transaction.js';
import { factExtractionContext, factExtractionTool, FACT_TOOL_NAME } from '../../public/scripts/extensions/memory-graph/fact-extraction.js';

const EVENT_TOOL = {
    type: 'function',
    function: {
        name: 'luker_rpg_extract_event_create',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['summary', 'links'],
            properties: {
                summary: { type: 'string' },
                links: { type: 'array', items: { type: 'object' } },
                ref: { type: 'string' },
                no_link_reason: { type: 'string' },
            },
        },
    },
};

const CHARACTER_TOOL = {
    type: 'function',
    function: {
        name: 'luker_rpg_extract_character_sheet_create',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: {
                title: { type: 'string' },
                ref: { type: 'string' },
                links: { type: 'array', items: { type: 'object' } },
            },
        },
    },
};

const LOCATION_TOOL = {
    type: 'function',
    function: {
        name: 'luker_rpg_extract_location_state_create',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['title'],
            properties: {
                title: { type: 'string' },
                aliases: { type: 'string' },
                ref: { type: 'string' },
                links: { type: 'array', items: { type: 'object' } },
            },
        },
    },
};

const THREAD_TOOL = {
    type: 'function',
    function: {
        name: 'luker_rpg_extract_thread_create',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'status', 'note'],
            properties: {
                title: { type: 'string' },
                status: { type: 'string' },
                note: { type: 'string' },
                ref: { type: 'string' },
                links: { type: 'array', items: { type: 'object' } },
            },
        },
    },
};

const DONE_TOOL = {
    type: 'function',
    function: {
        name: EXTRACT_DONE,
        parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
};

const eventCall = () => ({
    name: EVENT_TOOL.function.name,
    args: { summary: '时间: 2026-01-01 12:00\n地点: 阿克塞尔镇外\n\n谢开业抵达城门。', links: [], ref: 'event_one' },
});
const validFactsCall = () => ({ name: FACT_TOOL_NAME, args: { operations: [], graphOperations: [] } });
const doneCall = () => ({ name: EXTRACT_DONE, args: {} });
const graphRefFactsCall = () => ({
    name: FACT_TOOL_NAME,
    args: {
        operations: [],
        graphOperations: [{
            action: 'entity',
            ref: 'item_notebook',
            name: '缄愿笔记',
            type: 'Item',
            evidence: [{ episodeId: 'ep:1', excerpt: '缄愿笔记' }],
        }],
    },
});

const legacyFactsCall = () => ({
    name: FACT_TOOL_NAME,
    args: {
        operations: [{
            action: 'create',
            type: 'explicit',
            content: '谢开业抵达阿克塞尔镇。',
            tags: ['谢开业'],
            source_episodes: [2],
        }],
        graphOperations: [],
    },
});

describe('Memory OS extraction schema recovery', () => {
    test('keeps valid staged event, rejects legacy memory args, and retries only missing phases', async () => {
        const tools = [EVENT_TOOL, factExtractionTool(), DONE_TOOL];
        const responses = [
            [eventCall(), legacyFactsCall(), doneCall()],
            [validFactsCall()],
            [doneCall()],
        ];
        const requests = [];

        const calls = await collectExtractTransaction({
            send: async request => {
                requests.push(request);
                return responses.shift() || [];
            },
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: true,
            nodeIds: [],
            taskMessages: [{ role: 'user', content: 'extract' }],
            repairContext: 'source context',
            maxRepairs: 1,
            toolTypes: {
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        expect(calls.map(call => call.name)).toEqual([
            EVENT_TOOL.function.name,
            FACT_TOOL_NAME,
            EXTRACT_DONE,
        ]);
        expect(calls.filter(call => call.name === EVENT_TOOL.function.name)).toHaveLength(1);
        expect(requests).toHaveLength(3);
        expect(requests[1].tools.map(tool => tool.function.name)).toEqual([FACT_TOOL_NAME]);
        expect(requests[2].tools.map(tool => tool.function.name)).toEqual([EXTRACT_DONE]);

        const repairPrompt = requests[1].taskMessages.at(-1).content;
        expect(repairPrompt).toContain('validation_errors');
        expect(repairPrompt).toContain('content');
        expect(repairPrompt).toContain(FACT_TOOL_NAME);
    });

    test('allows forward semantic refs declared later in the same transaction', () => {
        const tools = [CHARACTER_TOOL, EVENT_TOOL, DONE_TOOL];
        const calls = [
            {
                name: CHARACTER_TOOL.function.name,
                args: {
                    title: '谢开业',
                    ref: 'char_xie',
                    links: [{ target_ref: 'char_eris', relation: 'related' }],
                },
            },
            {
                name: CHARACTER_TOOL.function.name,
                args: { title: '厄里斯', ref: 'char_eris', links: [] },
            },
            eventCall(),
            doneCall(),
        ];
        const state = validateExtractTransaction({
            calls,
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: false,
            nodeIds: [],
            toolTypes: {
                [CHARACTER_TOOL.function.name]: { type: 'character_sheet', op: 'create' },
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        expect(state.malformed).toEqual([]);
        expect(state.valid).toBe(true);
    });

    test('repairs an omitted location ref from an unambiguous occurred_at link', async () => {
        const tools = [LOCATION_TOOL, EVENT_TOOL, factExtractionTool(), DONE_TOOL];
        const responses = [[
            graphRefFactsCall(),
            {
                name: LOCATION_TOOL.function.name,
                args: { title: '阿克塞尔', aliases: 'Axel, 阿克塞尔镇' },
            },
            {
                name: EVENT_TOOL.function.name,
                args: {
                    summary: '时间: 2026-01-01 12:00\n地点: 阿克塞尔镇外\n\n谢开业抵达城门。',
                    ref: 'event_transfer',
                    links: [{ target_ref: 'loc_axel', relation: 'occurred_at' }],
                },
            },
            doneCall(),
        ]];
        const requests = [];

        const calls = await collectExtractTransaction({
            send: async request => {
                requests.push(request);
                return responses.shift() || [];
            },
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: true,
            nodeIds: [],
            taskMessages: [{ role: 'user', content: 'extract' }],
            repairContext: 'source context',
            maxRepairs: 1,
            toolTypes: {
                [LOCATION_TOOL.function.name]: { type: 'location_state', op: 'create' },
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        expect(requests).toHaveLength(1);
        const locationCall = calls.find(call => call.name === LOCATION_TOOL.function.name);
        const event = calls.find(call => call.name === EVENT_TOOL.function.name);
        expect(locationCall.args.ref).toBe('loc_axel');
        expect(event.args.links).toEqual([{ target_ref: 'loc_axel', relation: 'occurred_at' }]);
        expect(calls.at(-1).name).toBe(EXTRACT_DONE);
    });

    test('repairs an exact-title location ref even when multiple locations were created without refs', async () => {
        const tools = [LOCATION_TOOL, EVENT_TOOL, DONE_TOOL];
        const calls = await collectExtractTransaction({
            send: async () => [[
                {
                    name: LOCATION_TOOL.function.name,
                    args: { title: '天界白色房间' },
                },
                {
                    name: LOCATION_TOOL.function.name,
                    args: { title: '阿克塞尔镇' },
                },
                {
                    name: EVENT_TOOL.function.name,
                    args: {
                        summary: '时间: 2026-01-01 12:00\n地点: 天界白色房间\n\n谢开业准备转生。',
                        ref: 'event_reincarnation',
                        links: [{ target_ref: '天界白色房间', relation: 'occurred_at' }],
                    },
                },
                doneCall(),
            ]].shift(),
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: false,
            nodeIds: [],
            taskMessages: [{ role: 'user', content: 'extract' }],
            repairContext: 'source context',
            maxRepairs: 1,
            toolTypes: {
                [LOCATION_TOOL.function.name]: { type: 'location_state', op: 'create' },
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        const locations = calls.filter(call => call.name === LOCATION_TOOL.function.name);
        expect(locations[0].args.ref).toBe('天界白色房间');
        expect(locations[1].args.ref).toBeUndefined();
        expect(calls.find(call => call.name === EVENT_TOOL.function.name)?.args.links)
            .toEqual([{ target_ref: '天界白色房间', relation: 'occurred_at' }]);
    });

    test('retries missing required tool calls and upstream 524 without losing staged extraction calls', async () => {
        const tools = [EVENT_TOOL, factExtractionTool(), DONE_TOOL];
        const requests = [];
        let responseIndex = 0;
        const calls = await collectExtractTransaction({
            initialCalls: [eventCall()],
            send: async request => {
                requests.push(request);
                responseIndex += 1;
                if (responseIndex === 1) {
                    const error = new Error('Model response did not contain the required tool call.');
                    error.code = 'tool_call_missing';
                    throw error;
                }
                if (responseIndex === 2) {
                    const error = new Error('ggchan.dev | 524: A timeout occurred');
                    error.code = 'unknown';
                    throw error;
                }
                if (responseIndex === 3) return [validFactsCall()];
                return [doneCall()];
            },
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: true,
            nodeIds: [],
            taskMessages: [{ role: 'user', content: 'extract' }],
            repairContext: {
                EXTRACTING: 'source context',
                MEMORY_FACTS_PENDING: 'fact context',
                DONE_PENDING: '',
            },
            maxRepairs: 1,
            toolTypes: {
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        expect(calls.map(call => call.name)).toEqual([
            EVENT_TOOL.function.name,
            FACT_TOOL_NAME,
            EXTRACT_DONE,
        ]);
        expect(requests).toHaveLength(4);
        expect(requests[0].tools.map(tool => tool.function.name)).toEqual([FACT_TOOL_NAME]);
        expect(requests[1].tools.map(tool => tool.function.name)).toEqual([FACT_TOOL_NAME]);
        expect(requests[2].tools.map(tool => tool.function.name)).toEqual([FACT_TOOL_NAME]);
        expect(requests[3].tools.map(tool => tool.function.name)).toEqual([EXTRACT_DONE]);
    });

    test('drops cross-namespace semantic refs and repairs only the required missing event', async () => {
        const tools = [CHARACTER_TOOL, THREAD_TOOL, EVENT_TOOL, factExtractionTool(), DONE_TOOL];
        const responses = [
            [
                {
                    name: CHARACTER_TOOL.function.name,
                    args: { title: '谢开业', ref: 'char_xie', links: [] },
                },
                {
                    name: THREAD_TOOL.function.name,
                    args: {
                        title: '笔记代价',
                        status: 'active',
                        note: '等待代价显现。',
                        ref: 'thread_bad',
                        links: [{ target_ref: 'item_notebook', relation: 'mentions' }],
                    },
                },
                {
                    name: EVENT_TOOL.function.name,
                    args: {
                        summary: '时间: 2026-01-01 12:00\n地点: 阿克塞尔镇外\n\n谢开业抵达城门。',
                        ref: 'event_bad',
                        links: [
                            { target_ref: 'char_xie', relation: 'involved_in' },
                            { target_ref: 'thread_bad', relation: 'advances' },
                            { target_ref: 'char_aqua', relation: 'mentions' },
                        ],
                    },
                },
                graphRefFactsCall(),
                doneCall(),
            ],
            [{
                name: EVENT_TOOL.function.name,
                args: {
                    summary: '时间: 2026-01-01 12:00\n地点: 阿克塞尔镇外\n\n谢开业抵达城门。',
                    ref: 'event_fixed',
                    links: [{ target_ref: 'char_xie', relation: 'involved_in' }],
                },
            }],
            [doneCall()],
        ];
        const requests = [];

        const calls = await collectExtractTransaction({
            send: async request => {
                requests.push(request);
                return responses.shift() || [];
            },
            tools,
            requiredTypes: ['event'],
            memoryOsEnabled: true,
            nodeIds: [],
            taskMessages: [{ role: 'user', content: 'extract' }],
            repairContext: 'source context',
            maxRepairs: 1,
            toolTypes: {
                [CHARACTER_TOOL.function.name]: { type: 'character_sheet', op: 'create' },
                [THREAD_TOOL.function.name]: { type: 'thread', op: 'create' },
                [EVENT_TOOL.function.name]: { type: 'event', op: 'create' },
            },
        });

        expect(calls.map(call => call.name)).toEqual([
            CHARACTER_TOOL.function.name,
            FACT_TOOL_NAME,
            EVENT_TOOL.function.name,
            EXTRACT_DONE,
        ]);
        expect(calls.some(call => call.args?.ref === 'thread_bad')).toBe(false);
        expect(requests).toHaveLength(3);
        expect(requests[1].taskMessages.at(-1).content).toContain('undeclared target_ref: item_notebook');
        expect(requests[1].taskMessages.at(-1).content).toContain('undeclared target_ref: char_aqua');
        expect(requests[1].taskMessages.at(-1).content).toContain('validation_errors');
    });

    test('fact extraction prompt names the current provenance fields and rejects legacy output keys', () => {
        const prompt = factExtractionContext({
            sources: [{ episodeId: 'ep:1', content: '谢开业抵达阿克塞尔镇。', role: 'assistant' }],
        }, []);

        expect(prompt).toContain('source_episodes is evidence only');
        expect(prompt).toContain('evidence: [{episodeId, excerpt}]');
        expect(prompt).toContain('exact contiguous substring');
        expect(prompt).toContain('graphOperations refs are private');
        expect(prompt).toContain('factIndex');
        expect(prompt).toContain('Do not emit legacy keys content, tags, source_episodes, schema, or data');
        expect(prompt).toContain('never use legacy {type, schema, data} wrappers');
    });
});
