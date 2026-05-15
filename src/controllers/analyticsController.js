import { z } from 'zod';
import {
  getConversionAnalytics,
  getCourseAnalytics,
  getDashboardAnalytics,
  getEnrollmentAnalytics,
  getOrdersSummaryAnalytics,
  getRevenueAnalytics,
  getRetentionAnalytics,
  getTopCoursesAnalytics,
  getUserAnalytics,
} from '../services/analyticsService.js';

const rangeSchema = z.object({
  from: z.string().optional().nullable(),
  to: z.string().optional().nullable(),
});

export async function dashboard(req, res, next) {
  try {
    const data = await getDashboardAnalytics();
    return res.json({ dashboard: data });
  } catch (err) {
    return next(err);
  }
}

export async function revenue(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getRevenueAnalytics({ from, to });
    return res.json({ revenue: data });
  } catch (err) {
    return next(err);
  }
}

export async function conversions(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getConversionAnalytics({ from, to });
    return res.json({ conversions: data });
  } catch (err) {
    return next(err);
  }
}

export async function topCourses(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getTopCoursesAnalytics({ from, to });
    return res.json({ top_courses: data });
  } catch (err) {
    return next(err);
  }
}

export async function ordersSummary(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getOrdersSummaryAnalytics({ from, to });
    return res.json({ orders_summary: data });
  } catch (err) {
    return next(err);
  }
}

export async function enrollments(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getEnrollmentAnalytics({ from, to });
    return res.json({ enrollments: data });
  } catch (err) {
    return next(err);
  }
}

export async function course(req, res, next) {
  try {
    const courseId = Number(req.params.id);
    if (!Number.isFinite(courseId) || courseId <= 0) return res.status(400).json({ error: { message: 'Invalid course id' } });
    const data = await getCourseAnalytics({ courseId });
    return res.json({ course: data });
  } catch (err) {
    return next(err);
  }
}

export async function users(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getUserAnalytics({ from, to });
    return res.json({ users: data });
  } catch (err) {
    return next(err);
  }
}

export async function retention(req, res, next) {
  try {
    const { from, to } = rangeSchema.parse(req.query);
    const data = await getRetentionAnalytics({ from, to });
    return res.json({ retention: data });
  } catch (err) {
    return next(err);
  }
}
