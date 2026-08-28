import { describe, expect, it } from 'vitest';
import { markAllReadSchema, notificationIdSchema } from '../validators/schemas.js';

const validId = (index = 1) => (
    `distribusi:550e8400-e29b-41d4-a716-${String(index).padStart(12, '0')}:awaiting_receipt:info`
);

describe('notification read ID contract', () => {
    it('accepts only bounded producer-shaped identifiers', () => {
        expect(notificationIdSchema.safeParse(validId()).success).toBe(true);
        expect(notificationIdSchema.safeParse('arbitrary-user-key').success).toBe(false);
        expect(notificationIdSchema.safeParse(`${validId()}\nforged`).success).toBe(false);
    });

    it('bounds bulk acknowledgements and rejects duplicate IDs', () => {
        expect(markAllReadSchema.safeParse({
            notificationIds: Array.from({ length: 100 }, (_, index) => validId(index + 1)),
        }).success).toBe(true);
        expect(markAllReadSchema.safeParse({
            notificationIds: Array.from({ length: 101 }, (_, index) => validId(index + 1)),
        }).success).toBe(false);
        expect(markAllReadSchema.safeParse({
            notificationIds: [validId(), validId()],
        }).success).toBe(false);
    });
});
