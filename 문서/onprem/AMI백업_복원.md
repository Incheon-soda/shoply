# 14. AMI 백업 / 복원 — 스팟 호스트 EC2 빠른 복구

> 호스트 EC2(KVM 돌리는 그 머신)를 **AMI로 통째 백업**해두고, 스팟이 회수(terminate)되거나 새로 띄울 때
> 그 AMI로 **몇 분 만에 복구**한다. AMI에는 KVM VM 디스크(qcow2)까지 들어있어 **클러스터가 그대로 부활**한다.
>
> ⚠️ 스팟 인스턴스는 회수되면 terminate → **root EBS가 같이 삭제**된다. AMI(=루트 EBS 스냅샷 포함)를 떠두지 않으면 복구 불가.

---

## 0. 무엇이 보존되나

| 위치 | AMI에 포함? | 비고 |
|---|---|---|
| 호스트 `/home/ubuntu/k8s`, `/scripts` | ✅ | root EBS에 있으면 포함 |
| KVM VM 디스크 `/var/lib/libvirt/images/*.qcow2` | ✅ | 클러스터 상태 통째 (단 root EBS에 있을 때) |
| VM 내부(쿠버 클러스터·앱·ingress) | ✅ | qcow2 안에 있음 → 그대로 부활 |
| 호스트 iptables DNAT / ip_forward | ❌ | 새 EC2라 비어있음 → 6단계 재실행 |
| 호스트 EC2 사설IP | ❌ | **매번 바뀜** → host-network.sh가 자동 감지 |
| DB·Redis·모니터링 EC2 | ❌ | 각자 별도 인스턴스 (새로 떴으면 IP 갱신 필요) |

> qcow2가 **별도 데이터 EBS 볼륨**에 있으면 AMI(root만)에 안 들어간다 → 그 볼륨 스냅샷을 따로 떠야 한다.
> 기본 구성(이 프로젝트)은 `/var/lib/libvirt/images`가 root EBS라 AMI 하나로 끝난다.

---

## 1. AMI 생성 (백업)

> 중요한 변경(클러스터 정상화 등) 후마다 한 번씩 떠두면 된다.

1. (권장) **VM을 잠깐 멈춰** qcow2 일관성 확보:
   ```bash
   # 호스트 EC2
   sudo virsh shutdown k8s-master k8s-worker1 k8s-worker2 k8s-worker3
   sudo virsh list --all          # 다 'shut off' 확인
   sync                           # 메모리 버퍼 → 디스크 flush
   ```
2. (최초 1회 권장) **7-1의 영구화**(모듈 자동로드 + autostart + @reboot)를 먼저 해두면, 이 AMI로 복원 시 부팅만으로 클러스터가 올라온다.
3. AWS 콘솔 → EC2 → 인스턴스 선택 → **작업 → 이미지 및 템플릿 → 이미지 생성**
   - 이미지 이름: 예 `onprem-host-20260616-cluster정상`
   - **"재부팅 안 함(No reboot)" 체크** ← 스팟이라 재부팅 회피
4. EC2 → **AMI** 메뉴에서 상태가 `pending` → `available` 되면 완료.
   (같이 생기는 **스냅샷**이 실제 디스크 백업본)
5. AMI 떴으면 VM 다시 켜도 됨:
   ```bash
   sudo virsh start k8s-master k8s-worker1 k8s-worker2 k8s-worker3
   ```

> VM을 안 멈추고 No reboot로 떠도 대부분 복구되지만, qcow2 쓰기 도중이면 일관성이 깨질 수 있다. 멈추는 게 안전.

---

## 2. AMI로 새 인스턴스 시작 (복원)

EC2 → **AMI** → 해당 AMI 선택 → **AMI로 인스턴스 시작**
- 인스턴스 타입: **c8i.2xlarge** (중첩 가상화 동일)
- 구매 옵션: **스팟**
- 보안 그룹: 기존 호스트 EC2 SG (80/443, 22, 메트릭 포트 등)
- 시작.

> ⚠️ 중첩 가상화(vmx/svm)는 AMI에 설정이 안 따라올 수 있다. 새 인스턴스에서 `grep -c 'vmx\|svm' /proc/cpuinfo`가 0이면
> 인스턴스 타입/CPU 옵션에서 중첩 가상화를 다시 켠다.

---

## 3. EIP 재연결

EC2 → **탄력적 IP** → 기존 EIP 선택 → **작업 → 탄력적 IP 주소 연결** → 새 인스턴스 선택.
→ 공인 IP가 **그대로 유지**된다 (도메인 `/etc/hosts`는 다시 안 건드려도 됨).

---

## 4. KVM VM 살리기 (autostart)

> 복원 직후 `virsh list`가 비어 보이는 건, VM이 **꺼진 상태(autostart 미설정)** 라서다. `--all`로 보면 'shut off'로 있다.

```bash
# 호스트 EC2
sudo virsh list --all                 # VM 4개가 'shut off'로 보이면 정상
ls -lh /var/lib/libvirt/images/        # *.qcow2 4개 있는지

# 네트워크 + VM 시작 + 자동시작 등록
sudo virsh net-start default 2>/dev/null
for vm in k8s-master k8s-worker1 k8s-worker2 k8s-worker3; do
  sudo virsh start $vm
  sudo virsh autostart $vm             # ★ 다음부턴 부팅 시 자동으로 뜨게
done

sudo virsh list --all                  # 4개 다 'running'
sudo virsh net-dhcp-leases default     # IP가 .11/.21/.22/.23 그대로인지
```

> VM 내부 IP(.11~.23)는 MAC 고정이라 **안 바뀐다** → 클러스터 인증서·kubeconfig 안 깨짐.

---

## 4-1. ★ flannel 살리기 — br_netfilter (VM 4대 전부)

> **재부팅하면 `br_netfilter` 모듈이 빠진다** → flannel이 `Failed to check br_netfilter: ... bridge-nf-call-iptables: no such file`로
> CrashLoopBackOff → CNI 실패 → **모든 파드가 ContainerCreating에 멈춤**.
> **반드시 master·worker1·worker2·worker3 4대 "각각"** 에서 해야 한다 (한 대라도 빠지면 그 노드 flannel만 죽고 그 위 파드가 안 뜸).
>
> ✅ **AMI를 아래 6-1처럼 모듈 영구화해서 구웠으면, 부팅 시 자동 로드되어 이 단계는 불필요**하다.
> (이 단계는 영구화 안 된 옛 AMI를 복원했을 때의 수동 처치)

```bash
# 각 VM에 SSH (비번 ubuntu1234) 후 — hostname으로 어느 노드인지 꼭 확인
ssh ubuntu@192.168.122.11   # master  (.21 worker1 / .22 worker2 / .23 worker3)
hostname
sudo modprobe overlay br_netfilter
cat /proc/sys/net/bridge/bridge-nf-call-iptables    # 1 나와야 성공 (no such file 아님)
```

4대 다 `1` 확인되면 master에서 flannel 재생성 + 유령 파드 정리:
```bash
kubectl delete pod -n kube-flannel --all
kubectl get pods -n kube-flannel -o wide -w         # 4개 다 1/1 Running

# 백업 이전 '유령' 파드(Unknown/옛 ReplicaSet) 일괄 정리
kubectl delete pod -A --field-selector status.phase!=Running --force --grace-period=0
```
→ flannel Running → coredns → ingress-nginx → metallb → 앱 순으로 자동 cascade.

> `modprobe` 후 `cat`이 `no such file`이면 그 노드에서 **모듈이 실제로 안 올라온 것** — 다른 노드(master)에서 친 건 소용없다.
> `sudo modprobe -v br_netfilter; echo exit=$?` 로 `insmod ...br_netfilter.ko` + `exit=0` 확인.

---

## 5. 호스트 네트워크 재설정 (DNAT + 메트릭 포워딩)

> 호스트 iptables는 새 EC2라 비어있다. 호스트 사설IP도 바뀌었지만 스크립트가 `hostname -I`로 자동 감지한다.

```bash
# 호스트 EC2 — VM 다 뜬 뒤
cd ~/scripts        # 또는 host-network.sh 있는 곳
./host-network.sh
#   MetalLB EXTERNAL-IP가 .240이 아니면:  VIP=192.168.122.24x ./host-network.sh
```
→ 사이트 진입(80/443→VIP) + 앱메트릭 + node_exporter + cAdvisor DNAT + ip_forward + FORWARD 한 방에.

---

## 6. ★ DB / Redis 사설IP 갱신 (configmap)

> DB·Redis EC2를 **새로 띄웠으면** 사설IP가 바뀐다. 옛 IP면 백엔드 파드가 `0/1`(헬스체크 실패)로 안 뜬다.
> repo 파일 수정 없이 **master VM에서 바로 패치**한다.

```bash
# master VM (kubectl 되는 곳)
ssh ubuntu@192.168.122.11      # 또는 호스트에서 virsh console k8s-master

# 1) 현재 값 확인
kubectl get cm shoply-config -n shoply \
  -o jsonpath='{.data.POSTGRES_HOST}{"  "}{.data.REDIS_HOST}{"\n"}'

# 2) 새 사설IP로 패치 — 패치 파일 사용 (인라인 -p '...'는 터미널에서 따옴표가 깨질 수 있음)
#    ⚠️ /tmp는 sticky bit라 다른 유저가 만든 파일을 못 덮어쓴다 → 홈(~)에 만든다.
cat > ~/cm-patch.json <<'JSON'
{"data":{"POSTGRES_HOST":"<DB-새-사설IP>","REDIS_HOST":"<Redis-새-사설IP>"}}
JSON
kubectl patch configmap shoply-config -n shoply --type merge --patch-file ~/cm-patch.json

# 값 들어갔는지 확인
kubectl get cm shoply-config -n shoply \
  -o jsonpath='{.data.POSTGRES_HOST}{"  "}{.data.REDIS_HOST}{"\n"}'

# 3) 앱이 새 값을 읽게 재시작 (configmap은 재시작해야 env 반영)
kubectl rollout restart deployment -n shoply

# 4) 다 1/1 되는지 (특히 payment — 0/1이면 DB/Redis IP 불일치였던 것)
kubectl get pods -n shoply -w
```

> DB·Redis EC2가 그대로(IP 안 바뀜)면 이 단계는 생략. 바뀌었는지 모르면 각 EC2에서 `hostname -I`로 확인.
>
> 백엔드 파드가 `Running`인데 `0/1`로 남으면 거의 이 IP 불일치다 (헬스체크가 DB/Redis ping에서 막힘).
> IP 패치 + `rollout restart` 후에도 안 풀리면 해당 파드만 `kubectl delete pod`로 강제 재생성.

---

## 6-1. ★ Loki 로그 수집 IP 갱신 (Promtail / event-exporter)

> **모니터링 EC2도 새로 뜨면 사설IP가 바뀐다.** 클러스터의 Promtail·event-exporter는 그 IP로 로그를 push하는데,
> 옛 IP로 박혀 있으면 push가 엉뚱한 데로 가서 **Grafana Loki가 텅 빈다**(`{"status":"success"}`에 data 없음).
> DB/Redis(6단계)와 똑같이 "모니터링 IP도 매번 바뀐다"는 점만 다름.

```bash
# 0) 현재 모니터링 EC2 사설IP 확인 (모니터링 EC2에서 hostname -I)
#    + master VM에서 현재 push 대상 확인
kubectl get cm promtail-config -n kube-system -o yaml | grep "url:"
kubectl get cm event-exporter-config -n kube-system -o yaml | grep "url:"

# 1) ConfigMap이 아예 없으면(NotFound) → 재구축으로 미배포 → 먼저 apply
kubectl apply -f /home/ubuntu/k8s/onprem/promtail-loki.yaml
kubectl apply -f /home/ubuntu/k8s/onprem/event-exporter-loki.yaml

# 2) push URL을 현재 모니터링 IP로 교체 후 재배포
OLD=<옛-모니터링-IP>      # 위 grep에 뜬 값
MON=<현재-모니터링-IP>    # 새 모니터링 EC2 사설IP
sed -i "s|http://$OLD:3100|http://$MON:3100|" \
  /home/ubuntu/k8s/onprem/promtail-loki.yaml \
  /home/ubuntu/k8s/onprem/event-exporter-loki.yaml
kubectl apply -f /home/ubuntu/k8s/onprem/promtail-loki.yaml
kubectl apply -f /home/ubuntu/k8s/onprem/event-exporter-loki.yaml
kubectl rollout restart ds/promtail -n kube-system
kubectl rollout restart deploy/event-exporter -n kube-system
```

확인 (모니터링 EC2):
```bash
curl -s http://localhost:3100/loki/api/v1/label/namespace/values
#   {"status":"success","data":["shoply",...]} 나오면 OK → Grafana Explore {namespace="shoply"}
```

> 안 뜨면 모니터링 EC2 **SG 인바운드 3100**이 호스트 EC2 사설IP로부터 열렸는지 확인 (Promtail이 호스트 NAT 거쳐 push → 소스가 호스트 IP).
> 모니터링 EC2도 **EIP 붙여 사설IP 고정**(또는 terminate 말고 stop)하면 이 갱신이 불필요해진다.

---

## 7. 확인

```bash
# master VM
kubectl get nodes                       # 4개 Ready
kubectl get pods -A -o wide             # shoply 앱 1/1, ingress(worker3), metallb speaker
kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP = 192.168.122.24x

# 외부 (부하 PC)
curl http://<EIP>/api/products                       # catch-all
curl -H "Host: shoply.example.com" http://<EIP>/api/products
```

다 정상이면 복구 완료.

---

## 7-1. ★ 다음 복원을 "무삽질"로 — 영구화 후 AMI 재생성

> 위 4-1(br_netfilter)·4(autostart)를 **매번 손으로 하는 게 이번 고생의 원인**이다.
> 한 번 영구화해서 **AMI를 다시 구우면**, 다음 복원부턴 부팅만으로 클러스터까지 자동으로 올라온다.

**① 각 VM(master·worker1·2·3)에서 — 모듈 부팅 자동로드:**
```bash
printf "overlay\nbr_netfilter\n" | sudo tee /etc/modules-load.d/k8s.conf
```

**② 호스트 EC2에서 — VM 자동시작 + host-network.sh 부팅 자동실행:**
```bash
# VM autostart (한 번만, 영구)
sudo virsh autostart k8s-master k8s-worker1 k8s-worker2 k8s-worker3

# 부팅 30초 뒤 host-network.sh 자동 실행 (DNAT/메트릭, 호스트IP 자동감지)
(crontab -l 2>/dev/null; echo "@reboot sleep 30 && /home/ubuntu/scripts/host-network.sh") | crontab -
```

**③ 이 상태로 1단계처럼 AMI 다시 굽기.**
→ 다음부터는: AMI로 시작 → EIP 재연결 → (자동) VM 부팅·모듈로드·DNAT → **DB/Redis IP만 바뀌었으면 6단계 패치**. 끝.

> host-network.sh의 `@reboot`는 VIP가 .240일 때 기준. MetalLB EXTERNAL-IP가 다르면 그때만 수동으로
> `VIP=192.168.122.24x ./host-network.sh`. (VIP는 보통 .240 고정이라 대부분 자동으로 맞음.)

---

## 8. 트러블슈팅

### 8-0. ★ "파드는 다 Running인데 사이트가 안 들어감" — `curl -v`로 3분류

파드가 다 Ready인데 사이트가 안 열리면, **클러스터가 아니라 진입 경로(호스트/SG/ingress) 문제**다. 먼저 분류부터:

```bash
curl -v http://<EIP>/        # 부하 PC 또는 호스트에서
```

| curl 반응 | 원인 | 조치 |
|---|---|---|
| **즉시 Connection refused** | 호스트 iptables 비어 80/443 DNAT 없음 (복원 직후 가장 흔함) | 호스트 EC2: `cd ~/scripts && ./host-network.sh` + `sudo virsh net-start default` |
| **한참 멈추다 timeout** | SG 인바운드 80/443 미허용, 또는 EIP가 새 인스턴스에 연결 안 됨 | SG 80/443(0.0.0.0/0) 확인 + 콘솔에서 EIP를 **현재 호스트에 연결(associate)** |
| **404 nginx** | ingress까지 도달했으나 host 규칙 매칭 실패 | 도메인 매핑(`/etc/hosts`) 쓰거나, host 없는 catch-all ingress 적용 |

진입 경로 보조 확인:
```bash
# 호스트: DNAT 규칙 있나 (비었으면 refused 원인)
sudo iptables -t nat -L PREROUTING -n -v | grep -E "dpt:80|dpt:443"
# master: MetalLB VIP 붙었나
kubectl get svc -n ingress-nginx ingress-nginx-controller   # EXTERNAL-IP=192.168.122.24x
#   <pending>이면: kubectl apply -f /home/ubuntu/k8s/onprem/metallb-config.yaml
#   .240이 아니면: VIP=192.168.122.24x ./host-network.sh
```

### 8-1. 증상별 표

| 증상 | 원인 / 조치 |
|---|---|
| 모든 파드 `ContainerCreating` + describe에 `flannel ... /run/flannel/subnet.env: no such file` | flannel 파드가 CrashLoop라 subnet.env를 못 만든 것 → 아래 flannel CrashLoop 먼저 해결 |
| flannel 파드 `CrashLoopBackOff` (일부 노드만) | flannel 로그 `Failed to check br_netfilter: ... bridge-nf-call-iptables: no such file` → **그 노드에 br_netfilter 안 올라옴.** 죽은 노드에 SSH해서 `sudo modprobe overlay br_netfilter` + `cat /proc/sys/net/bridge/bridge-nf-call-iptables`(=1 확인) → 4-1 |
| `modprobe` 했는데 `cat`이 계속 `no such file` | **master에서 친 것**일 수 있음 — modprobe는 죽은 그 워커 "안에서" 해야 함. `hostname`으로 위치 확인 |
| `virsh list`에 VM 안 보임 | `virsh list --all`로 보면 'shut off' → 4단계 `virsh start` + `autostart` |
| `virsh list --all`도 비어있는데 qcow2 파일은 있음 | 정의만 날아감 → `virsh define /etc/libvirt/qemu/<vm>.xml` (XML 없으면 virt-install `--import`로 재정의) |
| qcow2 파일조차 없음 | libvirt 이미지가 별도 EBS였고 AMI(root)에 미포함 → 그 볼륨 스냅샷으로 복구 |
| 외부 `curl <EIP>` Connection refused | 호스트 DNAT 누락/IP불일치 → `./host-network.sh` 재실행 (호스트IP 자동) |
| 사이트 404 nginx | ingress host 규칙 매칭 안 됨 → 도메인(`/etc/hosts`) 쓰거나 catch-all ingress 확인 |
| 백엔드 파드 `0/1` | DB/Redis IP 불일치 → 6단계 configmap 패치 + rollout restart |
| Grafana Loki 로그 안 뜸 / `label/namespace/values`가 `{"status":"success"}`(data 없음) | 모니터링 IP 바뀜 → Promtail/event-exporter가 옛 IP로 push → **6-1단계** sed로 push URL 갱신 + rollout restart (ConfigMap NotFound면 먼저 apply) |
| `grep -c vmx /proc/cpuinfo` = 0 | 중첩 가상화 꺼짐 → 인스턴스 CPU 옵션에서 재활성화 |

---

## 요약

```
[백업]  VM shutdown → sync → AMI 생성(No reboot)
[복원]  AMI로 스팟 시작 → EIP 재연결 → virsh start+autostart
        → ./host-network.sh (DNAT/메트릭, 호스트IP 자동)
        → configmap DB/Redis IP 패치 + rollout restart (6단계)
        → Promtail/event-exporter push IP 갱신 (6-1단계, Loki 로그용)
        → kubectl get nodes/pods 확인
```

- 클러스터(VM 내부)는 qcow2에 통째로 들어있어 **그대로 부활** — IP 고정(.11~.23) 덕에 안 깨짐.
- 매번 바뀌는 IP 3종: **호스트 사설IP**(host-network.sh 자동) + **DB/Redis IP**(configmap 패치) + **모니터링 IP**(Promtail push URL).
- 오프사이트(PC) qcow2 백업이 따로 필요하면 → 15_VM백업_복원.