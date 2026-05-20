import express from 'express';
import { pool } from './db';
import { redis } from './redis';
import paymentsRouter from './routes/payments';
import { register, httpDuration } from './metrics';

const app = express();
const PORT = Number(process.env.PAYMENT_PORT) || 4004;

app.use(express.json());

app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

// /payments/*        — 결제 처리
// /payments/stats    — 통계 (gateway: /api/stats → /payments/stats)
app.use('/payments', paymentsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ok', service: 'payment' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`[payment-service] :${PORT}`);
});
