-- ============================================================
-- 부하 테스트 준비 SQL — 실험(시나리오 A/B) 시작 전 매번 실행
-- 양쪽 환경(온프레미스/EKS)에 동일하게 적용해야 공정함
-- ============================================================

-- 1. 재고 안전 바닥값 확보
--    부하 중 일부 SKU(최소 11개짜리)가 먼저 바닥나는 것 방지.
--    456상품 × 7사이즈 = 3192 SKU에 주문이 분산되므로 500이면 충분.
UPDATE inventory SET quantity = 500 WHERE quantity < 200;

-- 2. 예약 상태 초기화 (이전 실험의 reserved 잔여 제거)
UPDATE inventory SET reserved = 0;

-- 3. 거래 흔적 초기화 — 깨끗한 시작점
--    ※ 시드의 과거 주문/결제 데이터(현황 페이지용)도 함께 지워짐.
--      발표용 현황 데이터를 보존하려면 이 블록을 주석 처리.
TRUNCATE TABLE payments, order_items, orders CASCADE;

-- 4. 확인
SELECT
  (SELECT COUNT(*) FROM products)               AS products,
  (SELECT COUNT(*) FROM inventory)              AS inventory_skus,
  (SELECT MIN(quantity) FROM inventory)         AS min_stock,
  (SELECT SUM(quantity) FROM inventory)         AS total_stock,
  (SELECT COUNT(*) FROM users)                  AS users,
  (SELECT COUNT(*) FROM orders)                 AS orders_after_reset;
