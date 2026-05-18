// In-memory mock data store. Single-instance only; resets on worker restart.

export type SizeStock = { size: number; stock: number };

export type ProductRecord = {
  id: number;
  name: string;
  price: number;
  description: string;
  sizes: SizeStock[];
  is_timesale: boolean;
  sale_price?: number;
  sale_ends_at?: string; // ISO
};

export type OrderStatus = "PENDING" | "PAID" | "FAILED";

export type OrderItem = {
  productId: number;
  productName: string;
  size: number;
  quantity: number;
  unitPrice: number;
};

export type OrderRecord = {
  id: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  paidAt?: string;
  failedAt?: string;
  failedReason?: string;
};

// --- Seed products ---
const saleEndsAt = new Date(Date.now() + 5 * 3600_000 + 47 * 60_000).toISOString();

const PRODUCTS: ProductRecord[] = [
  {
    id: 1,
    name: "클래식 화이트 티셔츠",
    price: 24000,
    description: "부드러운 코튼 소재의 베이직 화이트 티셔츠.",
    sizes: [
      { size: 240, stock: 5 },
      { size: 250, stock: 3 },
      { size: 260, stock: 0 },
      { size: 270, stock: 8 },
      { size: 280, stock: 2 },
      { size: 290, stock: 0 },
    ],
    is_timesale: true,
    sale_price: 16800,
    sale_ends_at: saleEndsAt,
  },
  {
    id: 2,
    name: "캔버스 토트백",
    price: 18500,
    description: "튼튼한 캔버스 토트백.",
    sizes: [
      { size: 240, stock: 0 },
      { size: 250, stock: 4 },
      { size: 260, stock: 6 },
      { size: 270, stock: 1 },
      { size: 280, stock: 0 },
      { size: 290, stock: 3 },
    ],
    is_timesale: true,
    sale_price: 12950,
    sale_ends_at: saleEndsAt,
  },
  {
    id: 3,
    name: "세라믹 커피 머그",
    price: 14000,
    description: "심플한 세라믹 머그컵.",
    sizes: [
      { size: 240, stock: 2 },
      { size: 250, stock: 0 },
      { size: 260, stock: 1 },
      { size: 270, stock: 0 },
      { size: 280, stock: 0 },
      { size: 290, stock: 0 },
    ],
    is_timesale: false,
  },
  {
    id: 4,
    name: "가죽 노트북",
    price: 32000,
    description: "고급 가죽 커버 노트북.",
    sizes: [
      { size: 240, stock: 7 },
      { size: 250, stock: 5 },
      { size: 260, stock: 9 },
      { size: 270, stock: 4 },
      { size: 280, stock: 6 },
      { size: 290, stock: 2 },
    ],
    is_timesale: false,
  },
  {
    id: 5,
    name: "무선 이어버드",
    price: 89000,
    description: "선명한 사운드의 무선 이어폰.",
    sizes: [
      { size: 240, stock: 0 },
      { size: 250, stock: 0 },
      { size: 260, stock: 0 },
      { size: 270, stock: 0 },
      { size: 280, stock: 0 },
      { size: 290, stock: 0 },
    ],
    is_timesale: false,
  },
  {
    id: 6,
    name: "데님 캡",
    price: 22000,
    description: "데님 소재 볼캡.",
    sizes: [
      { size: 240, stock: 4 },
      { size: 250, stock: 6 },
      { size: 260, stock: 3 },
      { size: 270, stock: 5 },
      { size: 280, stock: 2 },
      { size: 290, stock: 1 },
    ],
    is_timesale: true,
    sale_price: 15400,
    sale_ends_at: saleEndsAt,
  },
];

const ORDERS: OrderRecord[] = [];
// Reserved stock per (productId, size) — deducted optimistically when an order is placed.
const RESERVED: Map<string, number> = new Map();
const key = (pid: number, size: number) => `${pid}:${size}`;

// Naive promise-chain mutex per key — sufficient for single-instance worker.
const locks: Map<string, Promise<unknown>> = new Map();
async function withLock<T>(k: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = locks.get(k) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(k, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(k) === next) locks.delete(k);
  }
}

function stockStatus(p: ProductRecord): "재고 있음" | "재고 부족" | "품절" {
  const avail = p.sizes.reduce((s, { size, stock }) => {
    return s + Math.max(0, stock - (RESERVED.get(key(p.id, size)) ?? 0));
  }, 0);
  if (avail === 0) return "품절";
  if (avail <= 5) return "재고 부족";
  return "재고 있음";
}

function availableStock(pid: number, size: number): number {
  const p = PRODUCTS.find((x) => x.id === pid);
  if (!p) return 0;
  const s = p.sizes.find((x) => x.size === size);
  if (!s) return 0;
  return Math.max(0, s.stock - (RESERVED.get(key(pid, size)) ?? 0));
}

export function listProducts() {
  return PRODUCTS.map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    description: p.description,
    stock_status: stockStatus(p),
    is_timesale: p.is_timesale,
    sale_price: p.sale_price ?? null,
    sale_ends_at: p.sale_ends_at ?? null,
  }));
}

export function getProductDetail(id: number) {
  const p = PRODUCTS.find((x) => x.id === id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    description: p.description,
    stock_status: stockStatus(p),
    is_timesale: p.is_timesale,
    sale_price: p.sale_price ?? null,
    sale_ends_at: p.sale_ends_at ?? null,
    sizes: p.sizes.map(({ size, stock }) => ({
      size,
      stock: Math.max(0, stock - (RESERVED.get(key(p.id, size)) ?? 0)),
    })),
  };
}

export type NewOrderItem = { productId: number; size: number; quantity: number };

export async function createOrder(
  items: NewOrderItem[],
): Promise<
  | { ok: true; order: OrderRecord }
  | { ok: false; error: string; productId?: number; size?: number }
> {
  // Acquire locks for every (productId,size) in deterministic order to avoid deadlock.
  const keys = Array.from(new Set(items.map((i) => key(i.productId, i.size)))).sort();

  // Sequentially acquire locks.
  async function runWithAll(idx: number): Promise<
    | { ok: true; order: OrderRecord }
    | { ok: false; error: string; productId?: number; size?: number }
  > {
    if (idx >= keys.length) {
      // All locks held — verify stock & reserve atomically (single-threaded JS).
      for (const it of items) {
        if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
          return { ok: false, error: "잘못된 수량입니다." };
        }
        const p = PRODUCTS.find((x) => x.id === it.productId);
        if (!p) return { ok: false, error: "상품을 찾을 수 없습니다.", productId: it.productId };
        const s = p.sizes.find((x) => x.size === it.size);
        if (!s) return { ok: false, error: "해당 사이즈가 없습니다.", productId: it.productId, size: it.size };
        if (availableStock(it.productId, it.size) < it.quantity) {
          return { ok: false, error: "재고가 부족합니다.", productId: it.productId, size: it.size };
        }
      }
      // Reserve.
      const orderItems: OrderItem[] = items.map((it) => {
        const p = PRODUCTS.find((x) => x.id === it.productId)!;
        const unitPrice =
          p.is_timesale && p.sale_price ? p.sale_price : p.price;
        RESERVED.set(
          key(it.productId, it.size),
          (RESERVED.get(key(it.productId, it.size)) ?? 0) + it.quantity,
        );
        return {
          productId: it.productId,
          productName: p.name,
          size: it.size,
          quantity: it.quantity,
          unitPrice,
        };
      });
      const total = orderItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      const order: OrderRecord = {
        id: `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        items: orderItems,
        total,
        status: "PENDING",
        createdAt: new Date().toISOString(),
      };
      ORDERS.unshift(order);
      return { ok: true, order };
    }
    return withLock(keys[idx], () => runWithAll(idx + 1));
  }

  return runWithAll(0);
}

export async function processPayment(
  orderId: string,
): Promise<{ ok: true; order: OrderRecord } | { ok: false; error: string }> {
  const order = ORDERS.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
  if (order.status !== "PENDING") {
    return { ok: false, error: `이미 처리된 주문입니다 (${order.status}).` };
  }

  // Acquire locks for all involved (productId,size) pairs.
  const keys = Array.from(new Set(order.items.map((i) => key(i.productId, i.size)))).sort();

  const finalize = async (): Promise<
    { ok: true; order: OrderRecord } | { ok: false; error: string }
  > => {
    const success = Math.random() < 0.95;
    if (success) {
      // Deduct real stock, release reservation.
      for (const it of order.items) {
        const p = PRODUCTS.find((x) => x.id === it.productId)!;
        const s = p.sizes.find((x) => x.size === it.size)!;
        s.stock = Math.max(0, s.stock - it.quantity);
        const r = RESERVED.get(key(it.productId, it.size)) ?? 0;
        RESERVED.set(key(it.productId, it.size), Math.max(0, r - it.quantity));
      }
      order.status = "PAID";
      order.paidAt = new Date().toISOString();
      return { ok: true, order };
    } else {
      // Release reservation; mark failed.
      for (const it of order.items) {
        const r = RESERVED.get(key(it.productId, it.size)) ?? 0;
        RESERVED.set(key(it.productId, it.size), Math.max(0, r - it.quantity));
      }
      const reasons = [
        "카드 한도 초과",
        "결제 시간 초과",
        "잔액 부족",
        "네트워크 오류",
        "PG사 응답 오류",
      ];
      order.status = "FAILED";
      order.failedAt = new Date().toISOString();
      order.failedReason = reasons[Math.floor(Math.random() * reasons.length)];
      return { ok: true, order };
    }
  };

  async function runWithAll(idx: number): Promise<
    { ok: true; order: OrderRecord } | { ok: false; error: string }
  > {
    if (idx >= keys.length) return finalize();
    return withLock(keys[idx], () => runWithAll(idx + 1));
  }
  return runWithAll(0);
}

export function getStats() {
  const total = ORDERS.length;
  const success = ORDERS.filter((o) => o.status === "PAID").length;
  const failed = ORDERS.filter((o) => o.status === "FAILED").length;
  const settled = success + failed;
  const successRate = settled === 0 ? 0 : Math.round((success / settled) * 100);
  const recent = ORDERS.slice(0, 10).map((o) => ({
    id: o.id,
    time: o.paidAt ?? o.failedAt ?? o.createdAt,
    productName:
      o.items[0]?.productName +
      (o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""),
    status: o.status === "PAID" ? "성공" : o.status === "FAILED" ? "실패" : "대기",
    failReason: o.failedReason ?? null,
  }));
  return { total, success, failed, successRate, recent };
}
