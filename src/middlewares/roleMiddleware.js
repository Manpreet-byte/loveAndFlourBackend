export function authorizeRoles(...roles) {
  const allowed = new Set(roles);

  return function authorize(req, res, next) {
    const role = req.user?.role;
    const normalized = String(role ?? '');
    const ok =
      normalized &&
      (allowed.has(normalized) ||
        // super_admin can do anything an admin can
        (normalized === 'super_admin' && allowed.has('admin')));

    if (!ok) {
      return res.status(403).json({ error: { message: 'Forbidden' } });
    }
    return next();
  };
}
