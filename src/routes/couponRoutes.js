import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { validateCoupon } from '../controllers/couponController.js';
import { getCouponByCode } from '../controllers/couponPublicController.js';
import { couponsLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.get('/:code', couponsLimiter, getCouponByCode);
router.post('/validate', couponsLimiter, authenticateUser, validateCoupon);

export default router;
