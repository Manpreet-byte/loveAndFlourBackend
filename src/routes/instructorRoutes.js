import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';
import { instructorAnalytics, instructorDashboard, instructorEarnings, instructorStudents } from '../controllers/instructorController.js';

const router = Router();

router.use(authenticateUser, authorizeRoles('instructor', 'admin'));

router.get('/dashboard', instructorDashboard);
router.get('/analytics', instructorAnalytics);
router.get('/students', instructorStudents);
router.get('/earnings', instructorEarnings);

export default router;

