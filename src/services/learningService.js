import { z } from 'zod';
import { withTransaction } from '../utils/dbTx.js';
import { assertActiveEnrollment } from './accessControlService.js';
import { getLessonById, listLessonsForCourse } from '../models/lessonModel.js';
import {
  getCourseProgressSummary,
  listLessonProgressForCourse,
  markLessonCompleted,
  upsertLessonProgress,
  upsertLessonStarted,
} from '../models/progressModel.js';
import { issueCertificateOnCompletion } from './certificateService.js';
import { trackEvent } from './analyticsEventService.js';
import { logAuditEvent } from './auditLogService.js';
import { notifyUser } from './notificationService.js';

const startSchema = z.object({
  progress_percentage: z.coerce.number().int().min(0).max(100).optional().nullable(),
  last_position_seconds: z.coerce.number().int().min(0).max(24 * 60 * 60).optional().nullable(),
});

export function parseStartPayload(body) {
  return startSchema.parse(body ?? {});
}

export async function getCourseLessonsForUser({ userId, courseId }) {
  await assertActiveEnrollment({ userId, courseId });
  const lessons = await listLessonsForCourse({ courseId, includeDrafts: false });
  const progress = await listLessonProgressForCourse({ userId, courseId });
  const byLesson = new Map(progress.map((p) => [Number(p.lesson_id), p]));
  return lessons.map((l) => ({
    ...l,
    progress: byLesson.get(Number(l.id)) ?? null,
  }));
}

export async function startLessonForUser({ userId, lessonId, progressPercentage, lastPositionSeconds, auditContext = null }) {
  return withTransaction(async (conn) => {
    const lesson = await getLessonById({ lessonId, includeDrafts: false }, { conn });
    if (!lesson) {
      const err = new Error('Lesson not found');
      err.status = 404;
      throw err;
    }

    await assertActiveEnrollment({ userId, courseId: lesson.course_id }, { conn });
    await upsertLessonStarted({ userId, courseId: lesson.course_id, lessonId }, { conn });
    await trackEvent({
      userId,
      eventType: 'lesson_started',
      entityType: 'lesson',
      entityId: lessonId,
      metadata: { course_id: lesson.course_id },
    });
    logAuditEvent({
      actorType: 'user',
      actorId: userId,
      actionType: 'LESSON_START',
      entityType: 'lesson',
      entityId: lessonId,
      ...(auditContext ?? {}),
      statusCode: 200,
      metadata: { course_id: lesson.course_id },
    });

    if (progressPercentage != null || lastPositionSeconds != null) {
      // Keep logic simple: update progress if provided (without allowing regressions).
      const pct = progressPercentage == null ? 0 : Number(progressPercentage);
      await upsertLessonProgress(
        { userId, courseId: lesson.course_id, lessonId, progressPercentage: pct, lastPositionSeconds },
        { conn },
      );
    }

    return { courseId: lesson.course_id };
  });
}

export async function completeLessonForUser({ userId, lessonId, auditContext = null }) {
  return withTransaction(async (conn) => {
    const lesson = await getLessonById({ lessonId, includeDrafts: false }, { conn });
    if (!lesson) {
      const err = new Error('Lesson not found');
      err.status = 404;
      throw err;
    }

    await assertActiveEnrollment({ userId, courseId: lesson.course_id }, { conn });
    await markLessonCompleted({ userId, courseId: lesson.course_id, lessonId }, { conn });
    await trackEvent({
      userId,
      eventType: 'lesson_completed',
      entityType: 'lesson',
      entityId: lessonId,
      metadata: { course_id: lesson.course_id },
    });
    logAuditEvent({
      actorType: 'user',
      actorId: userId,
      actionType: 'LESSON_COMPLETE',
      entityType: 'lesson',
      entityId: lessonId,
      ...(auditContext ?? {}),
      statusCode: 200,
      metadata: { course_id: lesson.course_id },
    });

    const summary = await getCourseProgressSummary({ userId, courseId: lesson.course_id }, { conn });

    // In-app notification: lesson completed.
    notifyUser(
      {
        userId,
        notificationType: 'lesson_completed',
        title: 'Lesson completed',
        message: `You completed "${lesson.title}".`,
        linkUrl: null,
        metadata: { course_id: lesson.course_id, lesson_id: lessonId },
      },
      { conn },
    ).catch(() => null);

    if (summary.isCompleted) {
      await issueCertificateOnCompletion({ conn, userId, courseId: lesson.course_id });
      await trackEvent({
        userId,
        eventType: 'course_completed',
        entityType: 'course',
        entityId: lesson.course_id,
      });
      await trackEvent({
        userId,
        eventType: 'certificate_issued',
        entityType: 'course',
        entityId: lesson.course_id,
      });
      logAuditEvent({
        actorType: 'user',
        actorId: userId,
        actionType: 'COURSE_COMPLETE',
        entityType: 'course',
        entityId: lesson.course_id,
        ...(auditContext ?? {}),
        statusCode: 200,
      });
      logAuditEvent({
        actorType: 'system',
        actorId: null,
        actionType: 'CERTIFICATE_ISSUED',
        entityType: 'course',
        entityId: lesson.course_id,
        ...(auditContext ?? {}),
        statusCode: 200,
        metadata: { user_id: userId },
      });

      // In-app notification: certificate issued.
      notifyUser(
        {
          userId,
          notificationType: 'certificate_issued',
          title: 'Certificate unlocked',
          message: 'Congratulations! Your course certificate is now available.',
          linkUrl: '/certificates',
          metadata: { course_id: lesson.course_id },
        },
        { conn },
      ).catch(() => null);
    }
    return { courseId: lesson.course_id, summary };
  });
}

export async function getCourseProgressForUser({ userId, courseId }) {
  await assertActiveEnrollment({ userId, courseId });
  const [lessons, summary, progress] = await Promise.all([
    listLessonsForCourse({ courseId, includeDrafts: false }),
    getCourseProgressSummary({ userId, courseId }),
    listLessonProgressForCourse({ userId, courseId }),
  ]);
  return { lessons, summary, progress };
}
