import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { getProfile, updateProfile } from '../controllers/profileController.js';

const router = Router();

router.get('/', authenticateUser, getProfile);
router.patch('/', authenticateUser, updateProfile);

export default router;
