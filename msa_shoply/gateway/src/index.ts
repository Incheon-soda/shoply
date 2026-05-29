import express from 'express';
import jwt from 'jsonwebtoken';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { register, httpDuration } from './metrics';

const app = express();
const PORT = Number(process.env.GATEWAY_PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

// ── 서비스 URL ────────────────────────────────────────────────
const SVC = {
  user:      process.env.USER_SERVICE_URL      || 'http://localhost:4005',
  product:   process.env.PRODUCT_SERVICE_URL   || 'http://localhost:4001',
  inventory: process.env.INVENTORY_SERVICE_URL || 'http://localhost:4002',
  order:     process.env.ORDER_SERVICE_URL     || 'http://localhost:4003',
  payment:   process.env.PAYMENT_SERVICE_URL   || 'http://localhost:4004',
};

// ── JWT 검증 + X-User 헤더 주입 — /api/auth 제외 전체 적용 ──
app.use('/api', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path.startsWith('/auth')) return next();

  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ message: '인증이 필요합니다.' });
  }
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: string; email: string };
    req.headers['x-user-id']    = decoded.userId;
    req.headers['x-user-email'] = decoded.email;
    next();
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
});

// ── Prometheus ────────────────────────────────────────────────
// route 라벨은 /api/{service} 수준으로 정규화 — UUID 포함 시 고카디널리티 방지
function normalizeGatewayRoute(path: string): string {
  const m = path.match(/^(\/api\/[^/]+)/);
  return m ? m[1] : path;
}

app.use((req, res, next) => {
  const route = normalizeGatewayRoute(req.path);
  const end = httpDuration.startTimer({ method: req.method, route });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

// ── 라우팅 ────────────────────────────────────────────────────

// 1차: User Service — /api/auth/*
app.use('/api/auth', createProxyMiddleware({
  target: SVC.user,
  changeOrigin: true,
  pathRewrite: { '^': '/auth' },  // Express strips '/api/auth' → '/login', prepend '/auth' → '/auth/login'
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'User Service unavailable' }) },
}));

// 2차: Product Service — /api/products/*
app.use('/api/products', createProxyMiddleware({
  target: SVC.product,
  changeOrigin: true,
  pathRewrite: { '^': '/products' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Product Service unavailable' }) },
}));

// 3차: Inventory Service — /api/inventory/*
app.use('/api/inventory', createProxyMiddleware({
  target: SVC.inventory,
  changeOrigin: true,
  pathRewrite: { '^': '/inventory' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Inventory Service unavailable' }) },
}));

// 4차: Order Service — /api/orders/*
app.use('/api/orders', createProxyMiddleware({
  target: SVC.order,
  changeOrigin: true,
  pathRewrite: { '^': '/orders' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Order Service unavailable' }) },
}));

// 5차: Payment Service — /api/payments/*, /api/stats
app.use('/api/payments', createProxyMiddleware({
  target: SVC.payment,
  changeOrigin: true,
  pathRewrite: { '^': '/payments' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Payment Service unavailable' }) },
}));
app.use('/api/stats', createProxyMiddleware({
  target: SVC.payment,
  changeOrigin: true,
  pathRewrite: { '^': '/payments/stats' },
  on: { error: (_err, _req, res) => (res as express.Response).status(503).json({ message: 'Payment Service unavailable' }) },
}));

// ── 미등록 서비스 요청 → 503 ──────────────────────────────────
app.use('/api', (_req, res) => {
  res.status(503).json({ message: 'Service not available yet' });
});

// ── 헬스체크 / 메트릭 ────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'gateway' }));

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`[gateway] :${PORT}`);
  console.log(`  /api/auth  → ${SVC.user}`);
});

