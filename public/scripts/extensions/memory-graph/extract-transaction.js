import { validateParsedToolCalls } from '../function-call-runtime.js';
import { FACT_TOOL_NAME } from './fact-extraction.js';

export const EXTRACT_DONE = 'luker_rpg_extract_done';

/** Validate the whole staged batch, not just the most recent completion. */
export function validateExtractTransaction({ calls = [], tools = [], requiredTypes = [], memoryOsEnabled = false, nodeIds = [], toolTypes = {} }) {
    const missing = [], duplicate = [], orderingErrors = [], malformed = [];
    const names = calls.map(call => call.name);
    const count = name => names.filter(value => value === name).length;
    const toolNames = (type, op) => {
        const mapped = Object.entries(toolTypes).filter(([, spec]) => spec.type === type && spec.op === op).map(([name]) => name);
        return mapped.length ? mapped : [`luker_rpg_extract_${type.replace(/[^a-z0-9_]/g, '_')}_${op}`];
    };
    const requiredWrites = requiredTypes.filter(type => !calls.some(call =>
        toolNames(type, 'create').includes(call.name) || (type !== 'event' && toolNames(type, 'edit').includes(call.name))));
    missing.push(...requiredWrites.flatMap(type => toolNames(type, 'create')));
    if (count('luker_rpg_extract_event_create') > 1) duplicate.push('luker_rpg_extract_event_create');
    for (const name of [EXTRACT_DONE, ...(memoryOsEnabled ? [FACT_TOOL_NAME] : [])]) {
        if (!count(name)) missing.push(name);
        if (count(name) > 1) duplicate.push(name);
    }
    if (names.includes(EXTRACT_DONE) && names.at(-1) !== EXTRACT_DONE) orderingErrors.push('done_must_be_last');
    if (memoryOsEnabled && names.includes(EXTRACT_DONE) && !names.includes(FACT_TOOL_NAME)) orderingErrors.push('done_before_memory_facts');
    if (names.includes(EXTRACT_DONE) && requiredWrites.length) orderingErrors.push('done_before_required_writes');
    const refs = new Set(), ids = new Set(nodeIds);
    // Semantic extraction refs are transaction-local and may be referenced
    // before their create call appears in the same model response. Collect the
    // whole semantic ref namespace first, then validate locators in a second
    // pass. Memory OS graphOperations refs intentionally live in a separate
    // namespace and are never admitted here.
    for (const call of calls) {
        if (call.name === FACT_TOOL_NAME || call.name === EXTRACT_DONE) continue;
        const ref = call.args?.ref;
        if (!ref) continue;
        if (refs.has(ref)) duplicate.push(`ref:${ref}`);
        refs.add(ref);
    }
    for (const [index, call] of calls.entries()) {
        const error = validateParsedToolCalls([call], tools);
        if (error) malformed.push({ index, reason: error });
        const args = call.args || {};
        if (call.name === FACT_TOOL_NAME || call.name === EXTRACT_DONE) continue;
        for (const locator of [args, ...(Array.isArray(args.links) ? args.links : [])]) {
            for (const key of ['source_ref', 'target_ref']) {
                if (locator[key] && !refs.has(locator[key])) malformed.push({ index, reason: `undeclared ${key}: ${locator[key]}` });
            }
            for (const key of ['node_id', 'source_node_id', 'target_node_id']) {
                if (locator[key] && !ids.has(locator[key])) malformed.push({ index, reason: `unknown ${key}: ${locator[key]}` });
            }
        }
    }
    const invalid = duplicate.length > 0 || orderingErrors.length > 0 || malformed.length > 0;
    const phase = requiredWrites.length ? 'EXTRACTING'
        : memoryOsEnabled && !count(FACT_TOOL_NAME) ? 'MEMORY_FACTS_PENDING'
            : !count(EXTRACT_DONE) ? 'DONE_PENDING' : 'COMPLETE';
    return { valid: !invalid && missing.length === 0, invalid, missing, requiredWrites, duplicate, orderingErrors, malformed, phase,
        event_create: count('luker_rpg_extract_event_create'), memory_facts_count: count(FACT_TOOL_NAME),
        done_count: count(EXTRACT_DONE), done_is_last: names.at(-1) === EXTRACT_DONE };
}

/** Calls are staged only. The caller validates semantic effects and commits once. */
export async function collectExtractTransaction({ send, tools, requiredTypes, memoryOsEnabled, nodeIds, taskMessages, repairContext, maxRepairs = 1, signal, initialCalls = [], toolTypes = {} }) {
    const calls = [...initialCalls];
    let state = validateExtractTransaction({ calls, tools, requiredTypes, memoryOsEnabled, nodeIds, toolTypes });
    let emptyRetries = 0;
    let schemaRetries = 0;
    let protocolRetries = 0;
    let validationErrors = [];
    const maxRounds = requiredTypes.length + 3 + (maxRepairs * 2);
    for (let round = 0; round < maxRounds; round++) {
        if (signal?.aborted) throw new DOMException('Memory extraction aborted', 'AbortError');
        const repair = round > 0 || initialCalls.length > 0;
        const allowed = !repair ? tools : tools.filter(tool => {
            const name = tool.function.name;
            if (state.phase === 'MEMORY_FACTS_PENDING') return name === FACT_TOOL_NAME;
            if (state.phase === 'DONE_PENDING') return name === EXTRACT_DONE;
            const spec = toolTypes[name];
            return state.missing.includes(name) || (spec?.op === 'edit' && spec.type !== 'event' && state.requiredWrites.includes(spec.type));
        });
        const messages = !repair ? taskMessages : [
            { role: 'system', content: 'Complete only the missing extraction steps using the available tools. Completed calls are staged, not committed. Never recreate staged nodes. Calls rejected by schema or transaction validation are not staged: correct only those missing calls using the CURRENT exposed tool schema exactly. Semantic target_ref/source_ref values may reference any semantic ref created anywhere in the same staged transaction, including later calls, but refs declared inside luker_memory_facts.graphOperations are a separate namespace and must never be reused by luker_rpg_extract_* tools. If no semantic target exists, omit that link or use a known graph_data node_id. Do not reuse legacy argument keys or wrappers. Do not output analysis or ordinary text.' },
            { role: 'user', content: JSON.stringify({ phase: state.phase,
                completed: calls.map(call => ({ name: call.name, ref: call.args?.ref, node_id: call.args?.node_id })), missing: state.missing,
                ...(validationErrors.length ? { validation_errors: validationErrors } : {}) })
                + '\n' + (typeof repairContext === 'string' ? repairContext : repairContext?.[state.phase] || '') },
        ];
        let next;
        try {
            next = await send({ tools: allowed, taskMessages: messages, repair, phase: state.phase, round });
        } catch (error) {
            if (error?.code !== 'tool_call_parse' || ++emptyRetries > maxRepairs || signal?.aborted) throw error;
            continue;
        }
        if (!next.length && ++emptyRetries > maxRepairs) {
            const error = new Error('Extraction returned no tool calls. No new memory was written.');
            error.code = 'memory_extract_protocol';
            error.details = state;
            throw error;
        }

        const accepted = [];
        const rejected = [];
        for (const call of next) {
            const validationError = validateParsedToolCalls([call], tools);
            if (validationError) {
                rejected.push({ name: call?.name || null, reason: validationError });
            } else {
                accepted.push(call);
            }
        }

        // A completion marker from the same response as a malformed call cannot be
        // staged safely: the malformed step is still missing, so done would violate
        // transaction ordering. Valid non-done calls are retained across the retry.
        calls.push(...(rejected.length ? accepted.filter(call => call.name !== EXTRACT_DONE) : accepted));
        state = validateExtractTransaction({ calls, tools, requiredTypes, memoryOsEnabled, nodeIds, toolTypes });
        validationErrors = rejected;
        console.debug('[Memory Extract Protocol]', { round, required_event: requiredTypes.includes('event'), actual_calls: calls.map(call => call.name), rejected_calls: rejected, ...state });

        if (state.invalid) {
            // Duplicate writes and ordering violations are transaction-level
            // contradictions and remain fatal. Locator errors are repairable:
            // discard only the malformed semantic calls (plus done), repeatedly
            // revalidate to remove dependants whose refs became undeclared, then
            // ask the model for the now-missing required phase. This prevents one
            // cross-namespace/unknown link from rolling back otherwise valid work.
            if (state.duplicate.length || state.orderingErrors.length) {
                const error = new Error('Invalid extraction transaction. No new memory was written.');
                error.code = 'memory_extract_protocol';
                error.details = { ...state, validation_errors: validationErrors };
                throw error;
            }
            const protocolErrors = [];
            let repairedCalls = [...calls];
            let repairedState = state;
            while (repairedState.malformed.length) {
                const badIndexes = new Set(repairedState.malformed.map(item => item.index));
                for (const issue of repairedState.malformed) {
                    protocolErrors.push({
                        name: repairedCalls[issue.index]?.name || null,
                        reason: issue.reason,
                    });
                }
                const nextCalls = repairedCalls.filter((call, index) => !badIndexes.has(index) && call.name !== EXTRACT_DONE);
                if (nextCalls.length === repairedCalls.length) break;
                repairedCalls = nextCalls;
                repairedState = validateExtractTransaction({ calls: repairedCalls, tools, requiredTypes, memoryOsEnabled, nodeIds, toolTypes });
                if (repairedState.duplicate.length || repairedState.orderingErrors.length) break;
            }
            calls.splice(0, calls.length, ...repairedCalls);
            state = repairedState;
            validationErrors = [...rejected, ...protocolErrors];
            if (state.invalid || ++protocolRetries > maxRepairs) {
                const error = new Error('Extraction references failed transaction validation after retry. No new memory was written.');
                error.code = 'memory_extract_protocol';
                error.details = { ...state, validation_errors: validationErrors };
                throw error;
            }
            continue;
        }
        if (rejected.length) {
            if (++schemaRetries > maxRepairs) {
                const error = new Error('Extraction tool arguments failed schema validation after retry. No new memory was written.');
                error.code = 'memory_extract_protocol';
                error.details = { ...state, validation_errors: validationErrors };
                throw error;
            }
            continue;
        }
        validationErrors = [];
        if (state.valid) return calls;
    }
    const error = new Error('Incomplete extraction transaction. No new memory was written.');
    error.code = 'memory_extract_protocol';
    error.details = { ...state, ...(validationErrors.length ? { validation_errors: validationErrors } : {}) };
    throw error;
}

export function logExtractResponse(result, request) {
    const raw = result?.raw?.choices?.[0]?.message?.tool_calls;
    const merged = result?.toolCalls || [];
    const inspect = call => {
        const args = call?.function?.arguments ?? call?.raw?.function?.arguments;
        let parsed = args === undefined ? Boolean(call?.args && typeof call.args === 'object') : false;
        if (typeof args === 'string') { try { JSON.parse(args); parsed = true; } catch { /* reported below */ } }
        return { id: call.id || call.raw?.id || null, name: call.function?.name || call.name || null,
            arguments_present: args !== undefined || call.args !== undefined, arguments_json_valid: parsed };
    };
    console.debug('[Memory Extract Response]', {
        ...result?.requestInfo, model: result?.raw?.model || result?.requestInfo?.model || null,
        stream: false, streaming_merge: false, tool_choice: request.toolChoice,
        finish_reason: result?.finishReason || result?.raw?.choices?.[0]?.finish_reason || null,
        content_present: Boolean(result?.assistantText || result?.raw?.choices?.[0]?.message?.content),
        raw_calls: Array.isArray(raw) ? raw.map(inspect) : null, raw_count: Array.isArray(raw) ? raw.length : null,
        merged_calls: merged.map(inspect), merged_count: merged.length,
    });
}
