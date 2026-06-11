# 14. 도메인 + MetalLB (온프레 LoadBalancer)

> 목표: `도메인 → Elastic IP → 호스트 DNAT → MetalLB VIP → ingress → 파드`
> 온프레를 **진짜 베어메탈처럼**(MetalLB) 만들고, **도메인**으로 접근.
> EKS의 ELB ↔ 온프레 MetalLB 로 개념 대칭 (발표 논리).

---

## 전체 경로

```
사용자 → shoply.example.com
      → DNS(A레코드) → EC2 Elastic IP (공인, 고정)
      → EC2 호스트 :80/:443
      → iptables DNAT
      → MetalLB VIP (192.168.122.240~250, 내부)
      → ingress-nginx (Host 라우팅)
      → 파드
```

> 핵심: **도메인은 EC2 공인 IP로 향하고**, MetalLB는 내부 VIP를 담당한다. 둘은 별개 레이어.

---

## 1단계 - Elastic IP (고정 공인 IP)

> 지금 IP가 재부팅·재구축마다 바뀌는 문제도 같이 해결됨.

AWS 콘솔 → EC2 → 탄력적 IP → **새 주소 할당** → 호스트 EC2에 **연결(Associate)**.
→ 이 IP가 도메인이 가리킬 고정 공인 IP.

---

## 2단계 - libvirt DHCP 범위 줄이기 (VIP 충돌 방지)

MetalLB가 쓸 `192.168.122.240~250`을 DHCP가 안 나눠주게:
```bash
# 호스트 EC2
sudo virsh net-dhcp-leases default          # 현재 .240~ 안 쓰는지 확인
sudo virsh net-edit default
#   <range start='192.168.122.2' end='192.168.122.239'/> 로 수정
sudo virsh net-destroy default && sudo virsh net-start default
#   ⚠️ 네트워크 재시작이라 VM 잠깐 끊김 — VM 재시작 필요할 수 있음
```
> 이미 .240~ 대역을 아무도 안 쓰면 이 단계 생략 가능.

---

## 3단계 - MetalLB 설치 + 설정 (master VM)

```bash
# 설치 (공식 매니페스트)
kubectl apply -f https://raw.githubusercontent.com/metallb/metallb/v0.14.8/config/manifests/metallb-native.yaml
kubectl get pods -n metallb-system        # controller + speaker 들 Running 대기

# speaker가 worker3(ops, taint)에도 뜨게 toleration 추가 (VIP를 worker3에서 광고)
kubectl patch daemonset speaker -n metallb-system --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"dedicated","operator":"Equal","value":"ops","effect":"NoSchedule"}}]'

# IP풀 + L2 설정 적용
kubectl apply -f ~/k8s/onprem/metallb-config.yaml
```

> `metallb-config.yaml`은 VIP를 `experiment-role=ops`(worker3)에서만 ARP 광고 → 실험 워커(worker1·2) 안 건드림.

---

## 4단계 - ingress-nginx를 LoadBalancer로 전환

지금 ingress 서비스는 NodePort. LoadBalancer로 바꾸면 MetalLB가 VIP를 붙여준다:
```bash
kubectl patch svc ingress-nginx-controller -n ingress-nginx \
  -p '{"spec":{"type":"LoadBalancer"}}'

# VIP 할당 확인 — EXTERNAL-IP에 192.168.122.24x 떠야 함
kubectl get svc -n ingress-nginx ingress-nginx-controller
```
→ `EXTERNAL-IP`에 뜬 게 **MetalLB VIP** (예: 192.168.122.240).

---

## 5단계 - 호스트 DNAT (Elastic IP → VIP)

외부에서 EC2:80/443 으로 온 트래픽을 MetalLB VIP로:
```bash
# 호스트 EC2 — VIP는 4단계의 EXTERNAL-IP
VIP=192.168.122.240
sudo iptables -t nat -A PREROUTING -p tcp --dport 80  -j DNAT --to-destination $VIP:80
sudo iptables -t nat -A PREROUTING -p tcp --dport 443 -j DNAT --to-destination $VIP:443
# FORWARD 허용 (이미 있을 수 있음)
sudo iptables -I FORWARD -d 192.168.122.0/24 -j ACCEPT
sudo iptables -I FORWARD -s 192.168.122.0/24 -j ACCEPT
```
> SG: 호스트 EC2 인바운드에 **80, 443** 허용 (0.0.0.0/0).

---

## 6단계 - 도메인 DNS

도메인 등록처(또는 Route53)에서 **A 레코드**:
```
shoply.example.com   →   <Elastic IP>
```

---

## 7단계 - ingress에 Host 규칙 추가

도메인으로 들어온 요청을 라우팅:
```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shoply-ingress
  namespace: shoply
  annotations:
    kubernetes.io/ingress.class: "nginx"
spec:
  ingressClassName: nginx
  rules:
    - host: shoply.example.com        # ← 도메인
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: gateway-svc, port: { number: 4000 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: frontend-svc, port: { number: 80 } } }
EOF
```

확인:
```bash
curl http://shoply.example.com/api/products   # 상품 JSON 나오면 성공
```

---

## 8단계 (선택) - HTTPS

cert-manager + Let's Encrypt로 무료 인증서:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.yaml
# ClusterIssuer(letsencrypt) 만들고 ingress에 tls 섹션 + cert-manager 어노테이션 추가
```
> HTTP만으로도 실험엔 충분. 발표 데모에 https가 필요하면 추가.

---

## 실험 공정성

- **온프레: MetalLB(VIP) / EKS: ELB** — 둘 다 `LoadBalancer` 타입, 구현만 다름 (대칭)
- VIP 광고는 worker3(ops)에서 → 실험 워커 영향 없음
- k6 부하는 **도메인** 또는 **VIP/공인IP** 어느 쪽으로 줘도 됨 (단 양쪽 환경 동일하게)

---

## 트래픽 경로 비교 (이전 vs 지금)

| | 이전 (NodePort) | 지금 (MetalLB+도메인) |
|---|---|---|
| 진입 | EC2공인IP:30080 | 도메인 → Elastic IP :80/443 |
| LB | 수동 iptables DNAT | MetalLB VIP (LoadBalancer 서비스) |
| 온프레 현실성 | 낮음 | **높음 (베어메탈 LB 방식)** |
| EKS 대응 | — | **ELB와 대칭** |
