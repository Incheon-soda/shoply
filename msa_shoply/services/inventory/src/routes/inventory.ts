import { Router } from 'express';
import { pool } from '../db';
import { redis } from '../redis';
import { stockConflicts } from '../metrics';

const router = Router();

const STOCK_KEY = (productId: string, size: number) => `stock:${productId}:${size}`;

// Redis 키 없으면 DB에서 available 로드 후 SET NX (원자적 초기화)
async function ensureStockKey(productId: string, size: number): Promise<boolean> {
  const key = STOCK_KEY(productId, size);
  const exists = await redis.exists(key);
  if (exists) return true;

  const { rows } = await pool.query<{ available: number }>(
    `SELECT GREATEST(0, quantity - reserved)::int AS available
     FROM inventory WHERE product_id = $1 AND size = $2`,
    [productId, size],
  );
  if (!rows[0]) return false;

  // SET NX: 동시에 여러 요청이 초기화 시도해도 한 번만 적용
  await redis.set(key, rows[0].available, 'NX');
  return true;
}

// GET /inventory/:productId — 상품별 전체 사이즈 재고 조회
router.get('/:productId', async (req, res) => {
  const { productId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT size,
              quantity,
              reserved,
              GREATEST(0, quantity - reserved)::int AS available
       FROM inventory
       WHERE product_id = $1
       ORDER BY size`,
      [productId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('[GET /inventory]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /inventory/reserve — 재고 예약 (Redis DECRBY — lock 없음)
router.post('/reserve', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  const key = STOCK_KEY(productId, size);

  // 1. Redis 키 초기화 (없으면 DB에서 로드)
  const found = await ensureStockKey(productId, size);
  if (!found) {
    return res.status(404).json({ message: '해당 상품/사이즈를 찾을 수 없습니다.' });
  }

  // 2. DECRBY — atomic, lock 없음
  const remaining = await redis.decrby(key, quantity);

  if (remaining < 0) {
    // 재고 부족 — 즉시 롤백
    await redis.incrby(key, quantity);
    stockConflicts.inc();
    return res.status(409).json({
      message: '재고가 부족합니다.',
      available: remaining + quantity,
      requested: quantity,
    });
  }

  // 3. DB 예약 수량 반영 (Redis 결과 신뢰 — 정합성 유지용)
  try {
    await pool.query(
      `UPDATE inventory
       SET reserved = reserved + $1, version = version + 1
       WHERE product_id = $2 AND size = $3`,
      [quantity, productId, size],
    );
  } catch (err) {
    // DB 실패 시 Redis 롤백
    await redis.incrby(key, quantity);
    console.error('[POST /inventory/reserve] DB 업데이트 실패', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }

  return res.json({ ok: true, available: remaining });
});

// POST /inventory/deduct — 재고 실차감 (결제 성공 시 호출)
// available = quantity - reserved → deduct 시 둘 다 줄어 available 불변 → Redis 변경 없음
router.post('/deduct', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  try {
    await pool.query(
      `UPDATE inventory
       SET quantity = GREATEST(0, quantity - $1),
           reserved = GREATEST(0, reserved - $1),
           version  = version + 1
       WHERE product_id = $2 AND size = $3`,
      [quantity, productId, size],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /inventory/deduct]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /inventory/release — 예약 해제 (결제 실패 시 호출)
router.post('/release', async (req, res) => {
  const { productId, size, quantity } = req.body as {
    productId?: string; size?: number; quantity?: number;
  };

  if (!productId || size == null || !quantity || quantity <= 0) {
    return res.status(400).json({ message: '잘못된 요청입니다.' });
  }

  // 1. Redis available 복구
  const key = STOCK_KEY(productId, size);
  const keyExists = await redis.exists(key);
  if (keyExists) {
    await redis.incrby(key, quantity);
  }

  // 2. DB reserved 복구
  try {
    await pool.query(
      `UPDATE inventory
       SET reserved = GREATEST(0, reserved - $1),
           version  = version + 1
       WHERE product_id = $2 AND size = $3`,
      [quantity, productId, size],
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /inventory/release]', err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

export default router;
