import { Router } from 'express';
import { searchLimiter } from '../middleware/rateLimiters.js';
import { courseSearch, globalSearch, recipeSearch, suggestions } from '../controllers/searchController.js';

const router = Router();

router.use(searchLimiter);

router.get('/', globalSearch);
router.get('/courses', courseSearch);
router.get('/recipes', recipeSearch);
router.get('/suggestions', suggestions);

export default router;

