# 온프레미스 k8s vs AWS EKS — 인프라 운영 비교 실험

> **"동일한 앱, 동일한 트래픽, 다른 인프라 — 데이터가 말하게 한다."**
> 같은 쇼핑몰 애플리케이션을 온프레미스 Kubernetes와 AWS EKS에 똑같이 배포하고,
> **"노드가 자동으로 늘어나는가"** 딱 하나만 다르게 두어, 트래픽 폭증·장애 상황에서 두 환경이 어떻게 다르게 버티는지를 정량적으로 비교한다.

---

## 1. 프로젝트 개요

### 배경

이커머스의 타임세일·이벤트 오픈 순간에는 트래픽이 평상시의 수 배~수십 배로 **순간 폭증**한다. 이때 인프라가 부하를 흡수하지 못하면 결제 실패가 곧 **매출 손실**로 이어진다. 자체 보유 인프라(온프레미스)는 노드(서버)가 고정되어 부하가 몰려도 자원을 즉시 늘릴 수 없는 반면, 클라우드 관리형(AWS EKS)은 오토스케일러가 노드를 자동으로 추가해 폭증을 흡수한다. 이 차이를 막연한 "당연히 클라우드가 좋다"가 아니라 **정확히 얼마나, 어느 지점에서 갈리는지** 숫자로 측정한다.

### 목적

- 고정 자원 환경(온프레미스)의 **한계 지점**을 측정한다 — 몇 RPS에서 파드 Pending(자원 부족)이 발생하는가.
- 노드 장애 시 **복구 속도(MTTR)** 를 비교한다 — 수동 복구 vs 자동 복구.
- 위 차이를 **비즈니스 임팩트**(장애 중 결제 실패 = 매출 손실)로 환산한다.

> "EKS가 더 좋다"는 결론을 강요하지 않는다. **운영 특성 차이를 숫자로 드러내고** 판단은 보는 사람의 몫으로 둔다.
> 온프레미스에서 Pending이 쌓이고 Error Rate가 오르는 것은 "패배"가 아니라 **측정하려는 현상 그 자체**다. 노드 확장 유무가 이 실험의 독립변수이므로, 온프레미스에 의도적으로 추가 노드 여력을 주지 않는다(주면 EKS와 동일해져 비교가 사라진다).

### 핵심 가설

| # | 가설 |
|---|---|
| H1 | 평상시(저부하)에는 온프레미스와 EKS 모두 정상 처리한다 (Error 0%). |
| H2 | 스파이크가 **유지**되면, 온프레미스는 Pending이 쌓여 에러가 지속되고, EKS는 Karpenter가 60~90초 내 노드를 추가해 회복한다. |
| H3 | 노드 장애 시 온프레미스 MTTR(수동)은 분 단위, EKS(자동)는 초 단위다. |

### 품질 우선순위

UI 완성도보다 **실험 재현성·API 로직·DB 정합성**을 우선한다. UI는 최소 동작(상품/주문/결제/어드민)만 갖추고, 측정 결과의 신뢰도와 동시성 정합성에 100%를 둔다.

---

## 2. 팀 구성

총 **5명, 2개 팀**. 동일한 앱·동일 기준으로 두 환경을 각각 구축·실험한다.

| 팀 | 인원 | 담당 |
|---|---|---|
| **온프레미스 팀** | 팀원C | 앱 개발 · 온프레미스 인프라 구축 · 서비스 배포 |
| | 팀원D | 모니터링 (Prometheus / Grafana / Loki) |
| | 팀원E | 부하 테스트 · 부하 시나리오 · CI/CD (온프레·EKS 공통) |
| **EKS 팀** | 팀원A, 팀원B | EKS 환경 구축 |

---

## 3. 비교 프레임 — 무엇을 같게, 무엇을 다르게

앱·부하·설정을 **전부 동일**하게 맞추고, 단 하나의 독립변수만 다르게 둔다.

| 구분 | 항목 |
|---|---|
| **같음 (통제변수)** | 앱 이미지(GHCR 동일 SHA) · k6 부하 스크립트 · 데이터(상품·계정) · Nginx Ingress · 리소스(request 100m / limit 500m) · HPA(target 60%, min 1, max 99) · DB(PostgreSQL 16, max_connections 300) |
| **다름 ★독립변수** | **노드 자동확장** — 온프레: 없음(고정 KVM VM 2워커) ↔ EKS: Karpenter |
| 다름 (선택) | DB 자동복구 — 온프레: 수동 ↔ EKS: RDS Multi-AZ (시나리오 4, 할지 미정) |
| 다름 (환경 표준) | CNI(Flannel ↔ AWS VPC CNI), 컨트롤플레인(kubeadm 직접 ↔ AWS 관리형) — 측정 대상 아님 |

**이미지 고정:** `:latest`는 CD가 push할 때마다 가리키는 실제 이미지가 바뀌므로, 배포 시 **커밋 SHA 태그로 고정**해 온프레미스·EKS가 100% 동일 이미지를 받게 한다.

**진입 LB 대칭:** 온프레 MetalLB VIP ↔ EKS NLB를 같은 `LoadBalancer` 추상화로 맞춰, 진입 경로까지 대칭으로 둔다(아래 5절).

---

## 4. 시스템 구성

물리 서버 1대(AWS EC2 c8i.2xlarge) 위에 **KVM 가상머신**으로 온프레미스 k8s 클러스터를 재현한다.

```
AWS (ap-northeast-2)

[온프레미스 + 공통 인프라]
  c8i.2xlarge EC2 (8 vCPU / 16 GB, 스팟, 공인IP)
    ├── 호스트 iptables DNAT (80/443 → MetalLB VIP)
    └── KVM 가상머신 4대 (virbr0 브릿지)
          ├── master    (k8s 컨트롤플레인)              2 vCPU / 4 GB
          ├── worker1   (실험: gateway·product·inventory) 2 vCPU / 4 GB
          ├── worker2   (실험: frontend·order·payment·user) 2 vCPU / 4 GB
          └── worker3   (운영: Ingress·MetalLB·metrics, taint 격리) 2 vCPU / 4 GB
  PostgreSQL EC2  — PostgreSQL 16 (Docker, max_connections 300)
  Redis EC2       — Redis 7 (Docker)
  Monitoring EC2  — Prometheus + Grafana + Loki
  k6 EC2          — 부하 생성

[EKS — 예정]
  EKS 클러스터 (worker t3.medium × 2 + Karpenter) · RDS (Multi-AZ) · Redis EC2
```

### 가상화 — 왜 KVM인가

온프레미스의 본질인 **"오토스케일링 없는 고정 자원 환경"** 을 재현하기 위해 EC2 안에서 KVM 가상머신으로 노드를 구성했다. c8i 계열은 기본적으로 게스트에 중첩 가상화를 노출하지 않아 처음엔 KVM이 동작하지 않았고, **Launch Template에서 중첩 가상화를 활성화**해 띄운 인스턴스에서 KVM이 동작하도록 해결했다. 각 VM은 Ubuntu 24.04 cloud image를 cloud-init으로 초기화하고, containerd·kubeadm/kubelet/kubectl을 직접 설치한 뒤 `kubeadm init` + `join`으로 클러스터를 구성한다.

| 항목 | 값 |
|---|---|
| 가상화 | KVM (중첩 가상화 활성) |
| 호스트 | EC2 c8i.2xlarge (스팟), Ubuntu 24.04 |
| k8s | v1.34.x (EKS와 동일 마이너) |
| CNI | Flannel v0.26.7 |
| 워커 스펙 | VM당 2 vCPU / 4 GB (EKS t3.medium과 동일) |

### 노드 배치 — 실험/운영 분리 (핵심 설계)

worker1·2만 쓰면 Nginx Ingress·kube-state-metrics 같은 **운영 보조 파드**가 실험 워커 위에서 함께 돌며 CPU/메모리를 갉아먹어 "고정 자원의 순수 한계" 측정을 흐린다. worker3에 **taint(`dedicated=ops:NoSchedule`)** 를 걸어 앱 파드가 절대 못 들어가게 막고, 운영 컴포넌트만 toleration으로 들여보낸다.

| 노드 | 초기 배치 (soft nodeAffinity) | 성격 |
|---|---|---|
| **worker1** (`experiment-role=worker1`) | gateway, product, inventory | 실험 — 순수 고정 자원 |
| **worker2** (`experiment-role=worker2`) | frontend, order, payment, user | 실험 — 순수 고정 자원 |
| **worker3** (`experiment-role=ops`, taint) | Nginx Ingress, MetalLB speaker, kube-state-metrics, (선택) ArgoCD | 운영 격리 |

초기 배치만 soft affinity로 고정하고, HPA가 추가로 띄우는 파드는 노드가 차면 스케줄러가 자유 배치한다. 시나리오 3에서 **worker1을 종료**하면 모든 파드가 worker2 하나로 몰려 자원 부족 → Pending이 극적으로 발생한다.

---

## 5. 네트워크 · 트래픽 진입

KVM VM에는 공인 IP가 없으므로, 호스트 EC2가 80/443을 받아 클러스터로 넘기는 **NAT 포워딩** 역할을 한다.

```
사용자 / k6
  │ http(s)://shoply.example.com  (/etc/hosts → EIP)
  ▼
c8i EC2 (EIP, 공인IP) :80/443
  │ 호스트 iptables DNAT (-d 호스트IP)        ← VM에 공인IP 없어 EC2가 포워딩
  ▼
MetalLB VIP 192.168.122.24x (worker3가 L2/ARP 광고)   ← ingress-nginx Service type=LoadBalancer
  ▼
Nginx Ingress Controller Pod (worker3)               ← L7 경로 라우팅
  ├── /api/* → API Gateway :4000 → 각 마이크로서비스
  └── /      → Frontend :80
  ▼
PostgreSQL (별도 EC2) · Redis (별도 EC2)
```

- **호스트 iptables DNAT:** `EIP 80/443(-d 호스트IP) → MetalLB VIP`. `-d 호스트IP`를 반드시 붙여야 워커의 `ghcr.io` 이미지 pull(443)까지 가로채지 않는다.
- **MetalLB:** ingress-nginx를 `type: LoadBalancer`로 노출해 사설 VIP를 worker3가 광고한다. **EKS의 NLB와 같은 추상화**이므로 진입 경로가 대칭이 되어 공정 비교가 성립한다.
- **경로 비대칭 보정:** 온프레미스만 EC2 NAT 홉이 한 단계 더 있어 절대 응답시간이 약간 불리하다. 그래서 응답시간은 절대값이 아니라 **부하 증가에 따른 변화율(%)** 로 비교해 이 홉 오버헤드를 상쇄한다.

### 포트 일람

| 포트 | 용도 |
|---|---|
| 80 / 443 | MetalLB 진입 (호스트 DNAT → ingress VIP) |
| 30080 | Nginx Ingress NodePort |
| 4000~4005 | 앱 서비스 컨테이너 (gateway~user) |
| 30400~30404 | 앱 prom-client 메트릭 (gateway~payment) |
| 30800 | kube-state-metrics |
| 39101 / 39102 / 39103 | 워커1·2·3 node_exporter (iptables 포워딩) |
| 38080 / 38081 | cAdvisor 파드별 메트릭 (워커1·2) |
| 5432 / 6379 | PostgreSQL / Redis |
| 9187 / 9121 | postgres_exporter / redis_exporter |
| 9090 / 3000 | Prometheus / Grafana |

온프레는 VM이 NAT 뒤에 있어 위 메트릭 포트들을 호스트 iptables DNAT로 외부 Prometheus에 노출한다. EKS(예정)는 워커 공인 IP:NodePort로 직접 접근한다.

---

## 6. 애플리케이션 — Shoply MSA 7개 서비스

신발 쇼핑몰을 마이크로서비스 7개로 구성한다. 백엔드 6개는 Node.js·Express·TypeScript, 프론트는 React다. 모든 외부 요청은 gateway를 단일 진입점으로 통과한다.

| 서비스 | 포트 | 소유 테이블 | 역할 |
|---|:---:|---|---|
| **gateway** | 4000 | — | 모든 API 진입점. 각 서비스로 프록시 + Prometheus 메트릭 수집 |
| **product** | 4001 | `products` | 상품 목록/상세 조회 (Redis 캐시), 타임세일 제어 |
| **inventory** | 4002 | `inventory` | 재고 예약/차감/해제. **`SELECT FOR UPDATE` 동시성 제어** |
| **order** | 4003 | `orders`, `order_items` | 주문 생성 (재고 예약 → 주문 저장, 트랜잭션) |
| **payment** | 4004 | `payments` | 결제 처리 (Mock 95% 성공). 성공 시 재고 차감, 실패 시 예약 해제 |
| **user** | 4005 | `users` | 회원가입·로그인 (bcrypt + JWT) |
| **frontend** | 80 | — | React 쇼핑몰 UI (상품/주문/결제/어드민) |

### 서비스 간 통신

```
[Frontend] → [API Gateway :4000]
                ├─ /api/auth/*      → User      :4005
                ├─ /api/products/*  → Product   :4001
                ├─ /api/inventory/* → Inventory :4002
                ├─ /api/orders/*    → Order     :4003
                └─ /api/payments/*  → Payment   :4004

[Order]   ──── POST /reserve ──────→ [Inventory]   (주문 시 재고 예약)
[Payment] ─ 결제성공 → POST /deduct  → [Inventory]   (재고 실차감)
          └ 결제실패 → POST /release → [Inventory]   (예약 해제)
[Payment] ──── PATCH /:id/status ──→ [Order]        (주문 상태 갱신)
```

핵심 흐름: **재고 예약은 주문 시점, 실차감은 결제 성공 시.** 결제 실패하면 예약을 즉시 해제해 재고를 되돌린다.

### API 구성

| 엔드포인트 | 메서드 | 역할 |
|---|:---:|---|
| `/api/auth/login` | POST | 로그인 / JWT 발급 |
| `/api/auth/me` | GET | 내 정보 조회 (JWT 검증) |
| `/api/products` | GET | 상품 목록 조회 |
| `/api/products/:id` | GET | 상품 상세 조회 |
| `/api/inventory/:productId` | GET | 재고 조회 |
| `/api/orders` | POST | 주문 생성 (재고 자동 예약) |
| `/api/orders/:id` | GET | 주문 조회 |
| `/api/payments` | POST | 결제 처리 (Mock 95% 성공) |
| `/api/stats` | GET | 결제 성공/실패 통계 실시간 |
| `/api/products/timesale/start` | POST | 타임세일 일괄 시작 (어드민) |
| `/api/products/timesale/stop` | POST | 타임세일 전체 종료 (어드민) |

### 페이지 구성

로그인 · 메인(상품 목록) · 상품 상세 · 타임세일(카운트다운) · 주문/결제 · 실패 현황(성공률 실시간) · 어드민(타임세일 제어판, `admin@shoply.com` 전용).

### 동시성 — 초과판매 방지

타임세일에 수백 명이 동일 상품·사이즈에 동시 주문하면 "재고 확인 → 차감" 사이에 다른 트랜잭션이 끼어들어 초과판매가 발생할 수 있다. inventory는 행에 배타적 락을 걸어 동시 주문을 직렬화한다.

```sql
BEGIN;
SELECT quantity, reserved FROM inventory
WHERE product_id = $1 AND size = $2
FOR UPDATE;            -- 행 잠금 (다른 트랜잭션 대기)
-- available = GREATEST(0, quantity - reserved) 검증 후
UPDATE inventory SET reserved = reserved + $3
WHERE product_id = $1 AND size = $2;
COMMIT;               -- 락 해제 → 다음 트랜잭션 진행
```

부하가 몰리면 `SELECT FOR UPDATE` 락 대기가 누적되며 DB 커넥션 큐가 포화되고, 이 지점이 실험의 핵심 병목이 된다.

---

## 7. 데이터 — PostgreSQL 16 + Redis 7

모든 서비스가 하나의 PostgreSQL 인스턴스를 공유하되, 테이블 소유권은 서비스별로 분리된다(User=users, Product=products, Inventory=inventory, Order=orders·order_items, Payment=payments). Redis는 **Product 서비스 전용 캐시**이며, **재고(inventory)는 절대 캐시하지 않는다**(실제 재고와 어긋나면 동시성 제어가 무의미해지고 실험이 오염되기 때문).

| 캐시 키 | TTL | 무효화 |
|---|---|---|
| `products:list` | 60s | 타임세일 시작/종료 시 즉시 삭제 |
| `products:{id}` | 30s | 타임세일 시작/종료 시 즉시 삭제 |
| `stats:realtime` | 3s | 결제 완료 시 즉시 삭제 |

시드 데이터: 상품 약 456종, 재고(상품×사이즈 6종), 계정 `admin@shoply.com`(Admin1234!) + `test1~2000`(Test1234!). 매 실험 전 `load-test-prep.sql`로 재고·주문을 리셋해 직전 실험의 잔여 데이터가 오염시키지 않게 한다.

---

## 8. 리소스 · HPA 설정 (온프레·EKS 동일)

| 항목 | 값 | 이유 |
|---|---|---|
| request / limit | **100m / 500m** (frontend 50m / 200m) | request를 작게 → HPA가 민감하게 발동 → 노드 빨리 참 → Pending 관찰 |
| HPA target | CPU **60%** (전 서비스 통일) | 동일 기준 |
| minReplicas | **1** | 1에서 시작해야 증가 폭이 보임 |
| maxReplicas | **99** | max를 제한하면 노드가 안 터져 "고정 자원 한계"를 못 봄 |
| HPA 대상 | gateway / product / inventory / order / payment | frontend·user 제외 |
| 배치 | soft nodeAffinity (worker1/worker2) | 초기 고정, 추가분 자유 배치 |
| DB pool | 서비스당 max 8 | — |

**하이브리드 부하 설계:** 깨끗한 앱은 가벼워 HPA가 잘 안 돈다. request를 작게 두어(HPA 발동) k6 RPS를 크게 주는(실제 CPU↑) 방식으로 두 효과를 모두 얻는다.

---

## 9. 실험 시나리오

발표·분석 흐름: **안정(신뢰 형성) → 스파이크(갈림) → 장애복구(임팩트)**. 각 시나리오는 양쪽 환경에 동일 조건으로 실행하고, 사이마다 DB를 리셋한다.

### 시나리오 1 — 안정 (베이스라인)

200 RPS를 10~20분 유지한다. 양쪽 모두 정상 처리(Error 0%, Pending 0, 워커 CPU 30~50%). **"평상시엔 온프레미스도 충분하다"** 를 먼저 보여줘 비교의 공정성을 확보한다.

### 시나리오 2 — 스파이크 (순간 급증 + 유지) ★핵심

```
0~5분:   200 RPS (안정)
5분:     1500 RPS로 급증 (30초~1분에 걸쳐)
5~15분:  1500 RPS 계속 유지   ← ★여기가 진짜 실험 (최소 5분)
```

급증을 짧게 끝내면 시스템이 반응하기 전에 끝나 아무것도 안 보인다. **차이는 "유지 구간"에서 드러난다.** 온프레미스는 노드를 못 늘려 Pending이 계속 쌓이고 에러가 지속되는 반면, EKS는 Karpenter가 60~90초 만에 노드를 추가해 흡수하고 에러가 0으로 회복된다. 부하는 worker1(gateway·product·inventory)에 집중된다.

| 지표 | 온프레미스 | EKS |
|---|---|---|
| 유지 중 Error | 계속 높음 | 60~90초 후 0으로 회복 |
| 최대 Pending | 쌓임 | 0 (해소) |
| Node Count | 2 (고정) | 2 → N (Karpenter) |

### 시나리오 3 — 노드 장애 복구 (MTTR)

500 RPS를 유지하다 5분 후 **worker1을 강제 종료**한다. worker1엔 Gateway·Product·Inventory가 몰려 있어, 죽으면 모든 파드가 worker2 하나로 재스케줄되며 자원 부족 → Pending이 극적으로 발생한다. 온프레미스는 사람이 노드를 수동 재시작(`virsh start`)할 때까지 분 단위로 다운되고, EKS는 Karpenter가 새 노드를 자동 추가해 ~60초에 복구된다.

측정: **MTTR**(장애 시작 → 정상 복구) / **장애 중 결제 실패 건수**(= 비즈니스 손실).
※ liveness/readiness 분리 필수 — `/livez`(DB 안 봄)=liveness, `/health`(DB 봄)=readiness. 안 그러면 장애 시 전 파드가 재시작 루프에 빠져 측정이 망가진다.

### 시나리오 4 — DB 페일오버 (선택, 할지 미정)

500 RPS 유지 중 Primary DB를 종료한다. 온프레는 Replica 수동 승격(`pg_promote`)으로 수 분, EKS는 RDS Multi-AZ 자동 페일오버로 60~120초. 핵심 비교는 노드 탄력성(2·3)이므로 DB는 여유가 될 때만 추가한다.

---

## 10. 부하 측정 방법

부하 도구는 **k6**(스크립트: `k6/scripts/scenario.js`). 부하를 계단식으로 올리며 한계를 찾는다.

### 한계의 정의

**한계 = Pending Pod이 처음 뜨는 지점.** 부하 증가 → HPA가 파드 증설 → 노드 자원 소진 → HPA는 더 늘리고 싶은데 노드에 자리 없음 → Pending 발생. 이것이 고정 자원의 한계이며 EKS(Karpenter로 노드 추가)와 갈리는 지점이다.

| 신호 | 확인 | 한계? |
|---|---|---|
| Pending 발생 | `kubectl get pods -n shoply --field-selector=status.phase=Pending` | ★ 한계 도달 |
| 워커 CPU 90%+ | `kubectl top nodes` | 거의 다 참 |
| HPA CURRENT = MAX | `kubectl get hpa -n shoply` | 더 못 늘림 |

Pending이 떴으면 `kubectl describe pod`의 Events가 **`Insufficient cpu/memory`** 인지 확인한다 — 이게 나와야 "고정 자원 한계"로 측정이 유효하다(ImagePullBackOff·affinity 충돌 등 다른 원인이면 무효).

### 자동 캡처 → 리포트

수동으로 일일이 찍지 않고 스크립트 2개로 자동화한다. 쿠버네티스 이벤트는 기본 1시간만 보관되므로, 한계 지점이 자동 캡처되는 것이 중요하다.

- `capture-loop.sh` (master VM): 부하 시작 직전 켜두면 주기적으로 스냅샷 저장(서비스별 파드 수·Pending·실패, 진단 로그, 노드 CPU request 할당률, HPA, 이벤트). 과부하 구간이 자동 포착된다.
- `analyze_experiment.py` (맥): run 폴더를 주면 파드 최다(한계) 스냅샷을 자동 선택해 **HTML 리포트** 1개를 생성한다. 해석이 전부 로그 파싱이라 같은 입력이면 같은 결과(재현성) — 온프레·EKS 양쪽에 똑같이 돌려 비교한다.

---

## 11. 모니터링

Prometheus가 15초 간격으로 메트릭을 수집하고 Grafana로 시각화하며, 로그는 Loki로 모은다(숫자=WHAT은 Prometheus/Grafana, 로그=WHY는 Loki). Prometheus는 온프레·EKS 양쪽을 동시 수집해 Grafana 하나에서 나란히 비교한다.

| 도구 | 수집 |
|---|---|
| prom-client (앱) | TPS, Latency, Error Rate, API별 응답시간 |
| kube-state-metrics | Pod 수, Node 수, Pending Pod, HPA 상태 |
| node_exporter | CPU, RAM, 디스크, 네트워크 |
| cAdvisor (worker1·2) | 파드별 CPU/메모리 |
| postgres_exporter / redis_exporter | DB 커넥션·Lock 대기 / 캐시 히트율 |
| Promtail → Loki | 파드 로그 |
| kubernetes-event-exporter → Loki (worker3) | k8s 이벤트(Pending·스케일) |

### 핵심 패널 (PromQL)

| 패널 | PromQL |
|---|---|
| Error Rate | `rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m])` |
| P95 Latency | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1m]))` |
| Pending Pod ★ | `count(kube_pod_status_phase{phase="Pending"})` |
| Node Count | `count(kube_node_info)` |
| HPA 괴리 | `kube_horizontalpodautoscaler_status_current_replicas` vs `..._spec_max_replicas` |
| CPU 사용률 | `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))` |
| DB 커넥션 | `pg_stat_activity_count` |
| Redis 히트율 | `rate(redis_keyspace_hits_total[1m]) / (rate(redis_keyspace_hits_total[1m]) + rate(redis_keyspace_misses_total[1m]))` |

발표 핵심 화면은 **온프레 Error Rate↑·Pending 급증 vs EKS Error 0%·Pending 0** 를 나란히 띄우는 한 장이다.

---

## 12. CI/CD

```
git push → GitHub Actions 트리거
  → 변경된 서비스만 감지 (paths-filter)
  → npm ci + tsc 타입체크 + npm audit
  → Docker 이미지 빌드
  → GHCR 푸시 (ghcr.io/ktk026/shoply-*)
```

이미지 버전 태그로 양쪽 환경에 동일 이미지를 보장한다. 레지스트리 인증은 EKS=노드 IAM Role(IRSA) 자동, 온프레미스=`imagePullSecrets` 수동 등록(`ghcr-secret`).

---

## 13. 동일화 — 온프레 ↔ EKS

"노드 확장"만 빼고 전부 같게 맞춘다. **온프레미스가 기준이고 EKS가 맞춘다.**

| 구간 | 온프레미스 | EKS (예정) | 동일? |
|---|---|---|---|
| 진입 LB | MetalLB VIP (`LoadBalancer`) | NLB (`LoadBalancer`) | 대칭 |
| Ingress~서비스 | Nginx Ingress NodePort 30080 | 동일 파일 공유 | ✅ 완전 동일 |
| 리소스·HPA | 100m/500m, 60%, min1/max99 | 동일 | ✅ |
| DB | EC2 PostgreSQL 16, max_conn 300 | RDS PostgreSQL 16, max_conn 300 | ✅ (복구 방식만 선택적 차이) |
| 노드 스펙 | KVM VM 2vCPU/4GB × 2 | t3.medium 2vCPU/4GB × 2 | ✅ |
| CNI | Flannel | AWS VPC CNI | 환경 표준(측정 안 함) |
| 진입 경로 | EC2 iptables NAT 1홉 | 워커 공인IP 직접 | 변화율(%)로 보정 |
| **노드 확장** | ❌ 고정 | ✅ **Karpenter** | ★ **일부러 다름** |

---

## 14. 로컬 개발 환경

소스는 `msa_shoply/app/`. Docker Compose로 인프라(PostgreSQL·Redis)를 먼저 올리고 서비스를 단계별로 검증한다.

```bash
# 앱 폴더에서
cd msa_shoply/app
cp .env.example .env
docker compose up postgres redis -d   # 인프라 먼저
docker compose up -d                  # 서비스 기동
```

DB는 최초 기동 시 `schema.sql`(테이블·인덱스) → `seed.sql`(유저 ~1,000명 / 상품 456개 / 재고) 자동 적재. 컨테이너 포트: gateway 4000, product 4001, inventory 4002, order 4003, payment 4004, user 4005, frontend 3000, postgres 5432, redis 6379.

| 구분 | 변수 | 기본값 |
|---|---|---|
| PostgreSQL | POSTGRES_DB/USER/PASSWORD/HOST/PORT | shoply / shoply / shoply1234 / postgres / 5432 |
| Redis | REDIS_HOST/PORT | redis / 6379 |
| JWT | JWT_SECRET | (배포 시 교체) |

### 배포·검증 순서 (단계별)

서비스를 한 번에 올리지 않고 단계별로 올리며 각 단계에서 동작을 확인한다(공통: 매 단계에 Gateway+Frontend+PostgreSQL+Redis 포함).

1. User + Gateway + Frontend → 로그인/JWT/렌더링
2. + Product → 상품 목록/상세/Redis 캐싱
3. + Inventory → 재고 조회/차감/동시성
4. + Order → 주문 생성/상태 변경/재고 선점
5. + Payment → 결제 성공·실패/재고 최종 차감/**전체 흐름**(로그인→조회→주문→결제)

---

## 15. 백업 · 복원 (스팟 대비)

스팟 인스턴스는 회수되면 root EBS가 함께 삭제되므로 백업 체계가 필수다.

- **AMI 백업:** 호스트 EC2를 AMI로 떠두면 KVM VM 디스크(qcow2)까지 포함되어 몇 분 내 클러스터가 그대로 부활한다.
- **VM 백업:** qcow2를 별도 보관 → 새 EC2에 복원(재구축 생략).
- 복원 후 호스트 사설 IP는 매번 바뀌므로 iptables DNAT와 ConfigMap의 DB/Redis IP를 갱신한다(`host-network.sh`가 VM IP를 자동 감지, `restore-cluster.sh`가 KVM 설치+VM 복원+네트워크를 한 번에 처리).

---

## 16. 기술 스택

| 영역 | 스택 |
|---|---|
| 인프라 | Ubuntu 24.04 · KVM · k8s v1.34.x · Flannel v0.26.7(온프레)/VPC CNI(EKS) · Docker · containerd |
| 백엔드 | Node.js 22 · Express 4.18 · TypeScript 5.3 · prom-client 15.1 · pg 8.11 |
| 인증/캐시 | bcryptjs · jsonwebtoken 9 · ioredis 5.3 · http-proxy-middleware 3 |
| 프론트 | React 19 · Vite 6 · TanStack Router · Tailwind CSS 4 · lucide-react |
| 데이터 | PostgreSQL 16 · Redis 7 |
| 부하/모니터링 | k6 · Prometheus · Grafana · Loki · Promtail · cAdvisor · node_exporter · kube-state-metrics |
| 레지스트리/CI | GHCR · GitHub Actions |
| 시드 생성 | AWS Bedrock (Claude 3.5 Sonnet v2, ap-northeast-2) |

---

## 17. 진행 현황

| 영역 | 상태 |
|---|---|
| 온프레미스 인프라(KVM k8s 4 VM) · 앱 7개 · 배포 · 모니터링 | 완료 |
| 본실험(한계 RPS · MTTR 정식 측정) | 진행 중 |
| EKS 환경 구축 및 비교 | 진행 중 (문서상 "예정"으로 표기) |

**현재까지 검증된 것:** 온프레미스 클러스터 정상 가동, 앱 배포 후 로그인·주문·결제 정상 동작, 부하 시 HPA 작동으로 파드 최대 약 60개 증가 확인(단, Pending·실패가 함께 발생한 상태 — 정식 한계 측정이 아니라 부하 인입·파드 증가 확인 수준), 워커 CPU 80~90% 관찰.
**미측정(본실험 예정):** 정식 한계 RPS, 노드 장애 MTTR, 스파이크 에러율, 결제 실패→매출 손실 환산.

---

## 18. 프로젝트 구조

```
shopping_k8s/
├── README.md                  # 이 문서
├── msa_shoply/                # 코드·인프라·실험 자산 (app/onprem/team 3분류)
│   ├── app/                   # gateway·services·frontend·db·docker-compose
│   ├── onprem/                # k8s(common·onprem)·scripts(host-network·restore)
│   └── team/                  # k6·infra(monitoring·postgres·redis·userdata)·k8s/eks·scripts(capture·analyze)·terraform
└── 문서/                       # 설명 문서 (앱/개인/팀 3분류 + 인덱스 README)
    ├── app/             # 앱_서비스_설명 · 데이터베이스
    ├── onprem/       # 온프레미스·인프라_설계·아키텍처·사전조건서·흐름도·AMI백업·트러블슈팅·내역할
    └── team/               # 기획서·시나리오·부하테스트·동일화·모니터링·포트정리·발표·역할개요
```

---

*온프레미스 k8s vs AWS EKS 비교 실험 — 인프라 운영 비교 프로젝트*
