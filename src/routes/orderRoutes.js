import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { createCheckoutOrder, getMyOrder } from '../controllers/orderController.js';
import { listMyOrders } from '../controllers/userOrdersController.js';
import { verify } from '../controllers/paymentController.js';

const router = Router();

router.use(authenticateUser);

router.post('/', createCheckoutOrder);
router.post('/create', createCheckoutOrder);
router.post('/verify', verify);
router.get('/', listMyOrders);
router.get('/:id', getMyOrder);

export default router;
