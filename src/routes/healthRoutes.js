import { Router } from 'express';
import { deepHealth, health, live, ready } from '../controllers/healthController.js';

const router = Router();

router.get('/', health);
router.get('/deep', deepHealth);
router.get('/live', live);
router.get('/ready', ready);

export default router;
