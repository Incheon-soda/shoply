# 온프레미스 K8s 설정값 (EKS 비교용)

> 이 파일은 온프레미스 클러스터에서 직접 선택/설정한 값들을 정리한 것입니다.
> EKS와의 차이점을 비교할 때 참고하세요.

---

## 인프라

| 항목 | 온프레미스 설정값 | 비고 |
|---|---|---|
| 호스트 | AWS EC2 c8i-flex.2xlarge | Spot 인스턴스 |
| 가상화 | LXD 컨테이너 | KVM 미지원으로 대체 |
| 호스트 OS | Ubuntu 24.04 LTS | |
| 노드 OS | Ubuntu 24.04 LTS (LXD) | |
| 노드 수 | 3 (master 1 + worker 2) | |

---

## Kubernetes

| 항목 | 온프레미스 설정값 | 비고 |
|---|---|---|
| K8s 버전 | **1.32.12** | EKS 버전과 맞춤 |
| kubeadm | 1.32.12-1.1 | |
| kubelet | 1.32.12-1.1 | |
| kubectl | 1.32.12-1.1 | |
| 컨테이너 런타임 | containerd | SystemdCgroup = true |
| 클러스터 초기화 | kubeadm init | |

---

## 네트워크

| 항목 | 온프레미스 설정값 | 비고 |
|---|---|---|
| CNI | Flannel | |
| Flannel 버전 | **v0.26.7** | |
| Pod Network CIDR | **10.244.0.0/16** | kubeadm init 시 지정 |
| Service Network CIDR | 10.96.0.0/12 | K8s 기본값 |
| Flannel 백엔드 | vxlan | 기본값 |

---

## Ingress

| 항목 | 온프레미스 설정값 | 비고 |
|---|---|---|
| Ingress Controller | ingress-nginx | |
| ingress-nginx 버전 | **4.9.0** | Helm chart 버전 |
| Service 타입 | **NodePort** | EKS는 LoadBalancer |
| HTTP NodePort | **30080** | 외부 노출 포트 |

---

## 외부 데이터베이스

| 서버 | 인스턴스 | 프라이빗 IP | 포트 |
|---|---|---|---|
| PostgreSQL | t3.medium (gp3 20GB) | 10.0.2.128 | 5432 |
| Redis | t3.small | 10.0.6.15 | 6379 |

- DB/Redis는 K8s 클러스터 외부 EC2에서 Docker Compose로 운영
- 같은 VPC 내 프라이빗 IP로 통신
- 보안그룹으로 K8s EC2에서만 접근 허용
- 스키마/시드 데이터: `msa_shoply/infra/postgres/init/` 참고

---

## 패키지 매니저

| 항목 | 버전 |
|---|---|
| Helm | v3.14.0 |

---

## kube-proxy 커스텀 설정

| 항목 | 설정값 | 이유 |
|---|---|---|
| conntrack.maxPerCore | **0** | LXD 컨테이너에서 netfilter sysctl 쓰기 권한 없음 → 수정 비활성화 |

---

## EKS와 주요 차이점 (예상)

| 항목 | 온프레미스 | EKS |
|---|---|---|
| 노드 | LXD 컨테이너 (가상) | EC2 인스턴스 (실제 VM) |
| CNI | Flannel | AWS VPC CNI |
| Ingress | NodePort + 호스트 Nginx | ALB / NLB (LoadBalancer) |
| 스토리지 | 없음 (미설정) | EBS CSI Driver |
| IAM 연동 | 없음 | IRSA (IAM Roles for Service Accounts) |
| 오토스케일링 | 없음 | Cluster Autoscaler / Karpenter |
| 컨트롤플레인 | 직접 관리 (kubeadm) | AWS 완전 관리형 |