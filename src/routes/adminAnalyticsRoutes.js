import { Router } from 'express';
import { dashboard, revenue, conversions, topCourses, ordersSummary, enrollments, course, users, retention } from '../controllers/analyticsController.js';

const router = Router();

router.get('/dashboard', dashboard);
router.get('/revenue', revenue);
router.get('/conversions', conversions);
router.get('/top-courses', topCourses);
router.get('/orders-summary', ordersSummary);
router.get('/enrollments', enrollments);
router.get('/courses/:id', course);
router.get('/users', users);
router.get('/retention', retention);

export default router;
