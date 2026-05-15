import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './utils/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { generalApiLimiter } from './middleware/rateLimiters.js';
import { requestContext } from './middleware/requestContext.js';
import { httpLogger } from './middleware/httpLogger.js';
import { metricsMiddleware } from './middleware/metricsMiddleware.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import userFeedRoutes from './routes/userFeedRoutes.js';
import publicRoutes from './routes/publicRoutes.js';
import cmsPublicRoutes from './routes/cmsPublicRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import certificateRoutes from './routes/certificateRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import { live as liveHandler, ready as readyHandler } from './controllers/healthController.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import questionsRoutes from './routes/questionsRoutes.js';
import pushRoutes from './routes/pushRoutes.js';
import recommendationRoutes from './routes/recommendationRoutes.js';
import instructorRoutes from './routes/instructorRoutes.js';
import liveSessionRoutes from './routes/liveSessionRoutes.js';
import { metricsText } from './services/metricsService.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy', true);
app.disable('x-powered-by');
// Helmet defaults can interfere with third-party checkout popups (e.g., Razorpay)
// due to strict COOP/COEP policies. Keep strong defaults while allowing popups.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }),
);
app.use(requestContext);
// Webhooks need the raw body for signature verification.
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
  cors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  }),
);
app.use(httpLogger);
app.use(metricsMiddleware());
app.use(generalApiLimiter);

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'love-and-flour-backend' });
});

// Kubernetes-style probes (aliases for convenience)
app.get('/live', liveHandler);
app.get('/ready', readyHandler);

app.use('/health', healthRoutes);

if (env.METRICS_ENABLED) {
  app.get('/metrics', async (req, res) => {
    if (env.METRICS_TOKEN) {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\\s+/i, '');
      if (token !== env.METRICS_TOKEN) return res.status(401).json({ error: { message: 'Unauthorized' } });
    } else if (env.NODE_ENV === 'production') {
      return res.status(404).json({ ok: false });
    }

    const text = await metricsText();
    res.setHeader('content-type', 'text/plain; version=0.0.4');
    return res.send(text);
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/public', cmsPublicRoutes);
app.use('/api/user', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/feed', userFeedRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/media', mediaRoutes);

// If a user navigates to protected API endpoints directly in a browser tab,
// redirect them to the frontend app instead of showing a confusing JSON auth error.
// (Does not affect XHR/fetch calls which send `Accept: application/json`.)
app.get('/api/orders', (req, res, next) => {
  const accept = String(req.headers.accept ?? '');
  if (!accept.includes('text/html')) return next();
  const base = String(env.PUBLIC_WEB_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return next();
  return res.redirect(`${base}/orders`);
});

app.get('/api/payments/checkout', (req, res, next) => {
  const accept = String(req.headers.accept ?? '');
  if (!accept.includes('text/html')) return next();
  const base = String(env.PUBLIC_WEB_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!base) return next();
  return res.redirect(`${base}/checkout`);
});
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api', communityRoutes);
app.use('/api/live-sessions', liveSessionRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/user/push', pushRoutes);
app.use('/api', recommendationRoutes);
app.use('/api/instructor', instructorRoutes);

// Optional: serve the production frontend build from this backend (AWS single-instance deploy).
if (env.SERVE_FRONTEND) {
  const dist =
    String(env.FRONTEND_DIST_PATH ?? '').trim() ||
    path.resolve(__dirname, '../../frontend/loveAndFlour/dist');
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    const p = String(req.path ?? '');
    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/health') || p.startsWith('/metrics')) return next();
    return res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) return next();
    });
  });
}

app.use(notFound);
app.use(errorHandler);

export default app;
