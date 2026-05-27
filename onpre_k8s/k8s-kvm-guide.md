# K8s KVM 클러스터 구축 가이드

## 환경 정보

| 항목 | 값 |
|---|---|
| 호스트 OS | Ubuntu 22.04 LTS (VMware VM) |
| 호스트 IP | 192.168.0.78 |
| KVM 네트워크 대역 | 192.168.122.x (NAT) |

---

## VM 목록 및 접속 정보

| VM | IP | 아이디 | 패스워드 | 역할 |
|---|---|---|---|---|
| k8s-master | 192.168.122.165 | ubuntu | ubuntu1234 | 마스터 노드 |
| k8s-worker1 | 192.168.122.244 | ubuntu | ubuntu1234 | 워커 노드 1 |
| k8s-worker2 | 192.168.122.21 | ubuntu | ubuntu1234 | 워커 노드 2 |

> ⚠️ KVM VM IP는 DHCP라 재부팅 시 바뀔 수 있습니다.
> 바뀌면 호스트에서 `virsh net-dhcp-leases default` 로 확인

---

## 접속 방법

### 1. 호스트(VMware VM)에 먼저 접속

Windows PC에서 PowerShell 또는 cmd 열고

```bash
ssh user@192.168.0.78
```

### 2. Windows에서 KVM VM 직접 접속 (ProxyJump)

```cmd
# 마스터 노드
ssh -J user@192.168.0.78 ubuntu@192.168.122.165

# 워커 노드 1
ssh -J user@192.168.0.78 ubuntu@192.168.122.244

# 워커 노드 2
ssh -J user@192.168.0.78 ubuntu@192.168.122.21
```

### 3. 호스트에서 KVM VM 접속

```bash
ssh ubuntu@192.168.122.165  # master
ssh ubuntu@192.168.122.244  # worker1
ssh ubuntu@192.168.122.21   # worker2
```

### 4. VM IP 재확인 방법

```bash
virsh net-dhcp-leases default
```

### 5. VM 상태 관리

```bash
# 전체 VM 목록 및 상태 확인
virsh list --all

# VM 시작
virsh start k8s-master
virsh start k8s-worker1
virsh start k8s-worker2

# VM 정상 종료
virsh shutdown k8s-master
virsh shutdown k8s-worker1
virsh shutdown k8s-worker2

# VM 강제 종료
virsh destroy k8s-master

# VM 콘솔 직접 접속
virsh console k8s-master
```

---

## 설치 과정

### 1단계 - VMware VM 생성 및 Ubuntu 설치 ✅
- Ubuntu 22.04.5 LTS Server 설치
- OpenSSH 설치
- 브리지 모드 네트워크 설정 (192.168.0.78)

### 2단계 - 호스트 OS 기본 설정 ✅
- 패키지 업데이트
- swap 영구 비활성화
- 시간대 Asia/Seoul 설정
- 고정 IP 설정 (netplan) → 192.168.0.78
- 호스트명 설정 (k8s-master)
- 커널 모듈 설정 (br_netfilter, overlay)
- sysctl 설정 (ip_forward 등)

### 3단계 - 호스트 Docker + containerd 설치 ✅
- Docker CE 25.0.5 설치
- containerd 1.7.29 설치
- SystemdCgroup = true 설정

### 4단계 - KVM 설치 및 VM 생성 ✅
- KVM + libvirt 설치
- Ubuntu 22.04 Cloud Image 다운로드
- k8s-master, k8s-worker1, k8s-worker2 VM 생성 (각 2코어 / 4GB / 30GB)

### 5단계 - KVM VM 공통 OS 설정 ✅
VM 3개(master, worker1, worker2) 동일하게 적용

```bash
sudo -i

# swap 비활성화
swapoff -a
sed -i 's|/swap.img none swap sw 0 0|#/swap.img none swap sw 0 0|' /etc/fstab

# 시간대 설정
timedatectl set-timezone Asia/Seoul

# 커널 모듈 설정
cat > /etc/modules-load.d/k8s.conf << 'EOF'
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

# sysctl 설정
cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```

### 6단계 - KVM VM Docker + containerd 설치 ✅
VM 3개 동일하게 적용

```bash
apt install -y ca-certificates curl gnupg lsb-release

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt update

apt install -y \
  docker-ce=5:25.0.5-1~ubuntu.22.04~jammy \
  docker-ce-cli=5:25.0.5-1~ubuntu.22.04~jammy \
  containerd.io=1.7.29-1~ubuntu.22.04~jammy \
  docker-buildx-plugin \
  docker-compose-plugin

containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd
systemctl enable docker
systemctl start docker
```

### 7단계 - kubeadm / kubelet / kubectl 설치 ✅
VM 3개 동일하게 적용

```bash
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.32/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.32/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
apt update

apt install -y \
  kubeadm=1.32.13-1.1 \
  kubelet=1.32.13-1.1 \
  kubectl=1.32.13-1.1

apt-mark hold kubeadm kubelet kubectl
```

### 8단계 - K8s 클러스터 구성 ✅

```bash
# master에서만 실행
kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=192.168.122.165

# kubectl 설정
export KUBECONFIG=/etc/kubernetes/admin.conf
echo "export KUBECONFIG=/etc/kubernetes/admin.conf" >> ~/.bashrc

# Flannel CNI 설치
kubectl apply -f https://github.com/flannel-io/flannel/releases/download/v0.26.7/kube-flannel.yml

# worker1, worker2에서 실행
kubeadm join 192.168.122.165:6443 --token b02ydj.c6ps0v3s0t7veprr \
  --discovery-token-ca-cert-hash sha256:41c30cc80d645e05a2eb0c22e8e7a2d2dea4a91fbd4e5aa78d40735fe28d64c6
```

### 9단계 - 클러스터 공통 환경 구성 ✅

```bash
# Namespace 생성
kubectl create namespace accommodation

# Helm 설치
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | DESIRED_VERSION=v3.14.0 bash

# ingress-nginx 설치
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --version 4.9.0
```

### 10단계 - 서비스 배포 (진행 예정)
- PostgreSQL 16 배포
- FastAPI auth-service 배포

---

## 클러스터 상태 확인 명령어

```bash
# 노드 상태
kubectl get nodes

# 전체 Pod 상태
kubectl get pods -A

# 서비스 상태
kubectl get svc -A

# namespace 목록
kubectl get namespace
```
