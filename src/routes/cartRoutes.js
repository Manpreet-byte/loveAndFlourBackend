import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { deleteCartItem, getCart, upsertCart } from '../controllers/cartController.js';
import { validateCoupon } from '../controllers/couponController.js';
import { couponsLimiter } from '../middleware/rateLimiters.js';

const router = Router();

router.use(authenticateUser);

router.get('/', getCart);
router.post('/', upsertCart);
router.delete('/:id', deleteCartItem);

// Spec-friendly aliases (items + coupon)
router.post('/items', upsertCart);
router.delete('/items/:id', deleteCartItem);
router.post('/apply-coupon', couponsLimiter, validateCoupon);

export default router;
