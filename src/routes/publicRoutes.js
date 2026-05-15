import { Router } from 'express';
import {
  getPublicCourseBySlug,
  getPublicRecipeBySlug,
  getPublicWorkshopBySlug,
  listPublicCategories,
  listPublicCourses,
  listPublicRecipes,
  listPublicWorkshops,
} from '../controllers/publicContentController.js';
import { getPublicLiveSessionBySlug, listPublicLiveSessions } from '../controllers/liveSessionPublicController.js';

const router = Router();

router.get('/courses', listPublicCourses);
router.get('/courses/:slug', getPublicCourseBySlug);
router.get('/workshops', listPublicWorkshops);
router.get('/workshops/:slug', getPublicWorkshopBySlug);
router.get('/recipes', listPublicRecipes);
router.get('/recipes/:slug', getPublicRecipeBySlug);
router.get('/categories', listPublicCategories);
router.get('/live-sessions', listPublicLiveSessions);
router.get('/live-sessions/:slug', getPublicLiveSessionBySlug);

export default router;
