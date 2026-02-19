import { Router } from 'express';
import { checkPasswordStrength } from '../middlewares/password-policy.middleware';

const router = Router();

/**
 * @route   POST /api/security/check-password
 * @desc    Check password strength and get validation feedback
 * @access  Public (for registration/password change forms)
 */
router.post('/check-password', checkPasswordStrength);

export default router;
