import { Router } from 'express';
import { authenticateUser, maybeAuthenticateUser } from '../middlewares/authMiddleware.js';
import { uploadMedia, getMedia, getMediaFile, deleteMediaById, listMediaForUser } from '../controllers/mediaController.js';

const router = Router();

router.post('/upload', authenticateUser, uploadMedia);
router.get('/user/:userId', authenticateUser, listMediaForUser);
router.get('/:id', maybeAuthenticateUser, getMedia);
router.get('/:id/file', maybeAuthenticateUser, getMediaFile);
router.delete('/:id', authenticateUser, deleteMediaById);

export default router;
