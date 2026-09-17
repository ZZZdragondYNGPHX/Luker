// SPDX-License-Identifier: AGPL-3.0-or-later
import { ENTITY_TYPES } from './temporal-graph.js';

export function temporalOperationsSchema() {
    return { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false, required: ['action', 'evidence'], properties: {
        action: { type: 'string', enum: ['entity', 'alias', 'rename', 'merge_entity', 'split_entity', 'resolve_pending', 'relation', 'resolve_conflict'] },
        ref: { type: 'string', description: 'Optional entity reference local to this batch. IDs in storage are generated independently.' },
        name: { type: 'string' }, type: { type: 'string', enum: ENTITY_TYPES },
        sourceId: { type: 'string' }, targetId: { type: 'string' },
        candidateIds: { type: 'array', items: { type: 'string' } },
        resolutionConfidence: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string' }, pendingId: { type: 'string' },
        predicate: { type: 'string', description: 'Semantic lowercase snake_case relation; never vector similarity.' },
        label: { type: 'string' },
        policy: { type: 'string', enum: ['persistent', 'replace_current', 'multi_active'] },
        exclusiveSide: { type: 'string', enum: ['source', 'target'], description: 'replace_current exclusivity: located_in groups by source; owns/holds by target.' },
        factId: { type: 'string' }, factIndex: { type: 'integer', minimum: 0, description: 'Index in operations from this same call, for a new Fact.' },
        validFrom: { type: 'string' }, validUntil: { type: 'string' },
        timeOrder: { type: 'number', description: 'Comparable story chronology only when explicitly established; never use extraction arrival time.' },
        untilOrder: { type: 'number', description: 'Comparable exclusive end of a closed historical interval.' },
        relationId: { type: 'string' }, loserIds: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['episodeId', 'excerpt'], properties: {
            episodeId: { type: 'string' }, excerpt: { type: 'string' },
        } } },
    } } };
}

export function temporalExtractionContext(graph) {
    return `Temporal Graph: return graphOperations alongside fact operations. Every graphOperations item is a flat object using the current action/ref/name/type/sourceId/targetId/.../evidence fields exposed by the tool schema. Never emit legacy {type, schema, data} wrappers. Create/reuse typed entities before relations. Use entity batch refs and factIndex for results from the same call. Resolve canonical names, aliases, then normalized names; ambiguous candidates must remain pending. Context matching needs one justified candidate with confidence >= 0.9. Relations need active Fact evidence. Preserve history: replace_current only replaces when story time is comparable; otherwise conflicts remain disputed. Do not guess timeOrder from message order. Default policies: located_in replaces by source, owns/holds replace by target, visited/member_of allow multiple active edges. Manual merge/split/rename/conflict correction operations require evidence and a reason where specified.\n${JSON.stringify({
        entities: graph.entities.filter(entity => entity.status === 'active').slice(-100).map(({ id, type, canonicalName, aliases }) => ({ id, type, canonicalName, aliases })),
        relations: graph.relations.filter(relation => relation.status !== 'stale').slice(-100).map(({ id, sourceEntityId, targetEntityId, predicate, status, policy, exclusiveSide, validFrom, validUntil, timeOrder }) =>
            ({ id, sourceEntityId, targetEntityId, predicate, status, policy, exclusiveSide, validFrom, validUntil, timeOrder })),
        pending: graph.pending.filter(item => item.status === 'pending').slice(-50).map(({ id, name, type, candidateIds }) => ({ id, name, type, candidateIds })),
    })}`;
}

export function readTemporalToolCalls(calls, toolName) {
    const value = calls.find(call => call.name === toolName)?.args?.graphOperations;
    if (!Array.isArray(value)) throw new Error('graphOperations must be an array');
    return value;
}
