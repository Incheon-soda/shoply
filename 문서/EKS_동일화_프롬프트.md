# EKS ↔ 온프레미스 동일화 작업 프롬프트

> 다른 AI에게 이 내용을 그대로 전달하세요.

---

## 작업 목표

쇼핑몰 MSA를 **온프레미스 K8s vs AWS EKS** 로 비교 실험하는 프로젝트입니다.
공정한 비교를 위해 **두 환경의 스펙·버전·서비스 구성을 최대한 동일하게** 맞춰야 합니다.

당신의 임무:
1. 온프레미스 기준에 맞춰 **EKS 매니페스트(`k8s/eks/`)를 검토/수정**
2. **버전·리소스·HPA·서비스 구성**을 온프레미스와 동일하게
3. EKS에만 있고 온프레미스에 없는 기능(또는 반대)은 **비슷하게라도 대응**시킬 것
4. 동일화 불가능한 항목은 **왜 다른지, 어떻게 보정하는지** 명시

---

## 온프레미스 확정 스펙 (이 값에 EKS를 맞춘다)

### K8s 코어

| 항목 | 값 |
|---|---|
| K8s 버전 | **1.34.8** |
| 컨테이너 런타임 | containerd (SystemdCgroup=true) |
| CNI | Flannel v0.26.7 (pod-network: 10.244.0.0/16) |
| Service CIDR | 10.96.0.0/12 |

### 노드

| 항목 | 값 |
|---|---|
| 워커 노드 | 2개 (각 2vCPU / 4GB RAM) |
| 노드 OS | Ubuntu 24.04 |
| 초기 노드 확장 | **없음 (고정)** — EKS는 Karpenter로 확장 (= 핵심 비교 변수, 동일화 X) |

### 서비스 (namespace: shoply, 총 7개)

| 서비스 | 포트 | replicas | CPU req/limit | Mem req/limit |
|---|---|---|---|---|
| frontend | 80 | 1 | 50m / 200m | 64Mi / 128Mi |
| gateway | 4000 | 1 | 100m / 500m | 128Mi / 512Mi |
| user | 4005 | 1 | 100m / 500m | 128Mi / 512Mi |
| product | 4001 | 1 | 100m / 500m | 128Mi / 512Mi |
| inventory | 4002 | 1 | 100m / 500m | 128Mi / 512Mi |
| order | 4003 | 1 | 100m / 500m | 128Mi / 512Mi |
| payment | 4004 | 1 | 100m / 500m | 128Mi / 512Mi |

> 이미지: `ghcr.io/incheon-soda/shoply-*:latest` (public, 양쪽 동일하게 사용)

### HPA (5개 서비스: gateway/product/inventory/order/payment)

| 항목 | 값 |
|---|---|
| minReplicas | 1 |
| maxReplicas | 99 |
| metric | CPU Utilization |
| target | 60% |
| scaleDown stabilizationWindow | 60초 |

### 외부 데이터베이스

| 항목 | 온프레미스 | EKS (맞춰야 함) |
|---|---|---|
| PostgreSQL | EC2 Docker, PostgreSQL 16 | RDS PostgreSQL 16 (동일 버전) |
| max_connections | 200 | **200으로 맞출 것** |
| Redis | EC2 Docker, Redis 7 | EC2 Docker, Redis 7 (동일) |

---

## EKS에서 다르게 가는 것 (의도적 — 이건 동일화 X)

| 항목 | 온프레미스 | EKS | 이유 |
|---|---|---|---|
| 노드 확장 | 고정 2노드 | **Karpenter 자동 확장** | 핵심 비교 변수 |
| Ingress | ingress-nginx + NodePort | **ALB (AWS Load Balancer Controller)** | 각 환경 표준 |
| CNI | Flannel | **AWS VPC CNI** | 각 환경 표준 |
| 컨트롤플레인 | kubeadm 직접 | **AWS 관리형** | EKS 본질 |

> 위 항목은 "비교 대상"이므로 강제로 같게 만들면 안 됨.

---

## EKS에 있고 온프레미스에 없는 것 → 비슷하게 대응

| EKS 기능 | 온프레미스 대응 | 처리 방법 |
|---|---|---|
| metrics-server (EKS 기본) | metrics-server 수동 설치함 | 양쪽 다 있음 ✅ |
| ALB | ingress-nginx | 둘 다 L7 라우팅 → 기능 동등 |
| IRSA (IAM Role) | 없음 | 온프레미스는 평문 시크릿 — 영향 없음 |
| EBS CSI Driver | 없음 (DB 외부 EC2) | 양쪽 다 외부 DB → 무관 |

---

## 구체적 요청 사항

1. **`k8s/eks/` 폴더의 매니페스트 검토**
   - `configmap-patch.yaml` — RDS 엔드포인트, Redis IP로 채울 자리 확인
   - `karpenter-nodepool.yaml` — t3.medium(2vCPU/4GB) 노드로 설정됐는지, CPU 상한 확인
   - `serviceaccount.yaml` — ALB/Karpenter용 IRSA 설정 확인
   - **`ingress-alb.yaml`이 없으면 생성** (ingress-nginx의 ALB 버전)

2. **공통 매니페스트(`k8s/common/`)가 EKS에도 그대로 적용 가능한지 검증**
   - frontend/gateway/user/product/inventory/order/payment/hpa
   - NodePort 서비스(`k8s/onprem/nodeport-services.yaml`)는 EKS에선 어떻게 대체할지

3. **버전 검증 명령어 제공** — EKS 구축 후 온프레미스와 비교할 체크리스트
   ```bash
   kubectl version --short
   kubectl get nodes -o wide
   kubectl get pod -n kube-system -o jsonpath='{range .items[*]}{.spec.containers[0].image}{"\n"}{end}' | sort -u
   helm list -A
   ```

4. **Karpenter NodePool 설정**
   - 인스턴스 타입: t3.medium (온프레미스 워커와 동일 스펙)
   - CPU 상한: 비용 보호용 (예: 16 = 최대 8노드)

5. **모니터링 대응**
   - 온프레미스: node_exporter + kube-state-metrics + 앱 prom-client (NodePort)
   - EKS: 동일하게 node_exporter(DaemonSet) + kube-state-metrics + 앱 메트릭
   - Prometheus가 양쪽을 스크레이프 (EKS는 워커 공인IP:NodePort)

---

## 산출물

1. 수정된 `k8s/eks/` 매니페스트 전체
2. 누락된 파일 생성 (ingress-alb.yaml 등)
3. EKS 구축 순서 가이드 (eksctl 또는 콘솔)
4. 온프레미스 ↔ EKS 버전 비교 체크리스트
5. 동일화 불가 항목 + 보정 설명