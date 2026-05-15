import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { myEnrollments, myLiveSessions, myRecordings } from '../controllers/userFeedController.js';

const router = Router();

router.get('/enrollments', authenticateUser, myEnrollments);
router.get('/live-sessions', authenticateUser, myLiveSessions);
router.get('/recordings', authenticateUser, myRecordings);

export default router;
