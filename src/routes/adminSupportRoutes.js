import { Router } from 'express';
import { adminGetTicket, adminListTickets, adminPatchTicket, adminPostMessage, adminSupportAnalytics } from '../controllers/adminSupportController.js';

const router = Router();

router.get('/support/tickets', adminListTickets);
router.get('/support/tickets/:id', adminGetTicket);
router.post('/support/tickets/:id/messages', adminPostMessage);
router.patch('/support/tickets/:id', adminPatchTicket);
router.get('/support/analytics', adminSupportAnalytics);

export default router;

