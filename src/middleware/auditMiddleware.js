import { getRequestAuditContext, logAuditEvent } from '../services/auditLogService.js';

export function auditAdminActions() {
  return function auditAdmin(req, res, next) {
    const started = Date.now();
    res.on('finish', () => {
      const actor = req.user;
      const ctx = getRequestAuditContext(req);
      logAuditEvent({
        actorType: 'admin',
        actorId: actor?.id ?? null,
        actionType: 'ADMIN_REQUEST',
        entityType: null,
        entityId: null,
        statusCode: res.statusCode,
        ...ctx,
        metadata: {
          duration_ms: Date.now() - started,
        },
      });
    });
    next();
  };
}

