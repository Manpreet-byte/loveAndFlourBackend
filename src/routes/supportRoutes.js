import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { createMyTicket, getMyTicket, listMyTickets, postMyTicketMessage } from '../controllers/supportController.js';

const router = Router();

router.use(authenticateUser);

router.get('/tickets', listMyTickets);
router.post('/tickets', createMyTicket);
router.get('/tickets/:id', getMyTicket);
router.post('/tickets/:id/messages', postMyTicketMessage);

export default router;

