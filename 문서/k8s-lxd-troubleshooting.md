# K8s LXD 클러스터 구축 트러블슈팅

---

## 1. KVM 미지원 (c8i-flex.2xlarge)

### 증상
```bash
grep -c 'vmx\|svm' /proc/cpuinfo
# 결과: 0
```

### 원인
- c8i-flex는 AWS Nitro 하이퍼바이저 기반
- Nitro는 CPU 가상화 플래그(vmx/svm)를 게스트에 노출하지 않음
- KVM 사용 불가

### 해결
- KVM 대신 **LXD 컨테이너**로 대체
- LXD는 커널 네임스페이스 기반이라 CPU 가상화 플래그 불필요
- K8s 노드를 VM 대신 LXD 컨테이너로 시뮬레이션

---

## 2. snap store 연결 불가

### 증상
```
unable to contact snap store
```

### 원인
- EC2 인스턴스에 퍼블릭 IP 미할당
- 퍼블릭 서브넷이어도 퍼블릭 IP 없으면 인터넷 접근 불가

### 해결
- AWS 콘솔에서 Elastic IP 할당 또는 퍼블릭 IP 자동 할당 활성화
- 인터넷 연결 확인: `curl -s https://google.com -o /dev/null && echo OK`

---

## 3. incus 설치 불가

### 증상
```
package 'incus' has no installation candidate
```

### 원인
- Ubuntu 24.04 기본 apt 저장소에 incus 패키지 없음

### 해결
- snapd 설치 후 snap으로 LXD 설치
```bash
sudo apt install -y snapd
sudo snap install lxd
```

---

## 4. apt 캐시 공간 부족

### 증상
```
E: You don't have enough free space in /var/cache/apt/archives/.
```

### 원인
- LXD 컨테이너 루트 파티션(7GB)이 꽉 참
- apt 다운로드 캐시 디렉토리에 여유 공간 없음

### 해결
**1단계: apt 캐시 정리**
```bash
for node in k8s-master k8s-worker1 k8s-worker2; do
  lxc exec $node -- apt clean
done
```

**2단계: EC2 루트 파티션 확장**

EC2 root EBS가 150GB였으나 파티션이 7GB만 잡혀있던 상황

```bash
# 파티션 확장
sudo growpart /dev/nvme0n1 1

# 파일시스템 확장
sudo resize2fs /dev/nvme0n1p1

# 확인
df -h /
```

---

## 7. kube-proxy CrashLoopBackOff (conntrack permission denied)

### 증상
```
E0527 04:53:29.016860 server.go:127] "Error running ProxyServer" 
  err="open /proc/sys/net/netfilter/nf_conntrack_max: permission denied"
```
- kube-proxy 3개 노드 모두 CrashLoopBackOff
- Flannel이 API 서버(10.96.0.1:443)에 접근 불가 → CrashLoopBackOff
- CoreDNS ContainerCreating 상태에서 멈춤

### 원인
- kube-proxy가 `/proc/sys/net/netfilter/nf_conntrack_max` 값을 변경하려 함
- LXD 컨테이너에서는 netfilter 관련 sysctl이 공유 커널 네임스페이스라 컨테이너에서 쓰기 권한 없음
- kube-proxy 실패 → iptables 규칙 미설정 → ClusterIP 라우팅 불가 → Flannel이 API 서버 접근 불가

### 해결
kube-proxy ConfigMap에서 conntrack max 설정을 0으로 패치 (수정 시도 안 함)

```bash
# ConfigMap 패치
lxc exec k8s-master -- bash -c "
  kubectl -n kube-system get cm kube-proxy -o json | \
  sed 's/maxPerCore: null/maxPerCore: 0/' | \
  kubectl apply -f -
"

# kube-proxy 재시작
lxc exec k8s-master -- kubectl -n kube-system rollout restart daemonset kube-proxy

# Flannel도 재시작
lxc exec k8s-master -- kubectl -n kube-flannel rollout restart daemonset kube-flannel-ds
```

---

## 6. kubeadm 버전 다운그레이드 안 됨

### 증상
```bash
dpkg -l kubeadm
# hi  kubeadm  1.32.13-1.1  # 여전히 이전 버전
```
`kubectl get nodes` 에서도 v1.32.13으로 표시

### 원인
- apt 다운그레이드는 `-y` + `--allow-change-held-packages` 만으로는 동작하지 않음
- 낮은 버전으로 내릴 때는 `--allow-downgrades` 플래그가 별도로 필요

### 해결
```bash
for node in k8s-master k8s-worker1 k8s-worker2; do
  lxc exec $node -- bash -c "
    kubeadm reset -f
    apt-mark unhold kubeadm kubelet kubectl
    apt install -y --allow-downgrades \
      kubeadm=1.32.12-1.1 kubelet=1.32.12-1.1 kubectl=1.32.12-1.1
    apt-mark hold kubeadm kubelet kubectl
  "
done
```

---

## 5. hold 패키지 재설치 오류

### 증상
```
E: Held packages were changed and -y was used without --allow-change-held-packages.
kubeadm was already set on hold.
```

### 원인
- 이전 실패 시도에서 `apt-mark hold`가 먼저 실행됨
- 이미 hold 상태인 패키지를 `-y` 옵션만으로 재설치 시도하면 거부됨

### 해결
```bash
apt install -y --allow-change-held-packages \
  kubeadm=1.32.13-1.1 kubelet=1.32.13-1.1 kubectl=1.32.13-1.1
```
