import { createFileRoute } from "@tanstack/react-router";

type Reason = "INSUFFICIENT_STOCK" | "PAYMENT_GATEWAY_ERROR" | "TIMEOUT" | null;
type RecentOrder = {
  time: string;
  product: string;
  size: string;
  status: "SUCCESS" | "FAILED";
  reason: Reason;
};

const PRODUCTS = [
  "클래식 화이트 티셔츠",
  "데님 캡",
  "캔버스 토트백",
  "세라믹 머그",
  "가죽 노트북",
  "무선 이어버드",
  "울 양말 3팩",
  "스테인리스 보틀",
];
const SIZES = ["240", "250", "260", "270", "280", "290", "FREE"];
const REASONS: Exclude<Reason, null>[] = [
  "INSUFFICIENT_STOCK",
  "PAYMENT_GATEWAY_ERROR",
  "TIMEOUT",
];

// In-memory rolling state (per worker instance). Persists between requests
// while the runtime stays warm; resets on cold start. Good enough for mock.
let total = 0;
let success = 0;
let failed = 0;
const recent: RecentOrder[] = [];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tick() {
  const burst = 1 + Math.floor(Math.random() * 4); // 1-4 new orders per call
  for (let i = 0; i < burst; i++) {
    const isSuccess = Math.random() < 0.78;
    const order: RecentOrder = {
      time: new Date().toISOString(),
      product: pick(PRODUCTS),
      size: pick(SIZES),
      status: isSuccess ? "SUCCESS" : "FAILED",
      reason: isSuccess ? null : pick(REASONS),
    };
    recent.unshift(order);
    total += 1;
    if (isSuccess) success += 1;
    else failed += 1;
  }
  if (recent.length > 30) recent.length = 30;
}

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async () => {
        tick();
        const rate = total === 0 ? 0 : Math.round((success / total) * 100);
        return Response.json({
          total,
          success,
          failed,
          rate,
          recent: recent.slice(0, 15),
        });
      },
    },
  },
});
