# 온프레미스 K8s 구축 가이드 (AWS EC2 + KVM)

---

## 목차

| 단계 | 작업 | 상태 |
|---|---|---|
| 0 | 중첩 가상화(Nested Virtualization) 활성화 | ✅ |
| 1 | EC2 디스크 확장 (8GB → 150GB) | |
| 2 | KVM 설치 | |
| 3 | VM 3개 생성 (master, worker1, worker2) | |
| 4 | 공통 OS 설정 | |
| 5 | containerd 설치 | |
| 6 | kubeadm / kubelet / kubectl 설치 | |
| 6-1 | kube-proxy 패치 (LXD 불필요 — KVM은 skip) | |
| 7 | K8s 클러스터 초기화 | |
| 8 | Flannel CNI 설치 | |
| 9 | Nginx Ingress + NodePort 설정 | |
| 10 | 호스트 Nginx 설정 (EC2 → VM 포워딩) | |
| 11 | 서비스 배포 | |

---

## 환경 정보

| 항목 | 값 |
|---|---|
| 호스트 EC2 | c8i.2xlarge (Ubuntu 24.04) |
| 가상화 | KVM (중첩 가상화 활성화 필요) |
| VM OS | Ubuntu 24.04 |
| K8s 버전 | EKS 버전 확인 후 동일하게 |
| CNI | Flannel v0.26.7 |

---

## 0단계 - 중첩 가상화(Nested Virtualization) 활성화

> EC2 콘솔에서 인스턴스 **중지(stop)** 후 진행

**AWS 콘솔:**
1. EC2 → 인스턴스 선택 → 작업 → 인스턴스 설정 → CPU 옵션 변경
2. AMD SMT 또는 Intel VT-x 중첩 가상화 활성화

**또는 AWS CLI:**
```bash
aws ec2 modify-instance-attribute \
  --instance-id <인스턴스ID> \
  --no-disable-api-termination

# 중첩 가상화는 launch template 또는 콘솔에서 설정
```

**인스턴스 재시작 후 확인:**
```bash
grep -c 'vmx\|svm' /proc/cpuinfo
# 0이 아니면 활성화 성공
```

---

## 1단계 - EC2 디스크 확장 (8GB → 150GB)

> AWS 콘솔에서 EBS 볼륨 크기를 150GB로 변경 후 아래 실행

```bash
lsblk

# 파티션 확장
sudo growpart /dev/nvme0n1 1

# 파일시스템 확장
sudo resize2fs /dev/nvme0n1p1

# 확인
df -h /
```

---

## 2단계 - KVM 설치

```bash
sudo apt update
sudo apt install -y \
  qemu-kvm \
  libvirt-daemon-system \
  libvirt-clients \
  bridge-utils \
  virtinst \
  virt-manager \
  cloud-image-utils

# 현재 유저를 libvirt/kvm 그룹에 추가
sudo usermod -aG libvirt,kvm $USER
newgrp libvirt

# KVM 동작 확인
virsh list --all
```

---

## 3단계 - VM 3개 생성 (master, worker1, worker2)

> Ubuntu 24.04 cloud image 사용

```bash
# cloud image 다운로드
wget https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

# 각 VM용 디스크 이미지 생성 (30GB)
for vm in k8s-master k8s-worker1 k8s-worker2; do
  sudo qemu-img create -f qcow2 -F qcow2 \
    -b noble-server-cloudimg-amd64.img \
    /var/lib/libvirt/images/${vm}.qcow2 30G
done
```

```bash
# cloud-init user-data 생성
cat << 'EOF' > /tmp/user-data
#cloud-config
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: "$6$$(python3 -c "import crypt; print(crypt.crypt('ubuntu1234', crypt.mksalt(crypt.METHOD_SHA512)))")"
ssh_pwauth: true
package_update: false
EOF
```

```bash
# VM 생성 (각각 2vCPU / 4GB RAM)
for vm in k8s-master k8s-worker1 k8s-worker2; do
  # cloud-init meta-data
  echo "instance-id: ${vm}" > /tmp/meta-data-${vm}
  echo "local-hostname: ${vm}" >> /tmp/meta-data-${vm}

  # cloud-init iso 생성
  cloud-localds /var/lib/libvirt/images/${vm}-cloud-init.iso \
    /tmp/user-data /tmp/meta-data-${vm}

  # VM 생성
  sudo virt-install \
    --name ${vm} \
    --ram 4096 \
    --vcpus 2 \
    --disk /var/lib/libvirt/images/${vm}.qcow2,format=qcow2 \
    --disk /var/lib/libvirt/images/${vm}-cloud-init.iso,device=cdrom \
    --os-variant ubuntu24.04 \
    --network network=default \
    --graphics none \
    --noautoconsole \
    --import
done
```

```bash
# VM 상태 확인
virsh list --all

# VM IP 확인
virsh net-dhcp-leases default
```

> ⚠️ VM IP는 DHCP라 재부팅 시 바뀔 수 있음 → `virsh net-dhcp-leases default` 로 확인

---

## VM 접속 방법

```bash
# IP 확인
virsh net-dhcp-leases default

# SSH 접속
ssh ubuntu@<VM-IP>

# 또는 virsh console
virsh console k8s-master
```

---

## 4단계 - 공통 OS 설정 (VM 3개 각각)

```bash
# 각 VM에서 실행
sudo -i

# swap 비활성화
swapoff -a
sed -i '/swap/d' /etc/fstab

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

---

## 5단계 - containerd 설치 (VM 3개)

```bash
apt install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list

apt update
apt install -y containerd.io

containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

systemctl restart containerd
systemctl enable containerd
```

---

## 6단계 - kubeadm / kubelet / kubectl 설치 (VM 3개)

> EKS 버전 확인 후 동일 버전 설치

```bash
# 버전 확인
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key | \
  gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] \
  https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /' \
  > /etc/apt/sources.list.d/kubernetes.list

apt update
apt-cache madison kubeadm | head -5   # 버전 확인

# 설치 (버전은 EKS에 맞게)
apt install -y kubeadm=<버전> kubelet=<버전> kubectl=<버전>
apt-mark hold kubeadm kubelet kubectl
```

---

## 7단계 - K8s 클러스터 초기화

```bash
# master VM에서 실행
MASTER_IP=$(hostname -I | awk '{print $1}')

kubeadm init \
  --pod-network-cidr=10.244.0.0/16 \
  --apiserver-advertise-address=$MASTER_IP

mkdir -p $HOME/.kube
cp /etc/kubernetes/admin.conf $HOME/.kube/config
```

```bash
# worker VM들에서 실행 (init 출력에서 복사)
kubeadm join <MASTER_IP>:6443 --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

> join 명령어 분실 시: `kubeadm token create --print-join-command`

---

## 8단계 - Flannel CNI 설치

```bash
# master에서
kubectl apply -f https://github.com/flannel-io/flannel/releases/download/v0.26.7/kube-flannel.yml

# 확인
kubectl get nodes
kubectl get pods -A
```

---

## 9단계 - Nginx Ingress + NodePort 설정

```bash
# Helm 설치
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | \
  DESIRED_VERSION=v3.14.0 bash

helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --version 4.9.0 \
  --set controller.service.type=NodePort \
  --set controller.service.nodePorts.http=30080
```

---

## 10단계 - 호스트 Nginx 설정 (EC2 → VM 포워딩)

```bash
# EC2 호스트에서
sudo apt install -y nginx

# master VM IP 확인
virsh net-dhcp-leases default

sudo tee /etc/nginx/sites-available/default << 'EOF'
server {
    listen 80;
    location / {
        proxy_pass http://<master-VM-IP>:30080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

sudo nginx -t && sudo systemctl restart nginx
```

---

## VM 관리 명령어

```bash
virsh list --all                    # VM 목록
virsh start k8s-master             # VM 시작
virsh shutdown k8s-master          # VM 정상 종료
virsh destroy k8s-master           # VM 강제 종료
virsh net-dhcp-leases default      # VM IP 확인
ssh ubuntu@<VM-IP>                 # VM SSH 접속
```

---

## 상태 확인 명령어 (master VM에서)

```bash
kubectl get nodes
kubectl get pods -A
kubectl get pods -n shoply
kubectl get hpa -n shoply
```