import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { getUserDashboard } from '../controllers/userDashboardController.js';
import {
  completeLesson,
  getCourseProgress,
  listCourseLessons,
  listMyCoursesWithProgress,
  startLesson,
} from '../controllers/userLearningController.js';
import { getMyActivity } from '../controllers/userActivityController.js';
import { getMyCertificateForCourse, listMyCertificates } from '../controllers/userCertificateController.js';
import { getMyOrder, listMyOrders, downloadMyInvoice } from '../controllers/userOrdersController.js';
import { myRecordings } from '../controllers/userFeedController.js';
import { listNotifications, readAll, readNotification } from '../controllers/userNotificationsController.js';
import { getMyPreferences, patchMyPreferences } from '../controllers/userPreferencesController.js';
import { offlineProgressSync, offlineSync } from '../controllers/offlineSyncController.js';
import { getLiveSessionAccess } from '../controllers/liveSessionAccessController.js';

const router = Router();

router.get('/dashboard', authenticateUser, getUserDashboard);

// LMS core
router.get('/courses', authenticateUser, listMyCoursesWithProgress);
router.get('/courses/:id/lessons', authenticateUser, listCourseLessons);
router.post('/lessons/:id/start', authenticateUser, startLesson);
router.post('/lessons/:id/complete', authenticateUser, completeLesson);
router.get('/progress/:courseId', authenticateUser, getCourseProgress);
router.get('/activity', authenticateUser, getMyActivity);

// Certificates (user-only)
router.get('/certificates', authenticateUser, listMyCertificates);
router.get('/certificates/:courseId', authenticateUser, getMyCertificateForCourse);

// Orders & billing (user-only)
router.get('/orders', authenticateUser, listMyOrders);
router.get('/orders/:id', authenticateUser, getMyOrder);
router.get('/orders/:id/invoice', authenticateUser, downloadMyInvoice);

// Recordings (user-only)
router.get('/recordings', authenticateUser, myRecordings);

// Live session access (join + replay)
router.get('/live-sessions/:id/access', authenticateUser, getLiveSessionAccess);

// In-app notifications
router.get('/notifications', authenticateUser, listNotifications);
router.patch('/notifications/:id/read', authenticateUser, readNotification);
router.patch('/notifications/read-all', authenticateUser, readAll);

// Communication preferences (user-only)
router.get('/preferences', authenticateUser, getMyPreferences);
router.patch('/preferences', authenticateUser, patchMyPreferences);

// Offline learning sync (mobile/PWA)
router.get('/offline-sync', authenticateUser, offlineSync);
router.post('/offline-progress-sync', authenticateUser, offlineProgressSync);

export default router;
