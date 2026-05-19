import express from 'express';
import { pool } from './db';
import authRouter from './routes/auth';
import { register, httpDuration } from './metrics';


const app = express();
const PORT = Number(process.env.USER_PORT) || 4005;

app.use(express.json());

app.use((req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => end({ status: String(res.statusCode) }));
  next();
});

app.use('/auth', authRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'user' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`[user-service] :${PORT}`);
});

