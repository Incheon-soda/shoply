# DB 검증 가이드

> 작업 디렉토리: `shopping_k8s/msa_shoply/`

---

## 목차

- [0. 빠른 체크리스트](#0-빠른-체크리스트)
- [1. 사전 준비](#1-사전-준비)
- [2. PostgreSQL + Redis 기동](#2-postgresql--redis-기동)
- [3. 초기화 로그 확인](#3-초기화-로그-확인)
- [4. 데이터 건수 검증](#4-데이터-건수-검증)
- [5. 데이터 상세 검증](#5-데이터-상세-검증)
- [6. Redis 검증](#6-redis-검증)
- [7. 데이터 초기화 방법](#7-데이터-초기화-방법)
- [8. 종료](#8-종료)
- [트러블슈팅](#트러블슈팅)

---

## 0. 빠른 체크리스트

실험 전 반드시 모두 통과해야 한다.

```
□ msa_postgres  — Up (healthy)
□ msa_redis     — Up (healthy)
□ users         — 1,011건
□ products      — 500건
□ inventory     — 3,500건
□ reserved      — 전부 0 (선점 없음)
□ 한글 이메일   — 0건
□ Redis ping    — PONG
□ Redis dbsize  — 0 (서비스 기동 전)
```

---

## 1. 사전 준비

### seed.sql 파일 확인

```bash
ls -lh msa_shoply/db/seed.sql
ls -lh msa_shoply/db/test_accounts.txt
```

두 파일이 모두 있어야 한다. 없으면 아래 명령으로 시드 먼저 생성:

```bash
cd msa_shoply/db
npm install
node generate-seed.js
cd ../..
```

---

## 2. PostgreSQL + Redis 기동

```bash
cd msa_shoply
docker compose up -d postgres redis
```

기동 후 상태 확인:

```bash
docker compose ps
```

**정상 상태:**

```
NAME           IMAGE                STATUS
msa_postgres   postgres:16-alpine   Up (healthy)
msa_redis      redis:7-alpine       Up (healthy)
```

> PostgreSQL이 처음 뜰 때 `docker-entrypoint-initdb.d/` 안의 SQL을 자동 실행한다.
> 적용 순서: `01_schema.sql` (테이블 생성) → `02_seed.sql` (데이터 삽입)
>
> **주의:** 볼륨이 이미 존재하면 `initdb` 스크립트는 재실행되지 않는다.
> 데이터를 새로 넣으려면 [7. 데이터 초기화 방법](#7-데이터-초기화-방법) 참고.

---

## 3. 초기화 로그 확인

```bash
docker logs msa_postgres 2>&1 | grep -iE "(seed|schema|error|fatal)"
```

**정상:** 에러 없이 조용히 종료
**비정상:** `ERROR` / `FATAL` 메시지 → 트러블슈팅 섹션 참고

전체 로그를 보고 싶으면:

```bash
docker logs msa_postgres 2>&1 | tail -30
```

---

## 4. 데이터 건수 검증

### psql 접속

```bash
# 컨테이너 내부에서 접속
docker exec -it msa_postgres psql -U shoply -d shoply

# 로컬 psql이 설치된 경우
psql -h localhost -p 5432 -U shoply -d shoply
# 비밀번호: shoply1234
```

### 전체 테이블 건수 한 번에 확인

```sql
SELECT tbl, cnt FROM (
  SELECT 'users'       AS tbl, COUNT(*) AS cnt FROM users       UNION ALL
  SELECT 'products',                COUNT(*)        FROM products    UNION ALL
  SELECT 'inventory',               COUNT(*)        FROM inventory   UNION ALL
  SELECT 'orders',                  COUNT(*)        FROM orders      UNION ALL
  SELECT 'order_items',             COUNT(*)        FROM order_items UNION ALL
  SELECT 'payments',                COUNT(*)        FROM payments
) t ORDER BY tbl;
```

**기대값:**

| 테이블 | 기대 건수 | 비고 |
|---|:---:|---|
| `users` | 1,011 | admin 1 + test1~10 10 + 랜덤 1,000 |
| `products` | 500 | 나이키·아디다스·컨버스 등 스니커즈 |
| `inventory` | 3,500 | 상품 500 × 사이즈 7단계 |
| `orders` | 10,000 | 부하 테스트용 사전 주문 데이터 |
| `order_items` | 15,000~20,000 | 주문당 1~3개 랜덤 |
| `payments` | 10,000 | 주문 1건 = 결제 1건 |

---

## 5. 데이터 상세 검증

### 5-1. 이메일 ASCII 검증 (한글 이메일 없어야 함)

```sql
SELECT email FROM users
WHERE email ~ '[^\x00-\x7F]'
LIMIT 10;
```

> **기대: 0건** — 한글이 포함된 이메일이 있으면 seed 재생성 필요

---

### 5-2. 고정 계정 확인

```sql
SELECT email, name
FROM users
WHERE email LIKE '%@shoply.com'
ORDER BY email;
```

**기대 결과 (11건):**

```
admin@shoply.com   관리자
test1@shoply.com   테스트1
test2@shoply.com   테스트2
...
test10@shoply.com  테스트10
```

---

### 5-3. 타임세일 상품 수 확인

```sql
SELECT
  COUNT(*)                                              AS total,
  COUNT(*) FILTER (WHERE is_timesale = TRUE)            AS timesale,
  COUNT(*) FILTER (WHERE is_timesale = FALSE)           AS normal
FROM products;
```

> **기대:** timesale 20건

타임세일 상품 목록 샘플:

```sql
SELECT name, price, sale_price, sale_ends_at
FROM products
WHERE is_timesale = TRUE
ORDER BY sale_ends_at
LIMIT 5;
```

---

### 5-4. 재고 선점 상태 확인 (실험 전 반드시 0)

```sql
SELECT
  COUNT(*)                                  AS total,
  COUNT(*) FILTER (WHERE reserved != 0)     AS has_reserved,
  MIN(quantity)                             AS min_qty,
  MAX(quantity)                             AS max_qty
FROM inventory;
```

**기대:**
- `has_reserved` = **0** (선점 없음)
- `min_qty` ≥ 0, `max_qty` ≤ 100

---

### 5-5. 타임세일 상품 재고 범위 확인

```sql
SELECT
  MIN(i.quantity) AS min_qty,
  MAX(i.quantity) AS max_qty,
  AVG(i.quantity)::INT AS avg_qty
FROM inventory i
JOIN products p ON i.product_id = p.id
WHERE p.is_timesale = TRUE;
```

> **기대:** 10 ≤ quantity ≤ 100 (부하 테스트 중 소진 유도)

---

### 5-6. 주문 상태 비율 확인

```sql
SELECT
  status,
  COUNT(*)                                              AS cnt,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1)  AS pct
FROM orders
GROUP BY status
ORDER BY cnt DESC;
```

**기대 비율:**

| status | 비율 |
|---|:---:|
| PAID | ~70% |
| FAILED | ~20% |
| PENDING | ~10% |

---

### 5-7. 결제 실패 사유 분포 확인

```sql
SELECT
  failed_reason,
  COUNT(*)                                              AS cnt,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1)  AS pct
FROM payments
WHERE status = 'FAILED'
GROUP BY failed_reason
ORDER BY cnt DESC;
```

**기대:** 아래 두 가지 사유만 존재해야 함

| failed_reason | 설명 |
|---|---|
| `PAYMENT_GATEWAY_ERROR` | 결제 게이트웨이 오류 |
| `INSUFFICIENT_STOCK` | 재고 부족 |

---

### 5-8. 전체 플로우 정합성 확인

주문 → 결제 연결 확인:

```sql
SELECT
  o.status   AS order_status,
  p.status   AS payment_status,
  COUNT(*)   AS cnt
FROM orders o
JOIN payments p ON p.order_id = o.id
GROUP BY o.status, p.status
ORDER BY cnt DESC;
```

> **기대:** `order_status = PAID` ↔ `payment_status = PAID` 쌍이 다수

---

## 6. Redis 검증

### 6-1. 서비스 기동 전 (인프라만 올라온 상태)

```bash
# 살아있는지 확인
docker exec -it msa_redis redis-cli ping
# 기대: PONG

# 버전 확인
docker exec -it msa_redis redis-cli info server | grep redis_version

# 메모리 상태 (기준값으로 기록해둘 것)
docker exec -it msa_redis redis-cli info memory \
  | grep -E "used_memory_human|maxmemory_human|maxmemory_policy"

# 현재 키 개수 (서비스 기동 전 — 반드시 0이어야 함)
docker exec -it msa_redis redis-cli dbsize
# 기대: 0
```

**정상 기준값:**

| 항목 | 정상값 |
|---|---|
| ping | PONG |
| used_memory_human | ~1.00M |
| maxmemory_policy | noeviction (무제한) |
| dbsize | 0 |

---

### 6-2. Product Service 기동 후

Product Service가 뜨고 API를 한 번이라도 호출하면 캐시 키가 생성된다.

```bash
# 생성된 캐시 키 목록 확인
docker exec -it msa_redis redis-cli keys "*"
# 기대: products:list, products:{uuid} 형태

# 상품 목록 캐시 TTL 확인 (설계: 60초)
docker exec -it msa_redis redis-cli ttl "products:list"

# 상품 상세 캐시 TTL 확인 (설계: 30초)
docker exec -it msa_redis redis-cli ttl "products:{product-uuid}"

# 캐시 히트 / 미스 통계
docker exec -it msa_redis redis-cli info stats \
  | grep -E "keyspace_hits|keyspace_misses"

# 캐시 값 직접 조회 (JSON 형태여야 함)
docker exec -it msa_redis redis-cli get "products:list"
```

**캐싱 정책 요약:**

| 키 | TTL | 비고 |
|---|:---:|---|
| `products:list` | 60초 | 상품 목록 |
| `products:{uuid}` | 30초 | 상품 상세 (재고 제외) |
| `stats:realtime` | 3초 | 실패 현황 |

> **재고 수량은 캐싱 안 함** — 정합성 핵심이므로 항상 DB 직접 조회

---

## 7. 데이터 초기화 방법

### 방법 A — seed만 수동 재적용 (빠름)

```bash
docker exec -i msa_postgres psql -U shoply -d shoply < db/seed.sql
```

> `TRUNCATE → INSERT` 순서로 실행되므로 기존 데이터가 덮어씌워진다.

---

### 방법 B — 볼륨 삭제 후 완전 재시작 (깔끔)

```bash
docker compose down -v          # 컨테이너 + 볼륨 모두 삭제
docker compose up -d postgres redis   # schema + seed 자동 재적용
```

---

## 8. 종료

```bash
# 컨테이너만 종료 (볼륨 데이터 보존)
docker compose down

# 컨테이너 + 볼륨 모두 삭제 (완전 초기화)
docker compose down -v
```

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `msa_postgres` unhealthy | 포트 5432 충돌 | `lsof -i :5432` 로 프로세스 확인 후 종료 |
| `msa_redis` unhealthy | 포트 6379 충돌 | `lsof -i :6379` 로 프로세스 확인 후 종료 |
| 볼륨 있어서 seed 미적용 | 기존 볼륨 잔존 | `docker compose down -v` 후 재시작 |
| 한글 이메일 데이터 존재 | seed 생성 오류 | seed 재생성 → 방법 A로 수동 재적용 |
| `FATAL: role "shoply" does not exist` | 환경변수 미설정 | `.env` 파일 존재 여부 및 내용 확인 |
| `reserved != 0` 건 존재 | 이전 실험 잔존 데이터 | 방법 A로 seed 재적용 |
| Redis `dbsize` 0이 아님 | 이전 캐시 잔존 | `docker exec -it msa_redis redis-cli flushall` |

---

*온프레미스 k8s vs AWS EKS 비교 실험 프로젝트 | DB 검증 가이드*
