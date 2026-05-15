import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { myRecommendations, trendingCourses } from '../controllers/recommendationsController.js';

const router = Router();

router.get('/user/recommendations', authenticateUser, myRecommendations);
router.get('/public/trending-courses', trendingCourses);

export default router;

