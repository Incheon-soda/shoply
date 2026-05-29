# K8s 진단 명령어 모음

---

## 사이트 접속 안 될 때 체크 순서

> 바깥에서 안쪽으로 순서대로 확인

```
외부요청 → EC2 Nginx → ingress-nginx → 서비스 → Pod
```

```bash
# 1. 호스트 Nginx 살아있나?
sudo systemctl status nginx

# 2. ingress-nginx 설치됐나?
lxc exec k8s-master -- kubectl get svc -n ingress-nginx

# 3. Pod들 다 Running인가?
lxc exec k8s-master -- kubectl get pods -n shoply

# 4. Ingress 규칙 있나?
lxc exec k8s-master -- kubectl get ingress -n shoply

# 5. ConfigMap DB IP 맞나?
lxc exec k8s-master -- kubectl get configmap shoply-config -n shoply \
  -o jsonpath='{.data.POSTGRES_HOST}'
lxc exec k8s-master -- kubectl get configmap shoply-config -n shoply \
  -o jsonpath='{.data.REDIS_HOST}'
```

---

> LXD 환경에서는 모든 kubectl 명령어 앞에 `lxc exec k8s-master --` 를 붙입니다.

---

## Pod 상태 확인

```bash
# 네임스페이스별 Pod 상태
lxc exec k8s-master -- kubectl get pods -n shoply
lxc exec k8s-master -- kubectl get pods -A                    # 전체

# Pod 상세 정보 + 이벤트 (문제 원인 파악용)
lxc exec k8s-master -- kubectl describe pod -n shoply <pod-name>
lxc exec k8s-master -- kubectl describe pod -n shoply -l app=user   # label로 조회

# Pod 로그
lxc exec k8s-master -- kubectl logs -n shoply <pod-name> --tail=30
lxc exec k8s-master -- kubectl logs -n shoply <pod-name> --previous --tail=30  # 이전 크래시 로그
lxc exec k8s-master -- kubectl logs -n shoply deployment/user --tail=20        # deployment로 조회
```

---

## 서비스 / 네트워크 확인

```bash
# 서비스 목록
lxc exec k8s-master -- kubectl get svc -n shoply
lxc exec k8s-master -- kubectl get svc -A

# Ingress 확인
lxc exec k8s-master -- kubectl get ingress -n shoply

# Endpoint 확인 (서비스가 Pod와 연결됐는지)
lxc exec k8s-master -- kubectl get endpoints -n shoply
```

---

## ConfigMap / Secret 확인

```bash
# ConfigMap 내용 확인
lxc exec k8s-master -- kubectl get configmap shoply-config -n shoply -o yaml

# 특정 키만 확인
lxc exec k8s-master -- kubectl get configmap shoply-config -n shoply \
  -o jsonpath='{.data.POSTGRES_HOST}'

# Secret 값 확인 (base64 디코딩)
lxc exec k8s-master -- kubectl get secret shoply-secret -n shoply \
  -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d
```

---

## DB 연결 테스트 (Pod 내부에서)

```bash
# busybox로 임시 Pod 띄워서 네트워크 테스트
lxc exec k8s-master -- kubectl run -it --rm debug \
  --image=busybox --restart=Never -n shoply -- sh -c \
  "nc -zv <DB-IP> 5432 && echo OK || echo FAIL"

# Redis 연결 테스트
lxc exec k8s-master -- kubectl run -it --rm debug \
  --image=busybox --restart=Never -n shoply -- sh -c \
  "nc -zv <Redis-IP> 6379 && echo OK || echo FAIL"
```

---

## Deployment 재시작

```bash
# 특정 Deployment 재시작
lxc exec k8s-master -- kubectl rollout restart deployment/user -n shoply

# 전체 Deployment 재시작
lxc exec k8s-master -- kubectl rollout restart deployment -n shoply

# 롤아웃 상태 확인
lxc exec k8s-master -- kubectl rollout status deployment/user -n shoply
```

---

## ConfigMap 패치 (DB IP 변경 시)

```bash
lxc exec k8s-master -- kubectl patch configmap shoply-config -n shoply \
  --type merge \
  -p '{"data":{"POSTGRES_HOST":"<새-IP>","REDIS_HOST":"<새-IP>"}}'

lxc exec k8s-master -- kubectl rollout restart deployment -n shoply
```

---

## 노드 / 리소스 확인

```bash
lxc exec k8s-master -- kubectl get nodes
lxc exec k8s-master -- kubectl describe node k8s-worker1

# LXD 컨테이너 리소스 설정 확인
for node in k8s-master k8s-worker1 k8s-worker2; do
  echo "=== $node ==="
  lxc config show $node | grep -E "limits|size"
done

# 파드 requests/limits 확인
lxc exec k8s-master -- kubectl get pods -n shoply -o json | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
for pod in data['items']:
  name = pod['metadata']['name']
  for c in pod['spec']['containers']:
    res = c.get('resources', {})
    req = res.get('requests', {})
    lim = res.get('limits', {})
    print(f'{name}: requests={req} limits={lim}')
"

# 실제 사용량 (metrics-server 설치 필요)
lxc exec k8s-master -- kubectl top pods -n shoply
lxc exec k8s-master -- kubectl top nodes
```

### metrics-server 설치 (LXD 환경)

> LXD에서는 `--kubelet-insecure-tls` 플래그 필수

```bash
lxc exec k8s-master -- bash -c "
  helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
  helm install metrics-server metrics-server/metrics-server \
    --namespace kube-system \
    --set args={--kubelet-insecure-tls}
"

# 1~2분 후 확인
lxc exec k8s-master -- kubectl top pods -n shoply
lxc exec k8s-master -- kubectl top nodes
```

---

## 시스템 Pod 확인

```bash
# kube-system
lxc exec k8s-master -- kubectl get pods -n kube-system

# Flannel 상태
lxc exec k8s-master -- kubectl get pods -n kube-flannel

# ingress-nginx 상태
lxc exec k8s-master -- kubectl get pods -n ingress-nginx
lxc exec k8s-master -- kubectl get svc -n ingress-nginx

# kube-state-metrics
lxc exec k8s-master -- kubectl get svc -n kube-system | grep kube-state
```

---

## 컨테이너 접속

```bash
# Pod에 직접 접속
lxc exec k8s-master -- kubectl exec -it -n shoply <pod-name> -- sh

# master 컨테이너 접속
lxc exec k8s-master -- bash
```

---

## 이벤트 확인

```bash
# 네임스페이스 이벤트 (문제 발생 시 원인 파악)
lxc exec k8s-master -- kubectl get events -n shoply --sort-by='.lastTimestamp'
lxc exec k8s-master -- kubectl get events -n shoply --field-selector type=Warning
```