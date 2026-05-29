# 온프레미스 K8s 환경 구축 요약

> 쇼핑몰 MSA를 온프레미스 K8s(AWS EC2 + LXD) vs AWS EKS 비교 실험용 환경 구축 완료 기록

---

## 최종 아키텍처

```
인터넷
  ↓
EC2 퍼블릭 IP (43.203.67.58)
  ↓
호스트 Nginx (80 → 30080 프록시)
  ↓
ingress-nginx (NodePort 30080)
  ↓ (LXD 내부 네트워크 10.98.82.x)
┌─────────────────────────────────┐
│       K8s 클러스터 (LXD)         │
│                                 │
│  gateway → user-svc             │
│         → product-svc    ───────┼──→ PostgreSQL EC2 (10.0.2.128:5432)
│         → inventory-svc  ───────┼──→ Redis EC2 (10.0.6.15:6379)
│         → order-svc             │
│         → payment-svc           │
│                                 │
│  frontend-svc                   │
└─────────────────────────────────┘
```

---

## EC2 구성 현황

| 역할 | 인스턴스 | IP | OS |
|---|---|---|---|
| K8s 호스트 (Spot) | c8i-flex.2xlarge | 43.203.67.58 (퍼블릭) / 10.0.5.175 (프라이빗) | Ubuntu 24.04 |
| PostgreSQL | t3.medium | 10.0.2.128 | Ubuntu |
| Redis | t3.small | 10.0.6.15 | Ubuntu |

---

## K8s 클러스터 구성

| 항목 | 값 |
|---|---|
| 가상화 | LXD (KVM 미지원으로 대체) |
| K8s 버전 | 1.34.8 |
| 노드 | master 1 + worker 2 (LXD 컨테이너) |
| 노드 스펙 | 2 core / 4GB RAM / 30GB disk (각각) |
| CNI | Flannel v0.26.7 |
| Ingress | ingress-nginx 4.9.0 (NodePort 30080) |
| Helm | v3.14.0 |
| metrics-server | v0.8.0 |
| kube-state-metrics | v2.19.0 |
| HPA | CPU 기반 (gateway/product/inventory/order/payment) |

---

## 배포된 서비스

| 서비스 | 이미지 | 포트 |
|---|---|---|
| frontend | ghcr.io/incheon-soda/shoply-frontend:latest | 80 |
| gateway | ghcr.io/incheon-soda/shoply-gateway:latest | 4000 |
| user | ghcr.io/incheon-soda/shoply-user:latest | 4005 |
| product | ghcr.io/incheon-soda/shoply-product:latest | 4001 |
| inventory | ghcr.io/incheon-soda/shoply-inventory:latest | 4002 |
| order | ghcr.io/incheon-soda/shoply-order:latest | 4003 |
| payment | ghcr.io/incheon-soda/shoply-payment:latest | 4004 |

---

## 트래픽 흐름

```
외부 요청
  → EC2:80 → Nginx → k8s-master:30080
  → ingress-nginx
  → /api/* → gateway-svc:4000
  → /     → frontend-svc:80
```

---

## 주요 설정 파일 위치

| 파일 | 설명 |
|---|---|
| `msa_shoply/k8s/common/` | 공통 K8s 매니페스트 |
| `msa_shoply/k8s/onprem/` | 온프레미스 전용 설정 (configmap, ingress, NodePort) |
| `msa_shoply/k8s/eks/` | EKS 전용 설정 |
| `msa_shoply/infra/postgres/` | PostgreSQL Docker Compose + 스키마/시드 |
| `msa_shoply/infra/redis/` | Redis Docker Compose |
| `msa_shoply/infra/monitoring/` | Prometheus + Grafana Docker Compose |
| `문서/인프라_가이드.md` | 아키텍처 설계 + LXD K8s 구축 + 트러블슈팅 + 확정 설정값 |
| `문서/모니터링.md` | 모니터링 전략 + Exporter 설치 + Grafana 대시보드 |

---

## 상태 확인 명령어

```bash
# 노드 상태
lxc exec k8s-master -- kubectl get nodes

# 서비스 Pod 상태
lxc exec k8s-master -- kubectl get pods -n shoply

# 전체 Pod 상태
lxc exec k8s-master -- kubectl get pods -A

# 접속 테스트
curl http://43.203.67.58/
```

---

## DB 재설치 방법 (참고)

```bash
# PostgreSQL EC2
scp -i ~/key/aws-3tier-keypair.pem -r msa_shoply/infra/postgres ubuntu@10.0.2.128:~/
ssh -i ~/key/aws-3tier-keypair.pem ubuntu@10.0.2.112
cd postgres && docker compose up -d
docker compose logs -f   # seed.sql 적재 완료까지 대기

# Redis EC2
scp -i ~/key/aws-3tier-keypair.pem -r msa_shoply/infra/redis ubuntu@10.0.7.99:~/
ssh -i ~/key/aws-3tier-keypair.pem ubuntu@10.0.7.99
cd redis && docker compose up -d
```