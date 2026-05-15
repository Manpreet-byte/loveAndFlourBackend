import { Router } from 'express';
import { verifyCertificate } from '../controllers/certificateController.js';

const router = Router();

// Public verification endpoint (no auth)
router.get('/verify/:code', verifyCertificate);

export default router;

