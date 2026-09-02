import type { SrikandiConfig } from '../config/srikandi.js';
import { srikandiConfig } from '../config/srikandi.js';
import {
    SrikandiIntegrationUnavailableError,
    srikandiService,
} from './srikandi.service.js';

export interface SrikandiCreatedRecord {
    id: string;
    unitKerjaId: string;
    nomorSurat?: string | null;
    tanggalSurat?: string | Date | null;
    perihal?: string | null;
    counterpart?: string | null;
    createdAt?: Date | string | null;
}

interface TransactionalOutbox {
    enqueueWithExecutor(executor: any, input: {
        unitKerjaId: string;
        idempotencyKey: string;
        eventType: string;
        sourceEntityType: string;
        sourceEntityId: string;
        payload: Record<string, unknown>;
        createdBy?: string;
    }): Promise<unknown>;
}

export type SrikandiProducerResult =
    | { queued: false; reason: 'disabled' }
    | { queued: true };

function iso(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function dateOnly(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
    }
    return iso(value)?.slice(0, 10) || null;
}

/**
 * Transactional domain-event producer. The payload is deliberately identified
 * as a SIMSA-owned profile; enabling it requires an operator to explicitly map
 * both official event names and the accepted profile. No official SRIKANDI
 * contract name, endpoint, or success response is guessed by this service.
 */
export class SrikandiBusinessProducer {
    constructor(
        private readonly config: SrikandiConfig = srikandiConfig,
        private readonly outbox: TransactionalOutbox = srikandiService,
    ) {}

    async suratMasukCreated(
        executor: any,
        record: SrikandiCreatedRecord,
        actorId?: string,
    ): Promise<SrikandiProducerResult> {
        return this.enqueueCreated(
            executor,
            'surat_masuk',
            this.config.suratMasukCreatedEvent,
            'incoming',
            record,
            actorId,
        );
    }

    async suratKeluarCreated(
        executor: any,
        record: SrikandiCreatedRecord,
        actorId?: string,
    ): Promise<SrikandiProducerResult> {
        return this.enqueueCreated(
            executor,
            'surat_keluar',
            this.config.suratKeluarCreatedEvent,
            'outgoing',
            record,
            actorId,
        );
    }

    private async enqueueCreated(
        executor: any,
        sourceEntityType: 'surat_masuk' | 'surat_keluar',
        eventType: string,
        direction: 'incoming' | 'outgoing',
        record: SrikandiCreatedRecord,
        actorId?: string,
    ): Promise<SrikandiProducerResult> {
        if (!this.config.producerEnabled) return { queued: false, reason: 'disabled' };
        if (!this.config.producerReady || !eventType) {
            throw new SrikandiIntegrationUnavailableError(
                'Producer outbox SRIKANDI diaktifkan tetapi pemetaan kontraknya belum lengkap',
            );
        }

        await this.outbox.enqueueWithExecutor(executor, {
            unitKerjaId: record.unitKerjaId,
            idempotencyKey: `simsa:${sourceEntityType}:${record.id}:created`,
            eventType,
            sourceEntityType,
            sourceEntityId: record.id,
            payload: {
                profile: this.config.producerPayloadProfile,
                lifecycleState: 'created',
                direction,
                occurredAt: iso(record.createdAt),
                record: {
                    id: record.id,
                    unitKerjaId: record.unitKerjaId,
                    nomorSurat: record.nomorSurat || null,
                    tanggalSurat: dateOnly(record.tanggalSurat),
                    perihal: record.perihal || null,
                    counterpart: record.counterpart || null,
                },
            },
            createdBy: actorId,
        });
        return { queued: true };
    }
}

export const srikandiBusinessProducer = new SrikandiBusinessProducer();
