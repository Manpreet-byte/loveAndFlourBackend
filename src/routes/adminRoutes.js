import { Router } from 'express';
import { authenticateUser } from '../middlewares/authMiddleware.js';
import { authorizeRoles } from '../middlewares/roleMiddleware.js';
import { bootstrapAdmin, bootstrapSuperAdmin, createAdmin, promoteAdmin } from '../controllers/adminController.js';
import { bootstrapLimiter } from '../middleware/rateLimiters.js';
import { createCourse, deleteCourse, listCourses, updateCourse } from '../controllers/courseAdminController.js';
import { createCategory, deleteCategory, listCategories } from '../controllers/categoryAdminController.js';
import { createRecipe, deleteRecipe, listRecipes, updateRecipe } from '../controllers/recipeAdminController.js';
import {
  adminDeleteCoupon,
  adminCreateCoupon,
  adminListCoupons,
  adminUpdateCoupon,
} from '../controllers/adminCouponsController.js';
import {
  adminDownloadInvoice,
  adminGetOrder,
  adminListOrders,
  adminReconcileOrder,
  adminRefundOrder,
  adminUpdateOrder,
} from '../controllers/adminOrdersController.js';
import { createLiveSession, deleteLiveSession, listLiveSessions, updateLiveSession } from '../controllers/liveSessionAdminController.js';
import { createRecording, deleteRecording, listRecordings, updateRecording } from '../controllers/recordingAdminController.js';
import { enrollUser, impersonateUser, listEnrollments, listUsers, patchEnrollment, removeEnrollment } from '../controllers/userAdminController.js';
import { createCourseLesson, deleteLesson, getLessonAdmin, listCourseLessonsAdmin, reorderCourseLessons, updateLesson } from '../controllers/lessonAdminController.js';
import { adminReactivateCertificate, adminRevokeCertificate } from '../controllers/certificateController.js';
import adminAnalyticsRoutes from './adminAnalyticsRoutes.js';
import adminCmsRoutes from './adminCmsRoutes.js';
import { auditAdminActions } from '../middleware/auditMiddleware.js';
import { adminListAuditLogs } from '../controllers/auditLogController.js';
import mediaRoutes from './mediaRoutes.js';
import { adminSystemHealth, adminSystemMetrics } from '../controllers/adminSystemController.js';
import { adminLimiter } from '../middleware/rateLimiters.js';
import adminSupportRoutes from './adminSupportRoutes.js';
import { adminCreateInstructor, adminListInstructors, adminPatchInstructor } from '../controllers/adminInstructorController.js';
import { addCourseTeamMember, listCourseTeam, patchCourseTeamMember, removeCourseTeamMember } from '../controllers/courseTeamController.js';
import { createInternalNote, listInternalNotes } from '../controllers/internalNotesController.js';
import { adminAddCourseFeedback, adminListCourseFeedback, adminSetCourseWorkflowStatus } from '../controllers/courseReviewController.js';
import { adminGetSettings, adminPatchSettings } from '../controllers/adminSettingsController.js';
import { adminCreateDiscountRule, adminDeleteDiscountRule, adminListDiscountRules, adminPatchDiscountRule } from '../controllers/discountRuleAdminController.js';
import { adminBroadcastEmail } from '../controllers/adminNotificationController.js';
import { markRecordingReady } from '../controllers/liveSessionRecordingController.js';
import { adminSendPush } from '../controllers/adminPushController.js';
import { adminEmailOutboxStats, adminListEmailOutbox, adminResendEmailOutbox } from '../controllers/adminEmailController.js';
import { adminImportLoveAndFlour } from '../controllers/importLoveAndFlourController.js';
import { adminPreviewLoveAndFlour } from '../controllers/importLoveAndFlourPreviewController.js';
import { adminGetRazorpayConfig, adminPatchRazorpayConfig } from '../controllers/adminRazorpayConfigController.js';
import { superListAdmins, superResetAdminPassword, superRevokeAdmin, superTransferSuperAdmin } from '../controllers/superAdminController.js';
import { adminCreateTag, adminDeleteTag, adminListTags } from '../controllers/tagAdminController.js';
import { adminGetCourseProgress } from '../controllers/adminCourseProgressController.js';

const router = Router();

// One-time bootstrap to create the first admin (requires ADMIN_BOOTSTRAP_SECRET).
router.post('/bootstrap', bootstrapLimiter, bootstrapAdmin);
router.post('/bootstrap/super-admin', bootstrapLimiter, bootstrapSuperAdmin);
router.post('/bootstrap/promote', bootstrapLimiter, promoteAdmin);

// Everything below is admin-only.
router.use(authenticateUser, authorizeRoles('admin'));
router.use(auditAdminActions());
router.use(adminLimiter);

// Admins can create other admins.
router.post('/admins', createAdmin);

// Super admin controls (manage admins, reset password, transfer ownership).
router.get('/super/admins', authorizeRoles('super_admin'), superListAdmins);
router.delete('/super/admins/:id', authorizeRoles('super_admin'), superRevokeAdmin);
router.post('/super/admins/:id/reset-password', authorizeRoles('super_admin'), superResetAdminPassword);
router.post('/super/transfer-super-admin', authorizeRoles('super_admin'), superTransferSuperAdmin);

// Instructors / team
router.get('/instructors', adminListInstructors);
router.post('/instructors', adminCreateInstructor);
router.patch('/instructors/:id', adminPatchInstructor);

router.get('/dashboard', (_req, res) => {
  res.json({ ok: true, scope: 'admin' });
});

// Admin configurable settings used by frontend.
router.get('/settings', adminGetSettings);
router.patch('/settings', adminPatchSettings);

// Payment provider settings (secrets stored encrypted in DB; never returned).
router.get('/payments/razorpay', adminGetRazorpayConfig);
router.patch('/payments/razorpay', adminPatchRazorpayConfig);

// Bulk discount rules (checkout engine)
router.get('/discount-rules', adminListDiscountRules);
router.post('/discount-rules', adminCreateDiscountRule);
router.patch('/discount-rules/:id', adminPatchDiscountRule);
router.delete('/discount-rules/:id', adminDeleteDiscountRule);

// Admin broadcast email (newsletter)
router.post('/notifications/broadcast', adminBroadcastEmail);
router.post('/notifications/push', adminSendPush);

// Email outbox ops
router.get('/emails/stats', adminEmailOutboxStats);
router.get('/emails/outbox', adminListEmailOutbox);
router.post('/emails/outbox/:id/resend', adminResendEmailOutbox);

// System observability (admin-only)
router.get('/system/health', adminSystemHealth);
router.get('/system/metrics', adminSystemMetrics);

// Courses
router.post('/courses', createCourse);
router.get('/courses', listCourses);
router.get('/courses/:id/progress', adminGetCourseProgress);
router.patch('/courses/:id', updateCourse);
router.delete('/courses/:id', deleteCourse);

// Course team collaboration
router.get('/courses/:id/team', listCourseTeam);
router.post('/courses/:id/team', addCourseTeamMember);
router.patch('/courses/:id/team/:memberId', patchCourseTeamMember);
router.delete('/courses/:id/team/:memberId', removeCourseTeamMember);

// Course review workflow
router.patch('/courses/:id/workflow', adminSetCourseWorkflowStatus);
router.get('/courses/:id/feedback', adminListCourseFeedback);
router.post('/courses/:id/feedback', adminAddCourseFeedback);

// Categories (type=course|recipe)
router.post('/categories', createCategory);
router.get('/categories', listCategories);
router.delete('/categories/:id', deleteCategory);

// Imports (admin-only helpers)
router.post('/imports/loveandflour', adminImportLoveAndFlour);
router.post('/imports/loveandflour/preview', adminPreviewLoveAndFlour);

// Recipes
router.post('/recipes', createRecipe);
router.get('/recipes', listRecipes);
router.patch('/recipes/:id', updateRecipe);
router.delete('/recipes/:id', deleteRecipe);

// Tags (recipes)
router.get('/tags', adminListTags);
router.post('/tags', adminCreateTag);
router.delete('/tags/:id', adminDeleteTag);

// Orders + payments ops
router.get('/orders', adminListOrders);
router.get('/orders/:id', adminGetOrder);
router.patch('/orders/:id', adminUpdateOrder);
router.post('/orders/:id/reconcile', adminReconcileOrder);
router.post('/orders/:id/refund', adminRefundOrder);
router.get('/orders/:id/invoice', adminDownloadInvoice);

// Coupons
router.get('/coupons', adminListCoupons);
router.post('/coupons', adminCreateCoupon);
router.patch('/coupons/:id', adminUpdateCoupon);
router.delete('/coupons/:id', adminDeleteCoupon);

// Live sessions (Zoom fields)
router.post('/live-sessions', createLiveSession);
router.get('/live-sessions', listLiveSessions);
router.patch('/live-sessions/:id', updateLiveSession);
router.delete('/live-sessions/:id', deleteLiveSession);
router.post('/live-sessions/:id/recording-ready', markRecordingReady);

// Recordings
router.post('/recordings', createRecording);
router.get('/recordings', listRecordings);
router.patch('/recordings/:id', updateRecording);
router.delete('/recordings/:id', deleteRecording);

// Users + enrollments
router.get('/users', listUsers);
router.post('/users/:id/impersonate', impersonateUser);
router.get('/enrollments', listEnrollments);
router.post('/enrollments', enrollUser);
router.patch('/enrollments/:id', patchEnrollment);
router.delete('/enrollments/:id', removeEnrollment);

// Lessons (LMS core)
router.post('/courses/:id/lessons', createCourseLesson);
router.get('/courses/:id/lessons', listCourseLessonsAdmin);
router.get('/lessons/:id', getLessonAdmin);
router.patch('/lessons/:id', updateLesson);
router.delete('/lessons/:id', deleteLesson);
router.put('/lessons/reorder', reorderCourseLessons);

// Certificates
router.post('/certificates/:id/revoke', adminRevokeCertificate);
router.post('/certificates/:id/reactivate', adminReactivateCertificate);

// Analytics
router.use('/analytics', adminAnalyticsRoutes);

// CMS / Content operating system
router.use('/', adminCmsRoutes);

// Support/helpdesk operating system
router.use('/', adminSupportRoutes);

// Internal notes
router.get('/internal-notes', listInternalNotes);
router.post('/internal-notes', createInternalNote);

// Media (aliases under /api/admin/media/*)
router.use('/media', mediaRoutes);

// Audit logs (admin-only)
router.get('/audit-logs', adminListAuditLogs);

export default router;
