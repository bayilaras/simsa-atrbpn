import { Router, type Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middlewares/auth.middleware';
import { canWriteMiddleware } from '../middlewares/role.middleware';
import { validateBody } from '../middlewares/validate.middleware';
import { sanitizeSatuBaris } from '../middlewares/sanitize.middleware.js';
import { letterPrefillSchema, type LetterPrefillInput } from '../validators/schemas';
import { readLetterFormFields, type LetterFormFields } from '../services/letter-text-fields.js';

const router = Router();

router.use(authMiddleware);

/** The same single-line clean-up a typed value gets when the letter is saved. */
function cleanFields(fields: LetterFormFields): LetterFormFields {
    return Object.fromEntries(Object.entries(fields)
        .map(([name, value]) => [name, (value && sanitizeSatuBaris(value)) || null])) as unknown as LetterFormFields;
}

/**
 * POST /api/letter-prefill
 *
 * Reads the fields of a letter form from the text of the letter. The browser
 * extracts that text from the chosen PDF, so the file itself never reaches
 * this route. The text is read in memory only: nothing is stored, logged or
 * written to the audit trail, and the answer is a suggestion the person
 * registering the letter still checks and saves.
 *
 * The work is a bounded scan of at most LETTER_FORM_TEXT_MAX_CHARS characters
 * (a few milliseconds), so the general API quota per user is the only limit.
 */
router.post('/', canWriteMiddleware(), validateBody(letterPrefillSchema), (req: AuthRequest, res: Response) => {
    const { extractedText } = req.body as LetterPrefillInput;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: cleanFields(readLetterFormFields(extractedText)) });
});

export default router;
