import { describe, expect, test } from '@jest/globals';
import { collectExtractTransaction, EXTRACT_DONE } from '../../public/scripts/extensions/memory-graph/extract-transaction.js';
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

    test('fact extraction prompt names the current provenance fields and rejects legacy output keys', () => {
        const prompt = factExtractionContext({
            sources: [{ episodeId: 'ep:1', content: '谢开业抵达阿克塞尔镇。', role: 'assistant' }],
        }, []);

        expect(prompt).toContain('source_episodes is evidence only');
        expect(prompt).toContain('evidence: [{episodeId, excerpt}]');
        expect(prompt).toContain('Do not emit legacy keys content, tags, source_episodes, schema, or data');
        expect(prompt).toContain('never use legacy {type, schema, data} wrappers');
    });
});
