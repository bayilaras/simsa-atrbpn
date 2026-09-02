import { createHash, randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { regulatoryRuleEvents } from '../db/schema';

export interface GovernanceAuditContext {
    actorId?: string;
    actorEmail?: string;
    ipAddress?: string;
    reason?: string;
}

export interface RegulatoryEventInput {
    ruleSetId: string;
    instrumentType: 'klasifikasi' | 'jra';
    entityType: 'rule_set' | 'item' | 'source_document' | 'manifest' | 'impact';
    itemId?: number | null;
    itemCode?: string | null;
    action: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    reason?: string | null;
}

function canonicalJson(value: unknown): string {
    if (value === undefined) return '"__undefined__"';
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    )).join(',')}}`;
}

function jsonSafe(value: unknown): any {
    if (value == null) return null;
    return JSON.parse(JSON.stringify(value));
}

/**
 * Append one or many chained audit events using the caller's transaction.
 * Any insert failure is intentionally allowed to escape and roll back the
 * governed mutation (fail closed).
 */
export async function appendRegulatoryEvents(
    tx: any,
    inputs: RegulatoryEventInput[],
    context: GovernanceAuditContext = {},
): Promise<void> {
    if (inputs.length === 0) return;
    const ruleSetIds = new Set(inputs.map(({ ruleSetId }) => ruleSetId));
    if (ruleSetIds.size !== 1) {
        throw new Error('Satu rantai audit hanya boleh memuat satu versi aturan.');
    }
    const ruleSetId = inputs[0].ruleSetId;

    // Serialize the head read and subsequent append for this rule set. Without
    // the row lock, two concurrent transactions could observe the same head
    // and both try to create a child from it. The database's partial unique
    // indexes remain a fail-closed second line of defence against a fork.
    await tx.execute(sql`
        select "id"
        from "regulatory_rule_sets"
        where "id" = ${ruleSetId}::uuid
        for update
    `);

    const [latest] = await tx
        .select({
            eventHash: regulatoryRuleEvents.eventHash,
            createdAt: regulatoryRuleEvents.createdAt,
        })
        .from(regulatoryRuleEvents)
        .where(eq(regulatoryRuleEvents.ruleSetId, ruleSetId))
        .orderBy(desc(regulatoryRuleEvents.createdAt), desc(regulatoryRuleEvents.id))
        .limit(1);

    let previousEventHash: string | null = latest?.eventHash || null;
    const latestClock = latest?.createdAt ? new Date(latest.createdAt).getTime() + 1 : 0;
    const clock = Math.max(Date.now(), latestClock);
    const rows = inputs.map((input, index) => {
        const id = randomUUID();
        const createdAt = new Date(clock + index);
        const evidence = {
            id,
            ruleSetId: input.ruleSetId,
            instrumentType: input.instrumentType,
            entityType: input.entityType,
            itemId: input.itemId ?? null,
            itemCode: input.itemCode ?? null,
            action: input.action,
            before: jsonSafe(input.before),
            after: jsonSafe(input.after),
            reason: input.reason ?? context.reason ?? null,
            actorId: context.actorId ?? null,
            actorEmail: context.actorEmail ?? null,
            ipAddress: context.ipAddress ?? null,
            previousEventHash,
            createdAt: createdAt.toISOString(),
        };
        const eventHash = createHash('sha256')
            .update(canonicalJson(evidence), 'utf8')
            .digest('hex');
        previousEventHash = eventHash;
        return { ...evidence, createdAt, eventHash };
    });
    await tx.insert(regulatoryRuleEvents).values(rows);
}

export function regulatoryEvidenceHash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function verifyRegulatoryEventChain(events: Array<Record<string, any>>) {
    let previousEventHash: string | null = null;
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const evidence = {
            id: event.id,
            ruleSetId: event.ruleSetId,
            instrumentType: event.instrumentType,
            entityType: event.entityType,
            itemId: event.itemId ?? null,
            itemCode: event.itemCode ?? null,
            action: event.action,
            before: jsonSafe(event.before),
            after: jsonSafe(event.after),
            reason: event.reason ?? null,
            actorId: event.actorId ?? null,
            actorEmail: event.actorEmail ?? null,
            ipAddress: event.ipAddress ?? null,
            previousEventHash,
            createdAt: event.createdAt instanceof Date
                ? event.createdAt.toISOString()
                : new Date(event.createdAt).toISOString(),
        };
        const calculated = createHash('sha256').update(canonicalJson(evidence), 'utf8').digest('hex');
        if (event.previousEventHash !== previousEventHash || event.eventHash !== calculated) {
            return {
                valid: false,
                checkedEvents: index,
                brokenEventId: event.id,
                expectedPreviousEventHash: previousEventHash,
                calculatedEventHash: calculated,
            };
        }
        previousEventHash = event.eventHash;
    }
    return {
        valid: true,
        checkedEvents: events.length,
        brokenEventId: null,
        headEventHash: previousEventHash,
    };
}
