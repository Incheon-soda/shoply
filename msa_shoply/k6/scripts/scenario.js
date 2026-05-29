import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

// 20개 상품으로 분산 → SELECT FOR UPDATE lock 경합 줄임
const PRODUCTS = [
  '86f68efd-84f7-4630-9c50-4133f95cc67d',
  '311362ee-0a57-4775-bd3f-648a732f5531',
  '5bb32797-8f48-43e9-a883-f610e0aa4641',
  '7fe0aeac-7db0-4e6d-9c33-3086b563c6e4',
  '4f553095-66bd-49af-9737-8cb535fdee9f',
  '8d23364d-58e9-4c89-a216-1c7dfb1623c5',
  '2c7088d7-d7d2-4cd3-9116-36df13064fa6',
  '67881ad7-21e2-4c11-a5ac-61712c4d9f16',
  'd381b9a2-ae14-4e05-8aea-6c8520141b34',
  '6bd56564-d9b5-4e4a-b38d-6c892f2b3a4f',
  'a3e37a1b-86cf-4391-aa71-7f453f9ee844',
  'b66c42b2-1e9c-4591-b2d4-e1cf00a94b64',
  '018dc528-8d39-4129-8d70-73bd03edda26',
  '70a6e8b4-a8ff-49c1-9047-d3a06e569464',
  '70454e30-c868-41c5-8e30-8608cce7d563',
  'fe03aab0-8c29-4b8b-a286-52686420c959',
  '0fb80662-7c19-4ae9-8031-2e134fc52aca',
  '3f2b6696-cc02-4769-a0f0-09a780ceeeca',
  'a0ad92e7-29e6-419c-a576-6c8c6234beb4',
  '157192dd-1412-4afe-9ec7-cfdda556d25e',
];

// ── 시나리오 구성 ─────────────────────────────────────────────
// 10개 웨이브 × 200명 = 총 2000명
// 계정: test1~test2000@shoply.com / Test1234!
export const options = {
  scenarios: {
    wave_A: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '0s',  tags: { wave: 'A' } },
    wave_B: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '1m',  tags: { wave: 'B' } },
    wave_C: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '2m',  tags: { wave: 'C' } },
    wave_D: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '3m',  tags: { wave: 'D' } },
    wave_E: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '4m',  tags: { wave: 'E' } },
    wave_F: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '5m',  tags: { wave: 'F' } },
    wave_G: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '6m',  tags: { wave: 'G' } },
    wave_H: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '7m',  tags: { wave: 'H' } },
    wave_I: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '8m',  tags: { wave: 'I' } },
    wave_J: { executor: 'constant-vus', vus: 200, duration: '5m', startTime: '9m',  tags: { wave: 'J' } },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.3'],
  },
};

export default function () {

  // ── 1. 홈페이지 접속 ────────────────────────────────────────
  const homeRes = http.get(`${BASE_URL}/`);
  check(homeRes, { '홈 200': (r) => r.status === 200 });

  // ── 2. 로그인 (test1~2000 랜덤) ──────────────────────────────
  const n = Math.floor(Math.random() * 2000) + 1;
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: `test${n}@shoply.com`, password: 'Test1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(loginRes, { '로그인 200': (r) => r.status === 200 });

  if (loginRes.status !== 200) return;

  const token = loginRes.json('token');
  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  // ── 3. 상품 페이지 접속 ──────────────────────────────────────
  const productId = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const productRes = http.get(`${BASE_URL}/api/products/${productId}`, authHeaders);
  check(productRes, { '상품 200': (r) => r.status === 200 });

  if (productRes.status !== 200) return;

  const product = productRes.json();
  const availableSizes = product.sizes ? product.sizes.filter((s) => s.available > 0) : [];

  if (availableSizes.length === 0) return;

  const selectedSize = availableSizes[Math.floor(Math.random() * availableSizes.length)];

  // ── 4. 주문 생성 ──────────────────────────────────────────────
  const orderRes = http.post(
    `${BASE_URL}/api/orders`,
    JSON.stringify({
      items: [{ productId, size: selectedSize.size, quantity: 1 }],
    }),
    authHeaders,
  );
  check(orderRes, { '주문 201': (r) => r.status === 201 });

  if (orderRes.status !== 201) return;

  const orderId = orderRes.json('orderId');

  // ── 5. 결제 ───────────────────────────────────────────────────
  const paymentRes = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({
      orderId,
      method: 'CARD',
      delivery: { name: 'a', phone: 'a', address: 'a' },
    }),
    authHeaders,
  );
  check(paymentRes, {
    '결제 200': (r) => r.status === 200,
    '결제 처리됨': (r) => {
      try { return ['PAID', 'FAILED'].includes(r.json('status')); }
      catch { return false; }
    },
  });
}