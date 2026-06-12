# 16. ArgoCD (GitOps CD) — 운영노드(worker3) 설치

> Git 저장소를 소스로 앱을 자동 배포(GitOps)하는 ArgoCD를 **worker3(운영노드)에 격리** 설치한다.
> 그동안 "실험 워커 자원 오염" 때문에 뺐던 도구 → **worker3 taint 격리** 덕에 부담 없이 가능.
> 실험 노드(worker1·2)엔 안 올라가므로 한계 측정에 영향 없음.

---

## 0. 개념 — 왜 ArgoCD를, 왜 worker3에

- **GitOps**: `kubectl apply`를 손으로 안 하고, **Git에 매니페스트 push → ArgoCD가 자동 동기화**. 배포 이력·롤백·드리프트 감지.
- **worker3에 격리**: nodeSelector(`experiment-role=ops`) + toleration(`dedicated=ops`)로 worker3에만 배치 → 실험 워커 순수성 유지.
- 실험 본질(노드 자동확장)과 무관한 **운영 편의 도구**. 안 써도 실험은 성립.

> ⚠️ **worker3 자원 주의**: worker3(2core/4GB)엔 이미 ingress-nginx·kube-state-metrics·event-exporter·(Rancher)cattle-agent가 돈다. ArgoCD(~6개 파드)까지 얹으면 **빠듯**할 수 있다. 메모리 부족 시 → worker3 스펙 키우거나 ArgoCD 컴포넌트 일부(dex·applicationset) 비활성화.

---

## 1. 설치 (helm, worker3 핀 — master VM)

helm 글로벌 설정으로 **모든 ArgoCD 컴포넌트를 worker3에** 배치:
```bash
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update

helm install argocd argo/argo-cd -n argocd --create-namespace \
  --set global.nodeSelector."experiment-role"=ops \
  --set 'global.tolerations[0].key=dedicated' \
  --set 'global.tolerations[0].operator=Equal' \
  --set 'global.tolerations[0].value=ops' \
  --set 'global.tolerations[0].effect=NoSchedule' \
  --set server.service.type=NodePort \
  --set server.service.nodePortHttp=30808 \
  --set dex.enabled=false \           # SSO 안 쓰면
  --set applicationSet.enabled=false \ # 다중앱 템플릿 안 쓰면
  --set notifications.enabled=false    # 슬랙/이메일 안 쓰면

# 확인 — 전부 worker3에 Running
kubectl get pods -n argocd -o wide
```
> worker3(4GB)가 빠듯하면 위 `dex/applicationSet/notifications` 비활성화로 ~1GB만 쓰게(server·repo-server·application-controller·redis) → 여유 안에 들어감.

> manifest 방식(`kubectl apply -n argocd -f install.yaml`)으로 깔았으면, 각 Deployment/StatefulSet에 nodeSelector+toleration을 따로 patch해야 한다. **helm이 깔끔**.

---

## 2. 접속 (NodePort + 호스트 DNAT)

ArgoCD 서버를 NodePort(30808)로 노출했으니, 다른 NodePort처럼 호스트 DNAT로 외부 접속:
```bash
# 호스트 EC2 — worker3 IP로 (virsh net-dhcp-leases default 확인)
W3=192.168.122.92    # worker3 IP
sudo iptables -t nat -A PREROUTING -p tcp --dport 30808 -j DNAT --to-destination <master-VM-IP>:30808
#   ↑ NodePort라 어느 노드로 보내도 kube-proxy가 라우팅 → master IP로 충분
```
> SG: 호스트 EC2 인바운드 30808 (본인 IP). 또는 Rancher UI에서 바로 접근해도 됨.

**초기 admin 비밀번호** (master VM):
```bash
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d; echo
```
브라우저: `http://<호스트EC2-공인IP>:30808` → 아이디 `admin` + 위 비번.

> 또는 빠르게 보려면 port-forward: `kubectl port-forward svc/argocd-server -n argocd 8080:80` (임시).

---

## 3. 앱 배포 (Git 연결 → Application)

shoply 앱 매니페스트(`msa_shoply/k8s/`)를 Git에서 자동 배포:

```bash
cat << 'EOF' | kubectl apply -f -
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: shoply
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/incheon-soda/shopping_k8s.git   # 실제 repo
    targetRevision: main
    path: msa_shoply/k8s/common                                 # 매니페스트 경로
  destination:
    server: https://kubernetes.default.svc
    namespace: shoply
  syncPolicy:
    automated:
      prune: true        # Git에서 지운 리소스는 클러스터에서도 삭제
      selfHeal: true     # 수동 변경(드리프트) 자동 원복
EOF
```
→ 이제 **Git에 push하면 ArgoCD가 자동 배포·동기화**. UI에서 sync 상태·차이·롤백 확인.

> ⚠️ onprem/eks별 차이(configmap-patch 등)는 path를 나눠서 별도 Application으로 두거나 Kustomize/Helm overlay로 관리.

---

## 4. 실험 영향 / 공정성

| | |
|---|---|
| 배치 | worker3(ops)만 → **실험 워커 무오염** ✅ |
| 실험 변수 | 노드 자동확장(불변). ArgoCD는 배포 방식일 뿐 |
| EKS 대응 | EKS에도 동일 ArgoCD 두면 양쪽 배포 방식 통일 (또는 둘 다 kubectl) |

> ArgoCD는 **운영 편의**다. 실험 측정엔 영향 없고, "배포를 GitOps로 한다"는 운영 성숙도를 발표에 더할 수 있다.

---

## 정리

```
1. helm으로 worker3에 ArgoCD 설치 (nodeSelector+toleration)
2. NodePort 30808 + 호스트 DNAT로 접속 (admin / 초기비번)
3. Application 리소스로 Git repo 연결 → 자동 배포
4. worker3 격리라 실험 워커 영향 없음 (단 worker3 자원 빠듯 주의)
```

> 관련: worker3 격리 구조 → [13_워커3_운영노드_분리](13_워커3_운영노드_분리.md) 15단계(운영도구)에서 ArgoCD를 "선택"으로 언급. 이 문서가 그 상세.
