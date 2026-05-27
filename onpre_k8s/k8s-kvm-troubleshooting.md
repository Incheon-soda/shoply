# K8s KVM 클러스터 구축 트러블슈팅

## 1. 브리지 모드 네트워크 안 잡힘

### 증상
```
ens33 IP 없음
ping 안됨
```

### 원인
- VMware Virtual Network Editor에서 VMnet0이 Wi-Fi 어댑터로 연결 안 됨
- Auto로 설정 시 유선/무선 혼동

### 해결
1. VMware → Edit → Virtual Network Editor → Change Settings
2. VMnet0 → Bridged to: **Realtek RTL8852BE WiFi 6 802.11ax PCIe Adapter** 선택
3. VM Settings → Network Adapter → Bridged 선택
4. Ubuntu VM에서 DHCP로 IP 받기

```bash
dhclient ens33
ip addr show ens33
```

---

## 2. netplan 파일 없음 / 권한 오류

### 증상
```
/etc/netplan/50-cloud-init.yaml 파일 없음
sudo tee, sudo cat > 권한 오류
```

### 원인
- cloud-init이 netplan 파일을 생성했다가 삭제
- 일반 유저로 리다이렉션 시 sudo 권한 미적용

### 해결
root로 전환 후 파일 생성

```bash
sudo -i

cat > /etc/netplan/99-static.yaml << 'EOF'
network:
  version: 2
  ethernets:
    ens33:
      dhcp4: no
      addresses:
        - 192.168.0.78/24
      routes:
        - to: default
          via: 192.168.0.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
EOF

chmod 600 /etc/netplan/99-static.yaml
netplan apply
```

---

## 3. cannot call open vswitch: ovsdb-server.service is not running

### 증상
```
netplan apply 실행 시 경고 메시지 출력
```

### 원인
- OVS(Open vSwitch) 서비스 미설치

### 해결
- **무시해도 됨** - Flannel CNI 사용 시 영향 없음

---

## 4. DNS 오류 (temporary failure resolving)

### 증상
```
apt update 시 temporary failure resolving 'archive.ubuntu.com'
```

### 원인
- /etc/resolv.conf에 DNS 설정 없음

### 해결
```bash
echo "nameserver 8.8.8.8" > /etc/resolv.conf
apt update
```

---

## 5. swap 재부팅 후 다시 활성화

### 증상
```
reboot 후 free -h 에서 Swap 4G 다시 활성화
```

### 원인
- sed 명령어로 /swap.img 패턴 주석 처리 실패

### 해결
직접 패턴 지정해서 주석 처리

```bash
swapoff -a
sed -i 's|/swap.img none swap sw 0 0|#/swap.img none swap sw 0 0|' /etc/fstab

# 확인
cat /etc/fstab | grep swap
free -h
```

---

## 6. KVM VM SSH 접속 불가 (publickey)

### 증상
```
ubuntu@192.168.122.x: Permission denied (publickey)
```

### 원인
- cloud-init user-data에서 chpasswd 방식이 일부 cloud image에서 동작 안 함
- 패스워드 인증이 비활성화된 상태로 VM 생성됨

### 해결
SHA512 해시값으로 passwd 직접 지정해서 VM 재생성

1. 기존 VM 삭제
```bash
virsh destroy k8s-worker1
virsh undefine k8s-worker1
rm /var/lib/libvirt/images/k8s-worker1.qcow2
rm /var/lib/libvirt/images/k8s-worker1-cloud-init.iso
```

2. 패스워드 해시값 생성
```bash
python3 -c "import crypt; print(crypt.crypt('ubuntu1234', crypt.mksalt(crypt.METHOD_SHA512)))"
```

3. cloud-init user-data에 해시값 직접 입력
```yaml
#cloud-config
hostname: k8s-worker1
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: "$6$생성된해시값..."
ssh_pwauth: true
package_update: false
```

4. cloud-init iso 재생성 후 VM 재생성
```bash
cloud-localds /var/lib/libvirt/images/k8s-worker1-cloud-init.iso \
  /tmp/worker1-user-data \
  /tmp/worker1-meta-data
```

---

## 7. KVM VM IP 재부팅 후 변경

### 증상
- 재부팅 후 VM IP가 바뀜

### 원인
- KVM 내부 DHCP 사용 중 (192.168.122.x 대역)

### 현재 IP 재확인 방법
```bash
virsh net-dhcp-leases default
```

---

## 8. Windows에서 KVM VM 직접 SSH 불가

### 증상
```
KVM VM IP(192.168.122.x)로 Windows에서 직접 SSH 안됨
```

### 원인
- KVM VM은 192.168.122.x 내부 NAT 대역이라 외부에서 직접 접근 불가

### 해결
ProxyJump로 호스트를 거쳐서 접속

```cmd
ssh -J user@192.168.0.78 ubuntu@192.168.122.165   # master
ssh -J user@192.168.0.78 ubuntu@192.168.122.244   # worker1
ssh -J user@192.168.0.78 ubuntu@192.168.122.21    # worker2
```

---

## 9. Ubuntu 설치 후 무한 로딩 (로그인 프롬프트 안 나옴)

### 증상
```
cloud-init finished 메시지 이후 커서만 깜빡임
```

### 원인
- cloud-init 완료 후 로그인 프롬프트가 가려진 상태

### 해결
- 엔터 2~3번 누르기
- 그래도 안 되면 VMware → VM → Power → Restart Guest

---

## 현재 VM 접속 정보

| VM | IP | 아이디 | 패스워드 |
|---|---|---|---|
| k8s-master | 192.168.122.165 | ubuntu | ubuntu1234 |
| k8s-worker1 | 192.168.122.244 | ubuntu | ubuntu1234 |
| k8s-worker2 | 192.168.122.21 | ubuntu | ubuntu1234 |

> ⚠️ IP는 DHCP라 재부팅 시 바뀔 수 있음
> 바뀌면 `virsh net-dhcp-leases default` 로 확인

---

## 호스트 접속 정보

| 항목 | 값 |
|---|---|
| 호스트 IP | 192.168.0.78 |
| SSH | ssh user@192.168.0.78 |
