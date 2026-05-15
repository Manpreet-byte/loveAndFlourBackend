import { z } from 'zod';
import { createDiscountRule, deleteDiscountRule, listDiscountRules, updateDiscountRule } from '../models/discountRuleModel.js';
import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

const createSchema = z.object({
  min_courses: z.coerce.number().int().min(1).max(1000),
  max_courses: z.coerce.number().int().min(1).max(1000).optional().nullable(),
  discount_percent: z.coerce.number().min(0).max(100),
  is_active: z.coerce.boolean().optional().default(true),
});

const patchSchema = createSchema.partial();

export async function adminListDiscountRules(_req, res, next) {
  try {
    const rules = await listDiscountRules({ includeInactive: true });
    return res.json({ rules });
  } catch (err) {
    return next(err);
  }
}

export async function adminCreateDiscountRule(req, res, next) {
  try {
    const payload = createSchema.parse(req.body ?? {});
    if (payload.max_courses != null && payload.max_courses < payload.min_courses) {
      return res.status(400).json({ error: { message: 'max_courses must be >= min_courses' } });
    }
    const id = await createDiscountRule({
      minCourses: payload.min_courses,
      maxCourses: payload.max_courses ?? null,
      discountPercent: payload.discount_percent,
      isActive: payload.is_active,
    });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'DISCOUNT_RULE_CREATE',
      entityType: 'discount_rule',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 201,
    });

    return res.status(201).json({ id });
  } catch (err) {
    return next(err);
  }
}

export async function adminPatchDiscountRule(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid rule id' } });
    const patch = patchSchema.parse(req.body ?? {});
    if (patch.max_courses != null && patch.min_courses != null && patch.max_courses < patch.min_courses) {
      return res.status(400).json({ error: { message: 'max_courses must be >= min_courses' } });
    }
    await updateDiscountRule({
      id,
      patch: {
        minCourses: patch.min_courses,
        maxCourses: patch.max_courses,
        discountPercent: patch.discount_percent,
        isActive: patch.is_active,
      },
    });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'DISCOUNT_RULE_UPDATE',
      entityType: 'discount_rule',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function adminDeleteDiscountRule(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: { message: 'Invalid rule id' } });
    await deleteDiscountRule({ id });

    logAuditEvent({
      actorType: 'admin',
      actorId: req.user.id,
      actionType: 'DISCOUNT_RULE_DELETE',
      entityType: 'discount_rule',
      entityId: id,
      ...getRequestAuditContext(req),
      statusCode: 200,
    });

    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

