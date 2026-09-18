import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { TOOL_PROTOCOL_STYLE, validateParsedToolCalls } from '../../public/scripts/extensions/function-call-runtime.js';
import './_mocks/main-module-stack.js';
import { createEmptyStore } from '../../public/scripts/extensions/memory-graph/persistence.js';

jest.unstable_mockModule('../../public/scripts/extensions/function-call-runtime.js', () => ({ TOOL_PROTOCOL_STYLE, validateParsedToolCalls }));
let context;
let processBatch;
let disk;
let createHistory;
let getDefaultSchema;
beforeAll(async () => {
    const base = global.Luker.getContext();
    context = Object.assign(Object.create(base), {
        characterId: null, groupId: null, characters: [], chatMetadata: {},
        extensionSettings: { memory_graph: { memoryOsEnabled: true } },
        resolveChatStateTarget: () => ({ is_group: false, avatar_url: 'fact-test.png', file_name: 'facts' }),
    });
    global.Luker.getContext = () => context;
    const main = await import('../../public/scripts/extensions/memory-graph/main.js');
    processBatch = main._processPendingMessageBatchWithLLMForTest;
    createHistory = main.createMemoryHistoryBuilder;
    getDefaultSchema = main.getDefaultNodeTypeSchema;
});
beforeEach(() => {
    disk = new Map();
    context.chat = [{ mes: 'Roland keeps the sword.', is_user: false }];
    context.saveChat = jest.fn(async () => {});
    context.getChatState = async namespace => ({ ok: true, state: structuredClone(disk.get(namespace) || null) });
    context.updateChatState = async (namespace, update) => {
        disk.set(namespace, structuredClone(update(disk.get(namespace)))); return { ok: true };
    };
});
function answer(request, excerptOverride, withGraph = false) {
    const tail = request.taskMessages.at(-1).content;
    const marker = tail.indexOf('{"source_episodes"');
    // The fact context precedes optional per-type rules; consume the one JSON line.
    const payload = JSON.parse(tail.slice(marker).split('\n')[0]);
    const source = payload.source_episodes[0];
    return { toolCalls: [
        { name: 'luker_memory_facts', args: { operations: [{ action: 'create', type: 'explicit', text: 'Roland keeps the sword.',
            evidence: [{ episodeId: source.episodeId, excerpt: excerptOverride || source.content }] }],
        ...(withGraph ? { graphOperations: [
            { action: 'entity', ref: 'holder', name: 'Roland', type: 'Character', evidence: [{ episodeId: source.episodeId, excerpt: source.content }] },
            { action: 'entity', ref: 'item', name: 'Sword', type: 'Item', evidence: [{ episodeId: source.episodeId, excerpt: source.content }] },
            { action: 'relation', sourceId: 'holder', targetId: 'item', predicate: 'holds', factIndex: 0, evidence: [{ episodeId: source.episodeId, excerpt: source.content }] },
        ] } : { graphOperations: [] }) } },
        { name: 'luker_rpg_extract_done', args: {} },
    ] };
}
function run(settings = {}) {
    return processBatch(context, createEmptyStore(), { memoryOsEnabled: true, includeWorldInfoWithPreset: false, ...settings }, [],
        [{ ...context.chat[0], seq: 1, source_index: 0 }], 0, 0);
}
describe('production extraction dispatch with simulated model responses', () => {
    test('history uses production tool dispatch and validates against the staged prior batch', async () => {
        context.chat = Array.from({ length: 7 }, () => ({ mes: 'Roland keeps the sword.', is_user: false }));
        context.generateTask = jest.fn(async request => answer(request, null, true));
        const builder = createHistory();
        const result = await builder.run(context, { floors: [0, 1, 2, 3, 4, 5, 6] });
        expect(result.errors).toEqual([]); expect(result.status).toBe('completed');
        expect(context.generateTask).toHaveBeenCalledTimes(3);
        const tail = context.generateTask.mock.calls[1][0].taskMessages.at(-1).content;
        expect(tail).toContain('"canonicalName":"Roland"');
        expect(Object.values(disk.get('memory_graph__provenance').entities)).toHaveLength(2);
        await builder.rollback(context);
        expect(disk.get('memory_graph__provenance').entities).toEqual({});
    });
    test('persists same-response Facts, entities and semantic relations atomically', async () => {
        context.generateTask = jest.fn(async request => answer(request, null, true));
        await run();
        const ledger = disk.get('memory_graph__provenance');
        expect(Object.values(ledger.entities)).toHaveLength(2);
        expect(Object.values(ledger.relations)).toHaveLength(1);
        expect(Object.values(ledger.relations)[0].predicate).toBe('holds');
        expect(Object.values(ledger.relations)[0].status).toBe('active');
        await run();
        expect(Object.values(disk.get('memory_graph__provenance').relations)).toHaveLength(1);
    });
    test('invalid graph reference rejects the accompanying valid Fact batch', async () => {
        context.generateTask = jest.fn(async request => {
            const response = answer(request, null, true);
            response.toolCalls[0].args.graphOperations[2].targetId = 'unresolved';
            return response;
        });
        await expect(run()).rejects.toThrow('endpoints');
        expect(disk.get('memory_graph__provenance').facts).toBeUndefined();
        expect(disk.get('memory_graph__provenance').relations).toBeUndefined();
    });
    test('requests fact tools even without active legacy node types, then persists sourced facts', async () => {
        context.generateTask = jest.fn(async request => answer(request));
        await run();
        expect(context.generateTask.mock.calls[0][0].tools.some(tool => tool.function.name === 'luker_memory_facts')).toBe(true);
        const facts = Object.values(disk.get('memory_graph__provenance').facts);
        expect(facts).toHaveLength(1);
        expect(facts[0].status).toBe('active');
        await run();
        expect(Object.values(disk.get('memory_graph__provenance').facts)).toHaveLength(1);
    });
    test('invalid evidence triggers semantic retry and never persists fabricated excerpts', async () => {
        context.generateTask = jest.fn().mockImplementationOnce(async request => answer(request, 'invented quote'))
            .mockImplementation(async request => answer(request));
        await run({ toolCallRetryMax: 1 });
        expect(context.generateTask).toHaveBeenCalledTimes(2);
        expect(Object.values(disk.get('memory_graph__provenance').facts)[0].supports[0].evidence[0].excerpt).toBe('Roland keeps the sword.');
    });
    test('source edit while the model runs rejects the result before any fact is written', async () => {
        context.generateTask = jest.fn(async request => {
            const result = answer(request); context.chat[0].mes = 'Alice keeps the sword.'; return result;
        });
        await expect(run()).rejects.toThrow();
        expect(disk.get('memory_graph__provenance').facts).toBeUndefined();
    });
});

const eventCall = () => ({ name: 'luker_rpg_extract_event_create', args: { summary: '时间: 未知\n地点: 未知\n\nRoland keeps the sword.', links: [], no_link_reason: 'No grounded relationship.', ref: 'event_one' } });
const factsCall = () => ({ name: 'luker_memory_facts', args: { operations: [], graphOperations: [] } });
const doneCall = () => ({ name: 'luker_rpg_extract_done', args: {} });
function runEventBatch(store = createEmptyStore()) {
    const schema = getDefaultSchema().filter(type => type.id === 'event');
    return processBatch(context, store, { memoryOsEnabled: true, nodeTypeSchema: schema, toolCallRetryMax: 1 }, schema,
        [{ ...context.chat[0], seq: 1, source_index: 0 }], 0, 0);
}
describe('seq=1 uninitialized event extraction transaction', () => {
    test.each([
        ['complete', [[eventCall(), factsCall(), doneCall()]]],
        ['event only', [[eventCall()], [factsCall()], [doneCall()]]],
        ['missing done', [[eventCall(), factsCall()], [doneCall()]]],
        ['text only first', [[], [eventCall()], [factsCall()], [doneCall()]]],
    ])('%s stages once and completes missing phases', async (_name, responses) => {
        const store = createEmptyStore();
        context.generateTask = jest.fn(async request => {
            expect(Object.values(store.nodes || {})).toHaveLength(0);
            expect(request.stream).toBe(false);
            const requestToolNames = request.tools.map(tool => tool.function.name);
            if (requestToolNames.length === 1) {
                expect(request.toolChoice).toEqual({ type: 'function', function: { name: requestToolNames[0] } });
                expect(request.functionCallOptions?.requiredFunctionName).toBe(requestToolNames[0]);
            } else {
                expect(request.toolChoice).toBe('required');
            }
            expect(request.promptMode).toBe('task'); expect(request.includeCharacterCard).toBe(false);
            expect(JSON.stringify(request.taskMessages)).not.toContain('<thought>');
            return { toolCalls: responses.shift() };
        });
        await runEventBatch(store);
        expect(Object.values(store.nodes).filter(node => node.type === 'event')).toHaveLength(1);
        const requests = context.generateTask.mock.calls.map(([request]) => request);
        if (_name === 'event only') {
            expect(requests.slice(1).map(request => request.tools.map(tool => tool.function.name))).toEqual([['luker_memory_facts'], ['luker_rpg_extract_done']]);
            expect(requests[1].temperature).toBe(0);
        }
    });
    test.each([
        ['duplicate facts', [eventCall(), factsCall(), factsCall(), doneCall()]],
        ['done before facts', [eventCall(), doneCall(), factsCall()]],
        ['missing event', [factsCall(), doneCall()]],
        ['undeclared graph ref', [{ ...eventCall(), args: { ...eventCall().args, links: [{ target_ref: 'missing', relation: 'related' }] } }, factsCall(), doneCall()]],
    ])('%s rejects without graph or fact writes', async (_name, calls) => {
        const store = createEmptyStore(); context.generateTask = jest.fn(async () => ({ toolCalls: calls }));
        await expect(runEventBatch(store)).rejects.toThrow();
        expect(Object.values(store.nodes || {})).toHaveLength(0);
        expect(Object.values(disk.get('memory_graph__provenance')?.facts || {})).toHaveLength(0);
    });
    test('repeated empty response has a finite bound and leaves the batch retryable', async () => {
        const store = createEmptyStore();
        context.generateTask = jest.fn(async () => ({ assistantText: 'no tool', toolCalls: [] }));
        await expect(runEventBatch(store)).rejects.toThrow('no tool calls');
        expect(context.generateTask).toHaveBeenCalledTimes(2);
        expect(store.appliedSeqTo || 0).toBe(0);
    });
    test('abort between phases does not publish the staged event', async () => {
        const controller = new AbortController();
        context.generateTask = jest.fn(async () => { controller.abort(); return { toolCalls: [eventCall()] }; });
        const store = createEmptyStore(), schema = getDefaultSchema().filter(type => type.id === 'event');
        await expect(processBatch(context, store, { memoryOsEnabled: true, nodeTypeSchema: schema }, schema,
            [{ ...context.chat[0], seq: 1, source_index: 0 }], 0, 0, { abortSignal: controller.signal })).rejects.toThrow();
        expect(Object.values(store.nodes || {})).toHaveLength(0);
        expect(context.generateTask).toHaveBeenCalledTimes(1);
    });
    test('explicit required capability rejection uses existing protocol adapter once', async () => {
        context.generateTask = jest.fn().mockRejectedValueOnce(new Error('tool_choice required is unsupported'))
            .mockResolvedValue({ toolCalls: [eventCall(), factsCall(), doneCall()] });
        await runEventBatch();
        expect(context.generateTask.mock.calls[1][0].functionCallMode).toBe('prompt_xml');
    });
});

test('invalid fact evidence repairs only facts and done after a valid staged event', async () => {
    const store = createEmptyStore(); let index = 0;
    context.generateTask = jest.fn(async request => {
        index++;
        if (index === 1) return { toolCalls: [eventCall(), ...answer(request, 'fabricated').toolCalls] };
        if (index === 2) { expect(request.tools.map(tool => tool.function.name)).toEqual(['luker_memory_facts']); return { toolCalls: [factsCall()] }; }
        return { toolCalls: [doneCall()] };
    });
    await runEventBatch(store);
    expect(Object.values(store.nodes).filter(node => node.type === 'event')).toHaveLength(1);
    expect(context.generateTask).toHaveBeenCalledTimes(3);
});
test('failed provenance commit never publishes the staged graph', async () => {
    const store = createEmptyStore();
    context.generateTask = jest.fn(async () => ({ toolCalls: [eventCall(), factsCall(), doneCall()] }));
    const write = context.updateChatState;
    context.updateChatState = async (namespace, update) => {
        const next = update(disk.get(namespace));
        if (next.facts || next.artifacts && Object.keys(next.artifacts).length) return { ok: false };
        return write(namespace, () => next);
    };
    await expect(runEventBatch(store)).rejects.toThrow('write failed');
    expect(Object.values(store.nodes || {})).toHaveLength(0);
});
