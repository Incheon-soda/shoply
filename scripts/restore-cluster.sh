#!/bin/bash
# ============================================================
# 클러스터 복원 — 새 EC2에서 KVM 설치 + VM 복원을 한 방에
#   (qcow2 백업 tar 하나만 있으면 됨 — doc 15에서 만든 것)
#   AMI(월 비용) 대신, PC에 보관한 무료 백업으로 복원.
#
# 사용법 (새 EC2에서):
#   1. 백업 tar 업로드:  scp shoply-cluster.tar.gz ubuntu@<새EC2>:~/
#   2. 이 스크립트 업로드 후:  ./restore-cluster.sh shoply-cluster.tar.gz
#
# 전제: 새 EC2가 중첩 가상화 켜진 인스턴스(doc 13 0단계)일 것.
# ============================================================
set -e
TAR="${1:?사용법: ./restore-cluster.sh <백업.tar.gz>}"
VMS="k8s-master k8s-worker1 k8s-worker2 k8s-worker3"

echo "▶ 1/5 디스크 확장 (있으면)"
DISK=$(lsblk -dno NAME | grep -E '^nvme0n1|^xvda|^vda' | head -1)
sudo growpart /dev/$DISK 1 2>/dev/null || echo "  (확장 불필요/이미 됨)"
sudo resize2fs /dev/${DISK}1 2>/dev/null || true

echo "▶ 2/5 KVM 설치"
sudo apt-get update -qq
sudo apt-get install -y -qq \
  qemu-kvm libvirt-daemon-system libvirt-clients bridge-utils virtinst cloud-image-utils
sudo systemctl enable --now libvirtd
# DNS (KVM 환경 불통 방지)
echo -e "nameserver 8.8.8.8\nnameserver 8.8.4.4" | sudo tee /etc/resolv.conf >/dev/null

echo "▶ 3/5 백업 풀기 + qcow2 배치"
mkdir -p ~/vm-backup && tar xzf "$TAR" -C ~/vm-backup
sudo cp ~/vm-backup/*.qcow2 /var/lib/libvirt/images/

echo "▶ 4/5 default 네트워크 + VM 정의/시작"
sudo virsh net-start default 2>/dev/null || true
sudo virsh net-autostart default 2>/dev/null || true
for vm in $VMS; do
  sudo virsh define ~/vm-backup/$vm.xml
  # cloud-init iso(cdrom) 참조 제거 — 복원 시 그 iso가 없어 start 실패하는 것 방지
  sudo virt-xml $vm --remove-device --disk device=cdrom 2>/dev/null || true
  sudo virsh autostart $vm
  sudo virsh start $vm
done

echo "▶ 5/5 상태 확인"
sleep 8
sudo virsh list --all
sudo virsh net-dhcp-leases default

cat <<'DONE'

✅ VM 복원 완료.
다음 할 것:
  1. ★ 호스트 네트워크 재설정 (이 호스트에서):
       ./host-network.sh          # ip_forward + DNAT + FORWARD 한 방 (VM IP 자동감지)
  2. master VM 접속 → kubectl get nodes (4개 Ready 확인)
       - apiserver가 6443 refused면 loopback 방화벽 flush (11_트러블슈팅 §13)
       - NodePort 안 되면 kube-proxy 재시작 (§19)
  3. 모니터링 EC2: prometheus.yml 호스트IP 갱신 + curl -X POST .../-/reload
  4. VM 내부 IP는 고정돼 있어 클러스터 자체는 그대로 동작.
DONE
