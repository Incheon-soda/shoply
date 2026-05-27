# K8s 환경 기술스택

## 인프라 구성

| 레이어 | 항목 | 버전 | 비고 |
|---|---|---|---|
| 하이퍼바이저 | VMware Workstation | - | Windows 호스트 |
| VM OS | Ubuntu Server | 22.04.5 LTS | VMware VM |
| 가상화 | KVM + libvirt | - | VMware VM 위에서 동작 |
| 컨테이너 런타임 | containerd | 1.7.29 | SystemdCgroup = true |
| 컨테이너 엔진 | Docker CE | 25.0.5 | 이미지 빌드용 |

---

## K8s 클러스터

| 항목 | 버전 | 비고 |
|---|---|---|
| Kubernetes | 1.32.13 | kubeadm / kubelet / kubectl |
| CNI | Flannel | v0.26.7, pod-network-cidr: 10.244.0.0/16 |
| Ingress Controller | ingress-nginx | 4.9.0 (Helm) |
| 패키지 매니저 | Helm | 3.14.0 |

---

## 클러스터 노드 구성

| 노드 | IP | CPU | RAM | 디스크 | 역할 |
|---|---|---|---|---|---|
| k8s-master | 192.168.122.165 | 2코어 | 4GB | 30GB | control-plane |
| k8s-worker1 | 192.168.122.244 | 2코어 | 4GB | 30GB | worker |
| k8s-worker2 | 192.168.122.21 | 2코어 | 4GB | 30GB | worker |

---

## 네트워크 구성

| 항목 | 대역 | 비고 |
|---|---|---|
| 호스트 (VMware) | 192.168.0.78 | 브리지 모드 (공유기 대역) |
| KVM 내부 NAT | 192.168.122.x | KVM VM 간 통신 |
| Pod Network | 10.244.0.0/16 | Flannel CNI |
| Service Network | 10.96.0.0/12 | K8s 기본값 |

---

## Namespace

| Namespace | 용도 |
|---|---|
| accommodation | 서비스 배포 (PostgreSQL, FastAPI 등) |
| ingress-nginx | Ingress Controller |
| kube-flannel | Flannel CNI |
| kube-system | K8s 시스템 컴포넌트 |
