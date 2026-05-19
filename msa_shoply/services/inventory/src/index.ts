import express from 'express';
import { pool } from './db';
import inventoryRouter from './routes/inventory';
import { register, httpDuration } from './metrics';

const app = express();
const PORT = Number(process.env.INVENTORY_PORT) || 4002;

app.use(express.json());

app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

app.use('/inventory', inventoryRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'inventory' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`[inventory-service] :${PORT}`);
});

