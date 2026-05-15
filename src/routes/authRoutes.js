import { Router } from 'express';
import {
  forgotPassword,
  login,
  logout,
  logoutAll,
  refresh,
  resendEmailVerification,
  resetPassword,
  signup,
  verifyEmail,
} from '../controllers/authController.js';
import { googleCallback, googleStart } from '../controllers/googleAuthController.js';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { authLimiter, passwordLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/refresh', authLimiter, refresh);
router.post('/logout', logout);
router.post('/logout-all', authenticateUser, logoutAll);

router.post('/email/verify', authLimiter, verifyEmail);
router.post('/email/resend', authLimiter, resendEmailVerification);

router.post('/password/forgot', passwordLimiter, forgotPassword);
router.post('/password/reset', passwordLimiter, resetPassword);

router.get('/google/start', googleStart);
router.get('/google/callback', googleCallback);

export default router;
