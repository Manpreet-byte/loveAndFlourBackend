import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { getLiveSessionAccess } from '../controllers/liveSessionAccessController.js';

const router = Router();

router.get('/:id/access', authenticateUser, getLiveSessionAccess);

export default router;

