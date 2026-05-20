import express from 'express';
import { pool } from './db';
import { redis } from './redis';
import productsRouter from './routes/products';
import { register, httpDuration } from './metrics';

// UUID → :id 정규화로 route 라벨 고카디널리티 방지
function normalizeRoute(path: string): string {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
}

const app = express();
const PORT = Number(process.env.PRODUCT_PORT) || 4001;

app.use(express.json());

app.use((req, res, next) => {
  const route = normalizeRoute(req.path);
  const end = httpDuration.startTimer({ method: req.method, route });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

app.use('/products', productsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', service: 'product' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`[product-service] :${PORT}`);
});

