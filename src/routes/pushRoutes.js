import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { subscribe, unsubscribe } from '../controllers/pushController.js';

const router = Router();
router.use(authenticateUser);

router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

export default router;

