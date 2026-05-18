# MSA 구조 설계

---

## 폴더 구조

```
shopping_k8s/
├── frontend/           # Vite + React SPA (순수 SPA, SSR 제거)
├── gateway/            # Express.js API Gateway
├── services/
│   ├── product/        # 상품 조회 + Redis 캐싱
│   ├── inventory/      # 재고 관리 + 동시성 처리
│   ├── order/          # 주문 생성/조회
│   ├── payment/        # 결제 처리 + 통계
│   └── user/           # Mock 로그인 / JWT
├── k8s/                # Kubernetes 매니페스트
│   ├── frontend/
│   ├── gateway/
│   └── services/
├── shoply/             # 기존 모노리스 (참고용 보존)
└── README.md
```

---

## 각 서비스 역할 & API

| 서비스 | 포트 | 엔드포인트 | 비고 |
|---|:---:|---|---|
| **frontend** | 3000 | — | Nginx로 정적 파일 서빙 |
| **gateway** | 4000 | `/api/*` 전체 라우팅 | JWT 검증 미들웨어 |
| **product** | 4001 | `GET /products`, `GET /products/:id` | Redis 캐싱 |
| **inventory** | 4002 | `GET /inventory/:productId`, `POST /reserve`, `POST /deduct`, `POST /release` | SELECT FOR UPDATE |
| **order** | 4003 | `POST /orders`, `GET /orders/:id`, `PATCH /orders/:id/status` | |
| **payment** | 4004 | `POST /payments`, `GET /stats` | Mock 결제 95% 성공률 |
| **user** | 4005 | `POST /auth/login`, `GET /auth/me` | Mock JWT |

---

## 서비스 간 통신 흐름

```
[Frontend]
    └─ 모든 요청 → [API Gateway :4000]
                        ├─ /api/products/*  → Product Service  :4001
                        ├─ /api/inventory/* → Inventory Service :4002
                        ├─ /api/orders/*    → Order Service    :4003
                        ├─ /api/payments/*  → Payment Service  :4004
                        └─ /api/auth/*      → User Service     :4005

[Order Service]   ──── POST /reserve ────→ [Inventory Service]
[Payment Service] ─ 결제성공 → POST /deduct  → [Inventory Service]
                  └ 결제실패 → POST /release → [Inventory Service]
[Payment Service] ──── PATCH /:id/status ──→ [Order Service]
```

---

## DB 스키마 (PostgreSQL)

서비스별로 논리적 소유권을 나눔. 물리적으로는 PostgreSQL 인스턴스 하나 공유.

```sql
-- product 서비스 소유
products    (id, name, price, description, is_timesale, sale_price, sale_ends_at)

-- inventory 서비스 소유
inventory   (id, product_id, size, stock)

-- order 서비스 소유
orders      (id, status, total, created_at, paid_at, failed_at, failed_reason)
order_items (id, order_id, product_id, product_name, size, quantity, unit_price)

-- payment 서비스 소유
payments    (id, order_id, method, status, created_at)

-- user 서비스 소유
users       (id, email, name, created_at)
```

---

## 기술 스택

| 항목 | 선택 |
|---|---|
| 서비스 런타임 | Node.js 22 + Express.js + TypeScript |
| 프론트엔드 | Vite + React + TanStack Router (SPA) |
| DB 클라이언트 | `pg` (node-postgres) |
| Redis 클라이언트 | `ioredis` (product 서비스만) |
| 메트릭 수집 | `prom-client` (전 서비스) |
| 패키지 매니저 | npm (백엔드 서비스 전체 통일) |

---

## 개발 환경 포트 정리

| 서비스 | 로컬 포트 |
|---|:---:|
| frontend | 3000 |
| gateway | 4000 |
| product | 4001 |
| inventory | 4002 |
| order | 4003 |
| payment | 4004 |
| user | 4005 |
| PostgreSQL | 5432 |
| Redis | 6379 |

---

## 배포 단계 (README 기준)

| 단계 | 포함 서비스 | 확인 항목 |
|:---:|---|---|
| 1차 | PostgreSQL, Redis, user, gateway, frontend | 로그인 / JWT / 페이지 렌더링 |
| 2차 | + product | 상품 목록 / 상세 / Redis 캐싱 |
| 3차 | + inventory | 재고 조회 / 차감 / 동시성 |
| 4차 | + order | 주문 생성 / 재고 선점 |
| 5차 | + payment | 결제 / 전체 흐름 |
