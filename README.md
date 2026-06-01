# 온프레미스 k8s vs AWS EKS — 인프라 운영 비교 실험

> "동일한 앱, 동일한 트래픽, 다른 인프라 — 데이터가 말하게 한다"

---

## 목차

- [프로젝트 개요](#프로젝트-개요)
- [아키텍처](#아키텍처)
- [발표 스토리 흐름](#발표-스토리-흐름)
- [인프라 구성](#인프라-구성)
- [실험 공정성 기준](#실험-공정성-기준)
- [웹 서비스](#웹-서비스)
- [서비스 구성](#서비스-구성)
- [시나리오](#시나리오)
- [모니터링](#모니터링)
- [CI/CD](#cicd)
- [로컬 개발 환경](#로컬-개발-환경)
- [배포 및 검증 순서](#배포-및-검증-순서)
- [실험 범위](#실험-범위)
- [문서](#문서)

---

## 프로젝트 개요
"물리 서버 한 대로 운영 중인
 온프레미스 환경을 가정했습니다"
 
### 목적

"EKS가 더 좋다"는 결론을 강요하지 않는다.  
**온프레미스 vs EKS의 운영 특성 차이**를 데이터로 보여주고, 경영진이 스스로 판단하게 만드는 것이 목표다.

발표는 **사전 녹화 영상** 형식으로 제출한다.

### 품질 우선순위

| 항목 | 목표 수준 |
|---|---|
| UI 완성도 | 30점 (최소 동작) |
| API 로직 | 100점 |
| DB 정합성 | 100점 |
| 실험 재현성 | 100점 |

---

## 아키텍처

![아키텍처 다이어그램]()

```
[온프레미스]
Locust-A → c8i.2xlarge:80 → EC2 Nginx → 192.168.122.3:30080 → kube-proxy → Nginx Ingress
                                                                                    │
[EKS]                                                                    /api/* → API Gateway Pod :4000
Locust-B → Worker Node EIP:30080 → kube-proxy → Nginx Ingress ──────────/     → Product / Inventory / Order / Payment / User
                                                                         \
                                                                          / → → Frontend Pod :3000

k8s 외부 인프라
  ├─ PostgreSQL      (온프레미스: t3.medium EC2 / EKS: RDS db.t3.medium)
  ├─ Redis           (t3.micro EC2)
  ├─ Locust-A / B    (t3.medium EC2 × 2 — 환경별 분리)
  ├─ 모니터링        (t3.small EC2 — Prometheus + Grafana)
  └─ OpenSearch      (Amazon OpenSearch Service — 로그 수집 및 에러 원인 분석)
```

### 서비스 간 통신 흐름

```
[Frontend]
    └─ 모든 요청 → [API Gateway :4000]
                        ├─ /api/auth/*      → User Service     :4005
                        ├─ /api/products/*  → Product Service  :4001
                        ├─ /api/inventory/* → Inventory Service :4002
                        ├─ /api/orders/*    → Order Service    :4003
                        └─ /api/payments/*  → Payment Service  :4004

[Order Service]   ──── POST /reserve ──────→ [Inventory Service]
[Payment Service] ─ 결제성공 → POST /deduct  → [Inventory Service]
                  └ 결제실패 → POST /release → [Inventory Service]
[Payment Service] ──── PATCH /:id/status ──→ [Order Service]

[Admin Page] ─→ [API Gateway] ─→ POST /timesale/start ──→ [Product Service]  (시나리오 2 트리거)
                              └─→ POST /timesale/stop  ──→ [Product Service]
```

---

## 발표 스토리 흐름

```
1단계 — 문제 제기
  "타임세일 이벤트, 우리는 얼마나 잃고 있나?"

2단계 — 실험 소개
  "동일한 앱, 동일한 트래픽, 다른 인프라"
  "공정한 조건에서 비교했습니다"

3단계 — 시나리오 1 (일반 트래픽)
  "이 상황에서는 온프레미스도 충분합니다"
  → 신뢰감 형성

4단계 — 시나리오 2 (동시 예약/주문 폭주) + 시나리오 3 (점진적 한계점 탐색)
  "여기서 갈립니다 — 그리고 N RPS에서 무너집니다"
  → 데이터가 말하게 한다

5단계 — 시나리오 4 (장애 복구)
  "운영 관점에서 이런 차이가 납니다"
  → 비용이 아닌 운영 리소스 차이로 어필

6단계 — 결론
  "이 차이가 비즈니스에 미치는 임팩트는 이렇습니다"
```

---

## 인프라 구성

### 전체 구조

> **계정 구조:** 단일 AWS 계정 우선 — 크레딧 부족 시 2계정으로 전환 (설계는 전환해도 변경 최소화)

```
AWS 단일 계정 (ap-northeast-2)

VPC-A (10.0.0.0/16) — 온프레미스 재현 + 공통 인프라
└── Public 서브넷 10.0.1.0/24 (ap-northeast-2a)
    ├── c8i.2xlarge  [EIP]  — k8s 호스트 (LXD 컨테이너) + EC2 Nginx (:80 → 컨테이너 NodePort)
    │   ├── 노드1: k8s 마스터   <LXD_IP_1> (Ubuntu 24.04.4, 2vCPU/4GB)
    │   ├── 노드2: 워커노드 1   <LXD_IP_2> (Ubuntu 24.04.4, 2vCPU/4GB) ← traffic-node
    │   └── 노드3: 워커노드 2   <LXD_IP_3> (Ubuntu 24.04.4, 2vCPU/4GB) ← order-node
    │   ※ VM 아닌 LXD 시스템 컨테이너 (c8i-flex는 KVM 미지원) — IP는 lxc list로 확인
    │   k8s: EKS 버전과 동일하게 맞춤 (v1.34.x)
    ├── t3.medium           — PostgreSQL 16 (Docker)
    ├── t3.small            — Redis 7 (Docker)
    ├── t3.small   [EIP]   — Prometheus + Grafana (모니터링)
    ├── t3.medium          — Locust-A (온프레미스 전용, EIP 불필요 — SG 참조 방식)
    └── t3.medium  [EIP]   — Locust-B (EKS 전용, Worker Node NodePort 직접 연결)

VPC-B (10.1.0.0/16) — EKS (k8s v1.34.x 확인됨)
├── Public 서브넷 10.1.1.0/24 (ap-northeast-2a)
├── Public 서브넷 10.1.2.0/24 (ap-northeast-2b)  ← EKS 최소 2 AZ
├── EKS Worker t3.medium [EIP]  ← traffic-node (API GW, Product, Inventory) — 실험 고정
├── EKS Worker t3.medium [EIP]  ← order-node (Frontend, Order, Payment, User) — 실험 고정
├── EKS Worker t3.medium        ← Karpenter 확장용 (실험 초기 idle)
├── RDS db.t3.medium            — PostgreSQL 관리형
└── t3.micro                    — Redis 7 직접 설치
```

> **온프레미스 노드 = LXD 시스템 컨테이너 (VM 아님):**  
> c8i-flex.2xlarge는 AWS Nitro 하이퍼바이저라 중첩 가상화(KVM, `vmx`/`svm` 플래그)를 게스트에 노출하지 않는다.
> 따라서 `lxc launch --vm`(중첩 VM)은 불가하고, **LXD 시스템 컨테이너**로 워커노드 3개를 구성했다.
> 컨테이너지만 호스트 커널을 공유할 뿐 kubeadm 노드로는 완전히 동작한다.  
> → 발표 설명: *"물리서버 1대에 LXD 컨테이너로 k8s 노드 3개를 올렸다"* (중첩 가상화 미지원이라 VM 대신 컨테이너 선택)

> **Locust 2대 분리 이유:** 시나리오 2에서 온프레미스가 응답 지연/에러 급증 시  
> Locust-A의 쌓인 스레드가 EKS 부하에 영향을 주는 실험 결과 오염 방지

### EC2 스펙

#### 온프레미스 팀

| 용도 | 인스턴스 | vCPU | RAM | 비고 |
|---|---|:---:|:---:|---|
| k8s 클러스터 재현 | c8i.2xlarge | 8 | 16GB | 내부에 LXD 컨테이너 3대 운영 (KVM 미지원이라 VM 아닌 컨테이너) |
| PostgreSQL | t3.medium | 2 | 4GB | Docker 컨테이너 (10.0.2.128) |
| Redis | t3.small | 2 | 2GB | Docker 컨테이너 (10.0.6.15) |

#### EKS 팀

| 용도 | 인스턴스 | vCPU | RAM | 비고 |
|---|---|:---:|:---:|---|
| EKS 워커노드 (초기) | t3.medium × 3 | 2 | 4GB | 2개 실험 고정, 1개 Karpenter 확장용 |
| PostgreSQL | RDS db.t3.medium | 2 | 4GB | 관리형 |
| Redis | t3.micro | 2 | 1GB | 직접 설치 |

#### 공통

| 용도 | 인스턴스 | vCPU | RAM | EIP |
|---|---|:---:|:---:|:---:|
| 모니터링 (Prometheus + Grafana) | t3.small | 2 | 2GB | 필수 |
| Locust-A (온프레미스 전용) | t3.medium | 2 | 4GB | 불필요 |
| Locust-B (EKS 전용) | t3.medium | 2 | 4GB | 필수 |

> Monitoring EIP — EKS Worker Node SG 인바운드 화이트리스트 등록, 재시작 후 IP 변동 방지  
> Locust-A EIP 불필요 — c8i.2xlarge SG가 Locust-A SG 참조 방식으로 허용 (IP 기반 아님)  
> Locust-B EIP — Worker Node SG 인바운드에 이 IP만 허용 (ALB 미사용, NodePort 직접 연결)

### 온프레미스 노드 구성 (c8i.2xlarge 내부, LXD 컨테이너)

| 노드 | 역할 | vCPU | RAM |
|---|---|:---:|:---:|
| 노드1 | k8s 마스터 | 2 | 4GB |
| 노드2 | 워커노드 1 | 2 | 4GB |
| 노드3 | 워커노드 2 | 2 | 4GB |

> 워커노드 스펙 = EKS 워커노드 스펙(t3.medium급) — 공정한 비교를 위해 동일하게 맞춤  
> ※ VM이 아닌 LXD 시스템 컨테이너 (c8i-flex KVM 미지원) — 자세한 이유는 위 인프라 구조 참고

### 워커노드 초기 고정 배치

실험 재현성을 위해 서비스별 노드를 사전 고정한다.  
HPA 발동으로 추가되는 Pod는 k8s 스케줄러가 자유 배치한다.

| 워커노드 | 고정 서비스 |
|---|---|
| 워커노드 1 | API Gateway, Product Service, Inventory Service |
| 워커노드 2 | 프론트, Order Service, Payment Service, User Service |
| 추가 Pod (HPA 발동 시) | k8s 스케줄러 자유 배치 |

### 트래픽 진입점

ALB, MetalLB 없음. 양쪽 모두 **Nginx Ingress Controller (NodePort)** 사용.  
동일한 컴포넌트로 L7 라우팅 처리 → 실험 조건 동일.

| | 온프레미스 | EKS |
|---|---|---|
| Locust 타겟 | `c8i.2xlarge:80` | `Worker Node EIP:30080` |
| 중간 처리 | EC2 호스트 Nginx (proxy_pass → VM:30080) | 없음 (직접) |
| kube-proxy 진입 | VM2 (traffic-node) :30080 | Worker Node (traffic-node) :30080 |
| L7 라우팅 | Nginx Ingress Controller Pod | Nginx Ingress Controller Pod |
| /api/* | → API Gateway Pod :4000 | → API Gateway Pod :4000 |
| / | → Frontend Pod :3000 | → Frontend Pod :3000 |

> 온프레미스는 LXD 컨테이너가 공인IP 없어 c8i.2xlarge 위 Nginx가 NAT 역할.  
> API Gateway, Frontend 서비스는 ClusterIP — Nginx Ingress가 외부 라우팅 전담.

> **경로 비대칭에 대하여 (왜 이렇게 했는가):**  
> 온프레미스만 EC2 호스트 Nginx 홉이 한 단계 더 있다. LXD 컨테이너는 공인IP가 없어 c8i.2xlarge가
> NAT 역할을 해야 하기 때문이며, 이는 제거할 수 없는 **온프레미스의 구조적 특성**이다.
> 이 홉은 약간의 지연을 추가하므로, **두 환경의 응답시간을 절대값으로 직접 비교하지 않는다.**
> 대신 각 환경의 저부하 베이스라인을 기준점으로 잡고, 부하 증가에 따른 **상대적 악화율(%)** 을 비교한다.
> (홉 오버헤드는 베이스라인에 이미 포함되어 상쇄됨 → 부하 증가가 만드는 *변화*만 순수 비교)

**NodePort 고정 설정:**

| 서비스 | 타입 | NodePort |
|---|:---:|:---:|
| Nginx Ingress Controller (진입점) | NodePort | 30080 |
| Prometheus scrape용 (각 서비스 메트릭) | NodePort | 30090~ |

```yaml
# Nginx Ingress Controller Service
apiVersion: v1
kind: Service
metadata:
  name: ingress-nginx-controller
  namespace: ingress-nginx
spec:
  type: NodePort
  ports:
  - name: http
    port: 80
    targetPort: 80
    nodePort: 30080   # 온프레미스·EKS 동일하게 고정
```

```yaml
# Ingress 규칙 (온프레미스·EKS 동일)
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shoply-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-gateway
            port:
              number: 4000
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 3000
```

**EC2 호스트 Nginx 설정 (온프레미스 전용 — NAT 역할):**

```nginx
server {
    listen 80;
    location / {
        proxy_pass         http://<VM2_LXD_IP>:30080;    # Nginx Ingress NodePort — lxc list로 IP 확인
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

### 예상 실험 비용 (10시간 기준)

| 항목 | 비용 |
|---|---:|
| 온프레미스 EC2 (c8i.2xlarge) | $3.40 |
| PostgreSQL EC2 (t3.medium) | $0.20 |
| Redis EC2 (t3.micro) | $0.10 |
| 모니터링 EC2 (t3.small) | $0.23 |
| Locust-A EC2 (t3.medium) | $0.19 |
| Locust-B EC2 (t3.medium) | $0.19 |
| EKS 클러스터 | $1.00 |
| EKS 워커노드 × 3 (t3.medium) | $1.25 |
| EKS RDS (db.t3.medium) | $0.68 |
| EKS Redis EC2 (t3.micro) | $0.10 |
| **합계** | **약 $7~8** |
| 여유 포함 | **약 $20~30 (한화 3~4만원)** |

---

## 실험 공정성 기준

### 실험 프레임 — 무엇을 비교하는가

이 실험은 *"어느 환경이 더 빠른가"* 를 가리는 것이 아니라,
**"고정 자원의 한계(온프레미스) vs 탄력적 노드 확장(EKS)이 만드는 운영 특성 차이"** 를 측정한다.

- **온프레미스**: 고정된 워커노드 2대에서 **HPA(파드 수평 확장)만으로** 부하를 감당한다.
  노드 자원이 소진되면 HPA가 추가하려는 Pod는 갈 곳이 없어 **Pending** 으로 쌓이고, 처리 지연·실패로 한계가 드러난다.
- **EKS**: 동일한 HPA + **Karpenter(노드 자동 확장)**. Pending이 발생하면 노드를 새로 띄워 해소한다.

> **→ 온프레미스에서 Pending이 쌓이고 Error Rate가 오르는 것은 "패배"가 아니라 측정하려는 현상 그 자체다.**
> 멘토 질문 *"노드를 못 늘려서 진 것 아니냐"* 에 대한 답: **노드 확장 유무가 곧 이 실험의 독립변수**다.
> 그래서 온프레미스에 의도적으로 추가 노드 여력을 주지 않는다 (주면 EKS와 동일해져 비교 자체가 사라짐).

### 반드시 같아야 하는 것

- Docker 이미지 (완전히 동일한 버전) — **`:latest` 금지, 커밋 SHA 태그로 고정**
  > `latest`는 CD가 push할 때마다 가리키는 실제 이미지가 바뀌는 "떠다니는 딱지"다.
  > 온프레미스와 EKS가 서로 다른 시각에 `latest`를 pull하면 그 사이 새 push로 인해 **다른 이미지**를 받아 공정성이 깨진다.
  > → 실험 배포 시 `image: ...:latest` 를 `image: ...:<커밋SHA>` 로 고정해 양쪽이 100% 동일 이미지를 받게 한다.
- Locust 스크립트 (GitHub 공통 레포 관리)
- RPS 설정 (동일한 부하량)
- 실험 시간 (동일한 시간대, 동시 시작)
- 측정 지표 (동일한 Prometheus 쿼리)
- DB 스키마 (동일한 구조)

### 의도적으로 다른 것 (실험 핵심 변수)

- PostgreSQL 운영 방식 (EC2 직접 설치 vs RDS 관리형)
- 노드 확장 방식 (고정 2대 vs Karpenter 자동 확장)
- CNI (Flannel vs AWS VPC CNI)
- 트래픽 진입 (EC2 Nginx → VM:30080 → Nginx Ingress vs Locust-B → Worker Node:30080 → Nginx Ingress)

### 실험 동시 시작 방법

> **결정: Locust `--headless` 스케줄 기능 — 특정 시각에 자동 시작**

```bash
# Locust-A (온프레미스), Locust-B (EKS) 두 EC2에서 동시 실행
locust -f locustfile.py --host http://<타겟-IP> \
  --headless --users 200 --spawn-rate 200 --run-time 20m
```

동일 스크립트를 GitHub 공통 레포에서 pull 후 실행 → 수동 카운트다운 불필요

---

## 웹 서비스

| 항목 | 내용 |
|---|---|
| 프론트엔드 | Vite + React |
| API Gateway | Express.js |
| DB | PostgreSQL (온프레미스: EC2 직접 / EKS: RDS 관리형) |
| 캐시 | Redis (k8s 외부 EC2) |
| 컨테이너 | Docker 단일 이미지 |
| 레지스트리 | GHCR (ghcr.io/incheon-soda) |
| 부하 도구 | **k6** (Docker Compose, Prometheus remote write) |

### 페이지 구성

| 페이지 | 설명 |
|---|---|
| 로그인 | 이메일/비밀번호 로그인, JWT 발급 |
| 메인 (상품 목록) | 상품 그리드, 타임세일 배너 |
| 상품 상세 | 재고 수량 실시간, 구매 버튼 |
| 타임세일 | 카운트다운 타이머, 실시간 재고 |
| 주문 / 결제 | 장바구니 → 주문 → Mock 결제 |
| 실패 현황 | 실패 건수 실시간, 성공률 |
| 어드민 | 타임세일 제어판, 실험 체크리스트 (`admin@shoply.com` 전용) |

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
| `/api/products/:id/timesale` | PATCH | 개별 상품 타임세일 ON/OFF (어드민) |

---

## 서비스 구성

| 서비스 | 역할 | 핵심 기능 | 부하 특성 |
|---|---|---|---|
| Product Service | 상품 조회 | 목록/상세 조회, Redis 캐싱, 타임세일 정보 | Read 폭증 |
| Inventory Service | 재고 관리 | 재고 조회/차감, 동시성 처리 (SELECT FOR UPDATE) | 동시성 집중 |
| Order Service | 주문 처리 | 주문 생성/조회, 상태 변경 | Write 집중 |
| Payment Service | 결제 처리 | Mock 결제, 실패 처리, 건수 집계 | Write + 정합성 |
| User Service | 유저 관리 | 로그인, Mock JWT 발급 | 부하 낮음 |

---

## 시나리오

### 시나리오 1 — 일반 사용자 흐름 (20분)

| 항목 | 내용 |
|---|---|
| 목적 | 기준선 형성 — 평상시에는 온프레미스도 충분함을 먼저 보여줌 |
| 핵심 서비스 | 전체 서비스 고르게 |
| 핵심 측정 지표 | Error Rate 0% / TPS 안정 / Pod 수 변화 없음 |

**트래픽 타임라인**

| 구간 | RPS | 목적 |
|---|:---:|---|
| 0~5분 | 100 | 워밍업 |
| 5~15분 | 200 | 정상 트래픽 유지 |
| 15~20분 | 200 | 관찰 |

**API 비율**

| 엔드포인트 | 비율 |
|---|:---:|
| GET /api/products | 70% |
| POST /api/orders | 20% |
| POST /api/payments | 10% |

**보여줄 것:** Error Rate 0% / P95 Latency 안정 / CPU 여유 / Pod 수 변화 없음 — 양쪽 모두 정상

> **메시지:** "트래픽이 예측 가능하고 안정적이면 온프레미스도 충분합니다"

---

### 시나리오 2 — 동시 예약/주문 폭주 (20분)

> **보여주는 것:** 갑자기 트래픽이 터졌을 때 두 환경이 어떻게 반응하는가
> - 온프레미스: Pod CPU 차오름 → HPA 파드 추가 시도 → 노드 자원 없음 → Pending 쌓임 → Error Rate 급등
> - EKS: Pod CPU 차오름 → HPA 시도 → Karpenter 노드 자동 추가 → Pending 해소 → Error Rate 0%
> - Locust: **고정 토큰** 사용 (로그인 병목 제거, 주문/결제 측정에 집중)

| 항목 | 내용 |
|---|---|
| 목적 | 확장성 차이 — 갑자기 요청이 몰릴 때 HPA + Karpenter 유무가 결과를 갈라놓음 |
| 집중 노드 | 워커노드 1 (API Gateway, Product, Inventory) |
| 핵심 서비스 | Product Service, Inventory Service |
| 핵심 측정 지표 | Pending Pod / Node 자동 추가 / Error Rate / HPA desired vs current |

**트래픽 타임라인**

| 구간 | RPS | 목적 |
|---|:---:|---|
| 0~5분 | 100 | 정상 트래픽 |
| 5분 | **1,000** | **순간 급증 (타임세일 시작 재현)** |
| 5~15분 | 1,000 | 폭증 유지 |
| 15~20분 | 1,000 | 안정화 관찰 |

**API 비율** (동시 예약/주문 집중)

| 엔드포인트 | 비율 |
|---|:---:|
| GET /api/products | 50% |
| POST /api/orders | 30% |
| POST /api/payments | 20% |

| 환경 | 예상 결과 |
|---|---|
| 온프레미스 | HPA Pod 증설 시도 → 노드 자원 부족 → Pending 증가 → Error Rate 급증 |
| EKS | HPA Pod 증설 → Karpenter 노드 자동 추가 → Pending 해소 → Error Rate 0% 유지 |

**보여줄 것:** Pending Pod 타임라인 / Node Count 자동 증가 / Error Rate 차이 / HPA 괴리

> **메시지:** "여기서 운영 방식의 차이가 드러납니다"

---

### 시나리오 3 — 점진적 부하 증가 (20분)

> **보여주는 것:** 몇 RPS부터 온프레미스가 한계에 도달하는지 숫자로 찍는 것 — "차는 느낌"
> - 100 → 300 → 500 → 700 → 1000 RPS 단계별로 올리면서 CPU가 차오르고 Pending이 발생하는 구간 특정
> - 시나리오 2가 "터진다"를 보여준다면, 시나리오 3은 "N RPS에서 터진다"는 한계점을 데이터로 증명
> - Locust: **고정 토큰** 사용 (로그인 병목 제거, 주문/결제 측정에 집중)

| 항목 | 내용 |
|---|---|
| 목적 | 한계점 탐색 — 몇 RPS부터 온프레미스가 무너지는지, EKS는 어느 시점에 노드를 추가하는지 |
| 핵심 서비스 | 전체 서비스 |
| 핵심 측정 지표 | CPU 70~80% 도달 시점 / HPA 반응 시점 / Pending 발생 시점 / Error Rate 발생 시점 / Node Count 증가 시점 |

**트래픽 타임라인 (계단식 증가)**

| 구간 | RPS | 목적 |
|---|:---:|---|
| 0~2분 | 100 | 기준 |
| 2~4분 | 300 | 증가 |
| 4~6분 | 500 | 임계점 탐색 |
| 6~8분 | 700 | 부하 심화 |
| 8~10분 | 1,000 | 최대 부하 |
| 10~20분 | 1,000 | 유지 및 관찰 |

**API 비율**

| 엔드포인트 | 비율 |
|---|:---:|
| GET /api/products | 50% |
| POST /api/orders | 30% |
| POST /api/payments | 20% |

| 환경 | 예상 결과 |
|---|---|
| 온프레미스 | 특정 RPS 구간에서 CPU 급등 → HPA 발동 → Pending → Error Rate 발생 — 한계점 데이터로 확인 |
| EKS | HPA 발동 → Karpenter 노드 추가 → Pending 없이 계속 확장 — 자동 대응 시점 데이터로 확인 |

**보여줄 것:** RPS 증가 구간별 CPU / Error Rate 발생 시점 / EKS Node Count 증가 타이밍

> **메시지:** "성능 차이보다 중요한 것은, 한계에 도달했을 때 자동으로 대응할 수 있느냐입니다"

---

### 시나리오 4 — 장애 복구 (20분)

> **보여주는 것:** 노드가 죽었을 때 서비스가 언제 다시 살아나는가 (MTTR) + 부분 장애 현실
> - 워커노드 2 종료 시 Order/Payment/User는 죽고, Product(노드 1)는 살아있어 상품 조회는 됨
> - "상품은 보이는데 주문이 안 된다" — 이 시간 동안 발생한 결제 실패가 비즈니스 손실로 직결
> - Locust: **실제 사용자 흐름** 사용 (로그인 포함 혼합 트래픽 — 장애가 현실처럼 보이게)

| 항목 | 내용 |
|---|---|
| 목적 | 운영 복구력 — 장애 발생 시 복구 속도와 비즈니스 손실 차이 |
| 장애 대상 | **워커노드 2** 강제 종료 → 프론트, Order, Payment, User Service 영향 |
| 핵심 서비스 | Order Service, Payment Service |
| 핵심 측정 지표 | MTTR / 결제 실패 건수 / Pending Pod / 데이터 정합성 |

**트래픽 타임라인**

| 구간 | RPS | 목적 |
|---|:---:|---|
| 0~5분 | 500 | 실제 사용자 흐름 (로그인 + 조회 + 주문 + 결제 혼합) |
| 5분 | — | **워커노드 2 강제 종료** |
| 5~15분 | 500 | 복구 관찰 |
| 15~20분 | 500 | 정상 확인 |

**API 비율** (실제 사용자 흐름)

| 엔드포인트 | 비율 |
|---|:---:|
| POST /api/auth/login | 10% |
| GET /api/products | 40% |
| POST /api/orders | 30% |
| POST /api/payments | 20% |

| 환경 | 예상 결과 |
|---|---|
| 온프레미스 | 죽은 Pod → 워커노드1 재스케줄 시도 → 자원 부족 → Pending → 복구 5~10분 → 결제 실패 N건 |
| EKS | Karpenter 신규 노드 추가 → Pod 재배치 → 복구 30~60초 → 결제 실패 최소화 |

**보여줄 것:** MTTR 비교 / 장애 중 결제 실패 건수 / Pending Pod 타임라인 / Node Count 변화

> **메시지:** "복구 시간이 곧 비즈니스 손실입니다"

---

### 시나리오 진행 순서

```
시나리오 1 (20분) → DB 리셋 후
시나리오 2 (20분) → DB 리셋 후
시나리오 3 (20분) → DB 리셋 후
시나리오 4 (20분)

총 80분 + 각 시나리오 간 DB 리셋 시간 (약 5분씩)
실제 약 2시간 예상
```

> Locust 스크립트는 GitHub 공통 레포에서 한 명이 관리하고 양쪽 동일 스크립트를 사용한다.  
> 시나리오 2·3은 LoadTestShape 클래스로 RPS 패턴을 분리해 구현한다.

---

## 모니터링

### 지표 수집

| 도구 | 대상 | 수집 지표 |
|---|---|---|
| prom-client | Express.js 앱 | TPS, Latency, Error Rate, API별 응답시간 |
| kube-state-metrics | k8s 클러스터 | Pod 수, Node 수, Pending Pod, HPA 상태 |
| Node Exporter | VM / 노드 | CPU, RAM, 디스크, 네트워크 |
| PostgreSQL Exporter | PostgreSQL | Active Connection, 쿼리 응답시간, Lock 대기 |
| Redis Exporter | Redis | 캐시 히트율, 메모리 사용량 |
| Fluent Bit + OpenSearch | 모든 Pod 로그 | 에러 원인, MTTR 정밀 측정 |

### 수집 흐름

```
각 서버 / Pod
      ├─ scrape (15초 간격) → Prometheus → Grafana        (숫자: WHAT)
      └─ 로그 전송          → OpenSearch → Dashboards     (로그: WHY)

Prometheus: 온프레미스 + EKS 양쪽 동시 scrape → Grafana 하나에서 나란히 비교
OpenSearch: Fluent Bit이 양쪽 로그 수집 → 인덱스로 env 구분 (onprem / eks)
```

### 대시보드 구성

#### 템플릿에서 가져올 패널

| 템플릿 (ID) | 가져올 패널 |
|---|---|
| Node Exporter Full (1860) | CPU 사용률, Memory 사용률, Network I/O |
| Kubernetes Cluster (315) | Pod Count, Node Count, Pending Pod 타임라인 |
| PostgreSQL (9628) | Active Connection, 쿼리 응답시간, Lock 대기 |
| Redis (11835) | 캐시 히트율, Memory 사용량 |

#### 직접 제작 패널 상세

**상단 — 비즈니스 지표 (온프레미스 | EKS 나란히)**

| # | 패널명 | 수집 도구 | PromQL 메트릭 | 설명 |
|:---:|---|---|---|---|
| 1 | TPS | prom-client | `rate(http_requests_total[1m])` | 초당 처리 요청 수 — 폭증 시 처리량 차이 |
| 2 | P95 Latency | prom-client | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[1m]))` | 95번째 백분위 응답시간 — 폭증 시 얼마나 튀는지 |
| 3 | Error Rate | prom-client | `rate(http_requests_total{status=~"5.."}[1m]) / rate(http_requests_total[1m])` | 5xx 에러 비율 — **온프레미스 치솟고 EKS 0% 유지** |

**중단 — k8s 반응 (온프레미스 | EKS 나란히)**

| # | 패널명 | 수집 도구 | PromQL 메트릭 | 설명 |
|:---:|---|---|---|---|
| 4 | Pod Count | kube-state-metrics | `count(kube_pod_status_phase{phase="Running"})` | Running 상태 Pod 수 타임라인 |
| 5 | Node Count | kube-state-metrics | `count(kube_node_info)` | 노드 수 — EKS는 Karpenter로 자동 증가하는 순간 포착 |
| 6 | Pending Pod | kube-state-metrics | `count(kube_pod_status_phase{phase="Pending"})` | **발표 임팩트 최강** — 온프레미스 쌓임 / EKS 0 유지 |
| 7 | HPA current vs desired | kube-state-metrics | `kube_horizontalpodautoscaler_status_current_replicas` / `kube_horizontalpodautoscaler_spec_max_replicas` | 원하는 Pod 수 vs 실제 Pod 수 — 괴리가 크면 노드 부족 상태 |

**하단 — 인프라**

| # | 패널명 | 수집 도구 | PromQL 메트릭 | 설명 |
|:---:|---|---|---|---|
| 8 | CPU 사용률 | Node Exporter | `1 - avg(rate(node_cpu_seconds_total{mode="idle"}[1m]))` | 노드 전체 CPU 사용률 |
| 9 | Memory 사용률 | Node Exporter | `1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` | 노드 메모리 사용률 |
| 10 | DB Connection 수 | PostgreSQL Exporter | `pg_stat_activity_count` | PostgreSQL 활성 커넥션 수 — 폭증 시 병목 확인 |
| 11 | Redis 캐시 히트율 | Redis Exporter | `rate(redis_keyspace_hits_total[1m]) / (rate(redis_keyspace_hits_total[1m]) + rate(redis_keyspace_misses_total[1m]))` | 캐시 효율 — 낮으면 DB 직접 조회 폭증 신호 |

**하단 — API 상세**

| # | 패널명 | 수집 도구 | PromQL 메트릭 | 설명 |
|:---:|---|---|---|---|
| 12 | API 엔드포인트별 응답시간 | prom-client | `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{path=~"/api/.*"}[1m])) by (path)` | `/products` / `/orders` / `/payments` 각각 병목 지점 확인 |

#### 최종 레이아웃 요약

```
┌─────────────────────────────────────────────────────┐
│  상단 — 비즈니스 지표 (온프레미스 | EKS 나란히)       │
│  #1 TPS  |  #2 P95 Latency  |  #3 Error Rate        │
├─────────────────────────────────────────────────────┤
│  중단 — k8s 반응 (온프레미스 | EKS 나란히)            │
│  #4 Pod Count  |  #5 Node Count  |  #6 Pending Pod  │
│  #7 HPA current vs desired                          │
├─────────────────────────────────────────────────────┤
│  하단 — 인프라 + API 상세                             │
│  #8 CPU  |  #9 Memory  |  #10 DB Conn  |  #11 Redis │
│  #12 API 엔드포인트별 응답시간                        │
└─────────────────────────────────────────────────────┘
```

#### 발표 핵심 화면

```
┌─────────────────────────┬─────────────────────────┐
│     온프레미스          │         AWS EKS          │
│  Error Rate:  37%       │  Error Rate:   0.3%      │
│  Pending Pod: 급증 ↑    │  Pending Pod:  0         │
└─────────────────────────┴─────────────────────────┘
         이 화면 하나로 설명이 필요 없다
```

---

## CI/CD

```
코드 푸시
  → GitHub Actions 자동 트리거
  → Docker 이미지 빌드 + Trivy 보안 스캔
  → AWS ECR 푸시
  → 양쪽 환경 자동 배포
      ├── 온프레미스 k8s (kubectl apply)
      └── EKS (kubectl apply)
```

> 이미지 버전 태그로 양쪽 환경에 완전히 동일한 이미지 배포를 보장한다.  
> ECR 인증 — EKS: 노드 IAM Role 자동 / 온프레미스: 실험 전 수동 갱신 (imagePullSecrets)

---

## 로컬 개발 환경

로컬에서 서비스를 단계별로 올리며 개발·검증하는 환경.  
소스: `msa_shoply/`

### 구현 현황

| 차수 | 서비스 | 상태 | 포트 |
|:---:|---|:---:|:---:|
| 인프라 | PostgreSQL, Redis | ✅ 완료 | 5432 / 6379 |
| 1차 | User Service + API Gateway + Frontend | ✅ 완료 | 4005 / 4000 / 3000 |
| 2차 | Product Service | ✅ 완료 | 4001 |
| 3차 | Inventory Service | ✅ 완료 | 4002 |
| 4차 | Order Service | ✅ 완료 | 4003 |
| 5차 | Payment Service | ✅ 완료 | 4004 |

### 프로젝트 구조

```
msa_shoply/
├── docker-compose.yml        # 로컬 개발용 컨테이너 구성
├── .env.example              # 환경변수 템플릿
├── .env                      # 실제 환경변수 (git 제외)
├── db/
│   ├── schema.sql            # 테이블 및 인덱스 정의
│   ├── seed.sql              # 부하 테스트용 대규모 데이터
│   └── generate-seed.js      # seed 생성 스크립트
├── k8s/                      # Kubernetes 매니페스트 — ✅
│   ├── common/               # 환경 공통 (Deployment, Service, HPA)
│   ├── onprem/               # 온프레미스 전용 (ConfigMap IP, Ingress, NodePort)
│   └── eks/                  # EKS 전용 (ALB, Karpenter, IRSA)
├── gateway/                  # API Gateway (Express.js) — ✅
│   └── src/
│       ├── index.ts          # 라우팅 + 프록시
│       └── metrics.ts        # Prometheus prom-client
├── services/
│   ├── user/                 # User Service — ✅
│   │   └── src/routes/auth.ts   # POST /login, GET /me
│   ├── product/              # Product Service — ✅
│   │   └── src/routes/products.ts  # GET /products, GET /products/:id
│   ├── inventory/            # Inventory Service — ✅
│   │   └── src/routes/inventory.ts # GET /:id, POST /reserve|deduct|release
│   ├── order/                # Order Service — ✅
│   │   └── src/routes/orders.ts    # POST /orders, GET /orders/:id, PATCH /orders/:id/status
│   └── payment/              # Payment Service — ✅
│       └── src/routes/payments.ts  # POST /payments, GET /stats
└── frontend/                 # Vite + React — ✅
    └── src/routes/
        ├── index.tsx          # 메인 (상품 목록)
        ├── login.tsx          # 로그인
        ├── products.$productId.tsx  # 상품 상세
        ├── timesale.tsx       # 타임세일
        ├── checkout.tsx       # 주문/결제
        ├── stats.tsx          # 실패 현황
        └── admin.tsx          # 어드민 (타임세일 제어판 — admin 전용)
```

### 포트 구성

| 서비스 | 컨테이너명 | 포트 |
|---|---|:---:|
| API Gateway | msa_gateway | 4000 |
| Product Service | msa_product | 4001 |
| Inventory Service | msa_inventory | 4002 |
| Order Service | msa_order | 4003 |
| Payment Service | msa_payment | 4004 |
| User Service | msa_user | 4005 |
| Frontend | msa_frontend | 3000 |
| PostgreSQL | msa_postgres | 5432 |
| Redis | msa_redis | 6379 |

### 빠른 시작

```bash
# 1. 환경변수 설정
cp msa_shoply/.env.example msa_shoply/.env

# 2. 인프라 먼저 기동 (PostgreSQL + Redis)
docker compose -f msa_shoply/docker-compose.yml up postgres redis -d

# 3. 서비스는 배포 및 검증 순서에 따라 단계별로 올림
#    → docker-compose.yml 내 주석 해제하여 순서대로 추가
```

> DB 초기화는 자동 실행: `schema.sql` → 테이블 생성, `seed.sql` → 유저 ~1,000명 / 상품 456개 / 재고 2,736건 삽입 (부하 테스트용 대규모 데이터)

### 환경변수 구조 (.env.example)

| 구분 | 변수 | 기본값 |
|---|---|---|
| PostgreSQL | POSTGRES_DB / USER / PASSWORD / HOST / PORT | shoply / shoply / shoply1234 / postgres / 5432 |
| Redis | REDIS_HOST / REDIS_PORT | redis / 6379 |
| JWT | JWT_SECRET | change-me-in-production |
| 서비스 URL | USER_SERVICE_URL 외 4개 | http://{서비스명}:{포트} |

---

## 배포 및 검증 순서

서비스를 한 번에 올리지 않고 단계별로 올리며 각 단계에서 동작을 확인한다.  
**공통:** 매 단계에 API Gateway + 프론트 + PostgreSQL + Redis 항상 포함.

| 단계 | 추가 서비스 | 확인 항목 |
|:---:|---|---|
| 1차 | PostgreSQL, Redis, User Service, API Gateway, 프론트 | 로그인 / JWT 발급 / 페이지 렌더링 |
| 2차 | + Product Service | 상품 목록 / 상품 상세 / Redis 캐싱 |
| 3차 | + Inventory Service | 재고 조회 / 재고 차감 / 동시성 처리 |
| 4차 | + Order Service | 주문 생성 / 주문 상태 변경 / 재고 선점 |
| 5차 | + Payment Service | 결제 처리 / 성공·실패 / 재고 최종 차감 / **전체 흐름** |

**각 단계 확인 방법**

```
API Gateway 없는 서비스 호출 → 503 반환 (정상) → 다음 단계에서 추가
전체 흐름 확인               → 프론트 페이지 눈으로 확인 + curl API 직접 호출 병행
```

> 최종 전체 흐름: 로그인 → 상품 조회 → 주문 → 결제

---

## 실험 범위

### Must Have

| 항목 | 내용 |
|---|---|
| 서비스 | 5개 + PostgreSQL + Redis |
| 페이지 | 7개 |
| API | 5개 |
| 시나리오 | 4개 |
| 대시보드 | 템플릿 4개 + 직접 제작 12개 패널 |
| 최대 부하 | Locust 1,000 RPS |

### Nice to Have

**서비스 추가**
- `Search Service` — 시나리오 2 강화 (검색 + 조회 동시 병목 비교)
- `Notification Service` — 시나리오 3 강화 (장애 중 알림 유실 건수 측정)

**페이지 추가**
- 검색 결과 페이지
- 알림 내역
- 동시 접속자 수 실시간 표시

**대시보드 추가**
- 서비스별 병목 비교 패널
- 알림 유실률
- 검색 응답시간

---

## 문서

| 문서 | 설명 |
|---|---|
| [인프라 가이드](문서/인프라_가이드.md) | VPC·SG·파드배치·nodeAffinity·HPA + LXD K8s 구축 12단계 + 트러블슈팅 + 확정 설정값 |
| [데이터베이스 가이드](문서/데이터베이스_가이드.md) | PostgreSQL 스키마·핵심 쿼리·SELECT FOR UPDATE·Redis 캐싱·EC2/RDS 구축·검증·관리 쿼리 |
| [모니터링 구성 가이드](문서/모니터링.md) | 수집 도구·PromQL·Grafana 대시보드·Exporter 설치·iptables DNAT·실제 배포 정보 |
| [서비스 테스트 가이드](문서/테스트.md) | 1~5차 서비스 curl 테스트, 동시성 검증, 전체 흐름 통합 테스트 |
| [전체 작업 목록](문서/전체_작업_목록.md) | 인프라 결정 사항, 온프레미스·EKS·공통 전체 작업 체크리스트, 현재 진행 상태 |
| [온프레미스 현황 요약](문서/onpre-summary.md) | 실제 배포된 온프레미스 환경 요약 (EC2 IP, k8s 버전, 배포 서비스, 파일 위치) |
| [K8s 진단 명령어](문서/k8s-debug-commands.md) | 사이트 접속 불가 체크 순서, Pod·서비스·ConfigMap 확인, Deployment 재시작, 리소스 조회 |

---

## 기술 스택

### 인프라 / 컨테이너

| 항목 | 버전 |
|---|---|
| Ubuntu (온프레미스 VM) | 24.04.4 LTS |
| k8s | v1.34.x (온프레미스·EKS 동일) |
| CNI (온프레미스) | Flannel v0.26.7 |
| CNI (EKS) | AWS VPC CNI |
| Docker Engine | 29.3.1 |
| Docker Compose | v5.1.1 |
| PostgreSQL | 16-alpine |
| Redis | 7-alpine |
| Nginx | alpine (프론트 정적 서빙) |
| Node.js | 22-alpine (모든 서비스 기반) |

### 모니터링 / 로그

| 항목 | 용도 |
|---|---|
| Prometheus | 메트릭 수집 (15초 간격) |
| Grafana | 대시보드 시각화 |
| Fluent Bit | Pod 로그 수집 → OpenSearch 전송 |
| Amazon OpenSearch Service | 로그 저장 및 에러 원인 분석 |
| OpenSearch Dashboards | 로그 시각화 및 MTTR 측정 |

### 백엔드 서비스 공통

| 패키지 | 버전 |
|---|---|
| Express.js | 4.18.2 |
| TypeScript | 5.3.3 |
| ts-node-dev | 2.0.0 |
| prom-client | 15.1.0 |
| pg (node-postgres) | 8.11.3 |

### 서비스별 추가 패키지

| 서비스 | 패키지 | 버전 |
|---|---|---|
| User Service | bcryptjs | 2.4.3 |
| User Service | jsonwebtoken | 9.0.2 |
| Product Service | ioredis | 5.3.2 |
| API Gateway | http-proxy-middleware | 3.0.2 |
| API Gateway | jsonwebtoken | 9.0.2 |

### 프론트엔드

| 패키지 | 버전 |
|---|---|
| React | 19 |
| Vite | 6 |
| TanStack Router | 1.168 |
| Tailwind CSS | 4 |
| lucide-react | 0.475 |

### 시드 데이터 생성

| 항목 | 내용 |
|---|---|
| AWS Bedrock | Claude 3.5 Sonnet v2 (apac) |
| 리전 | ap-northeast-2 (서울) |

---

*온프레미스 k8s vs AWS EKS 비교 실험 프로젝트 | 인프라 아키텍처 팀*
