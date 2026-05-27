# K8s LXD 클러스터 구축 가이드 (AWS EC2)

---

## 목차

| 단계 | 작업 | 상태 |
|---|---|---|
| 1 | LXD 설치 | ✅ |
| 2 | K8s용 LXD 프로파일 생성 | ✅ |
| 3 | 컨테이너 3개 생성 | ✅ |
| 4 | 공통 OS 설정 | ✅ |
| 5 | containerd 설치 | ✅ |
| 6 | kubeadm / kubelet / kubectl 설치 (1.32.12) | ✅ |
| 6-1 | 호스트네임 설정 | ✅ |
| 7 | K8s 클러스터 초기화 (kubeadm init + worker join) | ✅ |
| 8 | 노드 상태 확인 | ✅ |
| 9 | Nginx Ingress + NodePort 설정 | ✅ |
| 10 | 호스트 Nginx 설정 (EC2 → 컨테이너 포워딩) | ✅ |

---

## 환경 정보

| 항목 | 값 |
|---|---|
| 호스트 OS | Ubuntu 24.04 LTS (AWS EC2 c8i-flex.2xlarge) |
| 가상화 | LXD (KVM 미지원으로 대체) |
| K8s 버전 | 1.32.12 |
| CNI | Flannel v0.26.7 |

> ⚠️ c8i-flex는 Nitro 하이퍼바이저 기반으로 KVM(vmx/svm) 미지원 → LXD 컨테이너로 대체

---

## K8s 핵심 컴포넌트 설명

| 컴포넌트 | 역할 |
|---|---|
| **kube-apiserver** | 클러스터의 중앙 API 서버. 모든 명령(kubectl 등)이 여기를 통함 |
| **etcd** | 클러스터 상태 저장소. 모든 설정/상태 데이터를 Key-Value로 저장 |
| **kube-scheduler** | 새 Pod를 어떤 노드에 배치할지 결정 |
| **kube-controller-manager** | 노드/Pod/Deployment 상태를 지속적으로 감시하고 원하는 상태 유지 |
| **kubelet** | 각 노드에서 실행되는 에이전트. Pod 실행 및 상태 보고 |
| **kube-proxy** | 각 노드에서 Service ClusterIP → Pod IP 라우팅을 위해 iptables 규칙 관리 |
| **CoreDNS** | 클러스터 내부 DNS 서버. 서비스 이름을 ClusterIP로 변환 (예: `my-svc.default.svc.cluster.local`) |
| **Flannel** | CNI(Container Network Interface). 노드 간 Pod 네트워크 통신을 담당. 각 노드에 서브넷을 할당하고 패킷을 라우팅 |
| **containerd** | 실제로 컨테이너를 실행하는 런타임. kubelet의 명령을 받아 컨테이너 생성/삭제 |
| **Helm** | K8s 패키지 매니저. Chart 단위로 복잡한 애플리케이션을 배포 |
| **ingress-nginx** | 외부 HTTP 트래픽을 클러스터 내부 서비스로 라우팅하는 Ingress Controller |

---

## 접속 구조

```
맥 → 배스천(43.203.217.129) → Spot EC2(10.0.5.175) → LXD 컨테이너
```

```bash
# -J 옵션: ProxyJump. 배스천을 경유해서 Spot EC2에 한 번에 접속
ssh -i /Users/kimminseo/key/aws-3tier-keypair.pem \
  -J ec2-user@43.203.217.129 \
  ubuntu@10.0.5.175
```

---

## 노드 구성

| 노드 | 역할 |
|---|---|
| k8s-master | control-plane |
| k8s-worker1 | worker |
| k8s-worker2 | worker |

> ⚠️ LXD 컨테이너 IP는 DHCP라 재시작 시 바뀔 수 있음 → `lxc list` 로 확인

---

## 명령어 패턴 설명

이 가이드에서 반복적으로 사용되는 패턴입니다.

```bash
# for 루프: k8s-master, k8s-worker1, k8s-worker2를 순서대로 $node에 대입해서 3번 반복
for node in k8s-master k8s-worker1 k8s-worker2; do
  echo "=== $node ==="         # 지금 어떤 노드 작업 중인지 출력
  lxc exec $node -- bash -c " # $node 컨테이너 안에서 bash 명령 실행
    <명령어들>
  "
done
```

- `lxc exec <컨테이너명> -- <명령어>` : 해당 LXD 컨테이너 안에서 명령어를 실행
- `bash -c "..."` : 여러 줄의 명령을 한 번에 전달할 때 사용
- `for ... do ... done` : 반복문. 3개 노드에 같은 작업을 자동으로 적용

---

## 진행 순서

### 1단계 - LXD 설치 ✅

```bash
sudo snap install lxd           # snap 패키지 관리자로 LXD 설치
sudo usermod -aG lxd $USER      # 현재 유저를 lxd 그룹에 추가 (sudo 없이 lxc 명령 사용)
newgrp lxd                      # 그룹 변경 즉시 적용 (재로그인 대신)
lxd init --auto                 # LXD 초기화 (스토리지, 네트워크 자동 설정)
```

### 2단계 - K8s용 LXD 프로파일 생성 ✅

> LXD 컨테이너 기본 설정은 K8s 실행에 필요한 권한이 없어서 별도 프로파일을 만들어 적용합니다.

```bash
lxc profile create k8s    # k8s라는 이름의 프로파일 생성

# cat <<EOF | lxc profile edit k8s
# EOF 사이의 내용을 lxc profile edit 명령의 입력으로 넘기는 방식 (heredoc)
cat <<EOF | lxc profile edit k8s
config:
  # K8s에 필요한 커널 모듈 목록 (컨테이너 시작 시 자동 로드)
  linux.kernel_modules: ip_tables,ip6_tables,nf_nat,overlay,br_netfilter
  raw.lxc: |
    lxc.apparmor.profile=unconfined   # AppArmor 보안 정책 비활성화 (K8s 실행에 필요)
    lxc.cap.drop=                     # Linux capability 제한 해제
    lxc.cgroup.devices.allow=a        # 모든 디바이스 접근 허용
    lxc.mount.auto=proc:rw sys:rw     # /proc, /sys를 읽기/쓰기로 마운트
  security.privileged: "true"         # 특권 컨테이너 (호스트 커널 직접 접근)
  security.nesting: "true"            # 컨테이너 안에서 컨테이너 실행 허용 (K8s가 컨테이너를 띄움)
description: K8s LXD profile
devices:
  kmsg:
    path: /dev/kmsg       # 컨테이너 내부 경로
    source: /dev/kmsg     # 호스트의 /dev/kmsg를 컨테이너에 연결 (kubelet 로그에 필요)
    type: unix-char
EOF
```

### 3단계 - 컨테이너 3개 생성 ✅

```bash
# ubuntu:24.04 이미지로 컨테이너 생성
# --profile default: 기본 네트워크/스토리지 설정 적용
# --profile k8s: 위에서 만든 K8s 전용 설정 추가 적용
lxc launch ubuntu:24.04 k8s-master  --profile default --profile k8s
lxc launch ubuntu:24.04 k8s-worker1 --profile default --profile k8s
lxc launch ubuntu:24.04 k8s-worker2 --profile default --profile k8s

lxc list    # 생성된 컨테이너 목록 및 상태/IP 확인
```

### 4단계 - 공통 OS 설정 ✅

```bash
# 3개 노드에 동시에 동일한 설정 적용
for node in k8s-master k8s-worker1 k8s-worker2; do
  echo "=== $node ==="
  lxc exec $node -- bash -c "
    swapoff -a                              # swap 비활성화 (K8s 필수 요건)
    timedatectl set-timezone Asia/Seoul     # 시간대 설정

    # 부팅 시 자동으로 로드할 커널 모듈 등록
    # overlay: 컨테이너 이미지 레이어 처리에 사용
    # br_netfilter: 브리지 네트워크에서 iptables 규칙 적용에 필요
    cat > /etc/modules-load.d/k8s.conf << 'EOF'
overlay
br_netfilter
EOF
    modprobe overlay        # 지금 즉시 커널 모듈 로드
    modprobe br_netfilter

    # 네트워크 관련 커널 파라미터 설정
    # iptables가 브리지 트래픽을 처리하고, IP 포워딩을 활성화
    cat > /etc/sysctl.d/k8s.conf << 'EOF'
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
    sysctl --system    # 위 설정 즉시 적용
  "
done
```

### 5단계 - containerd 설치 ✅

> containerd: K8s가 컨테이너를 실제로 실행할 때 사용하는 컨테이너 런타임

```bash
for node in k8s-master k8s-worker1 k8s-worker2; do
  echo "=== $node ==="
  lxc exec $node -- bash -c "
    # Docker 저장소 추가에 필요한 패키지 설치
    apt install -y ca-certificates curl gnupg lsb-release

    # Docker GPG 키 등록 (패키지 신뢰 검증용)
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    # Docker 공식 apt 저장소 추가
    echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \$(. /etc/os-release && echo \$VERSION_CODENAME) stable\" > /etc/apt/sources.list.d/docker.list
    apt update

    # containerd 설치 (Docker CE 전체가 아닌 런타임만)
    apt install -y containerd.io

    # 기본 설정 파일 생성 후 SystemdCgroup 활성화
    # SystemdCgroup=true: cgroup 관리를 systemd에 위임 (K8s 권장 설정)
    containerd config default > /etc/containerd/config.toml
    sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

    systemctl restart containerd
    systemctl enable containerd    # 부팅 시 자동 시작
  "
done
```

### 6단계 - kubeadm / kubelet / kubectl 설치 ✅

> - kubeadm: 클러스터 초기화 및 노드 join 도구
> - kubelet: 각 노드에서 실행되는 K8s 에이전트 (Pod 실행 담당)
> - kubectl: 클러스터 조작 CLI 도구

```bash
for node in k8s-master k8s-worker1 k8s-worker2; do
  echo "=== $node ==="
  lxc exec $node -- bash -c "
    # K8s 공식 apt 저장소 GPG 키 등록
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.32/deb/Release.key | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

    # K8s 1.32 저장소 추가
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.32/deb/ /' > /etc/apt/sources.list.d/kubernetes.list
    apt update

    # 버전 고정해서 설치 (EKS 버전과 맞추기 위해 1.32.12 사용)
    apt install -y kubeadm=1.32.12-1.1 kubelet=1.32.12-1.1 kubectl=1.32.12-1.1

    # apt-mark hold: 이 패키지들을 apt upgrade에서 제외 (버전 고정)
    apt-mark hold kubeadm kubelet kubectl
  "
done
```

> ⚠️ 버전 변경(다운그레이드)이 필요할 경우 `--allow-downgrades` 필수
> ```bash
> for node in k8s-master k8s-worker1 k8s-worker2; do
>   lxc exec $node -- bash -c "
>     kubeadm reset -f
>     apt-mark unhold kubeadm kubelet kubectl
>     apt install -y --allow-downgrades \
>       kubeadm=<버전> kubelet=<버전> kubectl=<버전>
>     apt-mark hold kubeadm kubelet kubectl
>   "
> done
> ```

### 6-1단계 - 호스트네임 설정 ✅

> 컨테이너 안에서 어떤 노드인지 구분하기 위해 명시적으로 설정
> 설정 후 `root@k8s-worker1:~#` 형태로 프롬프트에 표시됨

```bash
for node in k8s-master k8s-worker1 k8s-worker2; do
  lxc exec $node -- hostnamectl set-hostname $node
done
```

### 7단계 - K8s 클러스터 초기화 ✅

```bash
# master 컨테이너 IP 확인 (재시작 시 바뀔 수 있으니 매번 확인)
lxc list k8s-master

# master IP를 변수에 저장
MASTER_IP=$(lxc list k8s-master -c 4 --format csv | cut -d' ' -f1)

# master에서 클러스터 초기화
# --ignore-preflight-errors=SystemVerification: LXD 컨테이너에서 configs 모듈 없음 무시
lxc exec k8s-master -- bash -c "
  kubeadm init \
    --pod-network-cidr=10.244.0.0/16 \
    --apiserver-advertise-address=$MASTER_IP \
    --ignore-preflight-errors=SystemVerification

  mkdir -p \$HOME/.kube
  cp /etc/kubernetes/admin.conf \$HOME/.kube/config

  # Flannel CNI 설치 (노드 간 Pod 네트워크 통신 담당)
  kubectl apply -f https://github.com/flannel-io/flannel/releases/download/v0.26.7/kube-flannel.yml
"
```

```bash
# kubeadm init 완료 후 출력된 join 명령어를 worker에서 실행
# --ignore-preflight-errors=SystemVerification 추가 필요
lxc exec k8s-worker1 -- kubeadm join <k8s-master-IP>:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --ignore-preflight-errors=SystemVerification

lxc exec k8s-worker2 -- kubeadm join <k8s-master-IP>:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash> \
  --ignore-preflight-errors=SystemVerification
```

> join 명령어를 분실했을 경우 재발급
> ```bash
> lxc exec k8s-master -- kubeadm token create --print-join-command
> ```

### 8단계 - 노드 상태 확인

```bash
# 3개 노드가 모두 Ready 상태인지 확인
lxc exec k8s-master -- kubectl get nodes
```

### 9단계 - Nginx Ingress + NodePort 설정

```bash
lxc exec k8s-master -- bash -c "
  # Helm: K8s 패키지 매니저 (apt와 유사한 역할)
  curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | DESIRED_VERSION=v3.14.0 bash

  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
  helm repo update

  # ingress-nginx 설치
  # NodePort로 설치해서 EC2 포트를 통해 외부에서 접근 가능하게 설정
  helm install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    --version 4.9.0 \
    --set controller.service.type=NodePort \
    --set controller.service.nodePorts.http=30080    # 30080 포트로 외부 노출
"
```

### 10단계 - 호스트 Nginx 설정 (EC2 → 컨테이너 포워딩)

> EC2 공인IP로 들어오는 트래픽을 k8s-master 컨테이너의 30080 포트로 포워딩

```bash
# EC2(호스트)에 Nginx 설치
sudo apt install -y nginx

# /etc/nginx/sites-available/default 에서 아래 내용으로 수정
# proxy_pass http://<k8s-master-IP>:30080;
```

---

## 상태 확인 명령어

```bash
lxc list                                        # 컨테이너 목록 및 IP 확인
lxc exec k8s-master -- bash                     # master 컨테이너 쉘 접속
lxc exec k8s-master -- kubectl get nodes        # 노드 상태
lxc exec k8s-master -- kubectl get pods -A      # 전체 Pod 상태
lxc exec k8s-master -- kubectl get svc -A       # 서비스 상태
```
