# team — 팀 영역 (부하·모니터링·EKS·실험)

팀원이 담당하거나 팀이 공유하는 자산.

| 경로 | 담당/내용 |
|---|---|
| `k6/` | 부하 테스트 (k6 스크립트·compose) — 팀원E |
| `infra/monitoring/` | Prometheus·Grafana·Loki 설정, 대시보드 — 팀원D |
| `infra/postgres/` · `infra/redis/` | DB·캐시 서버 Docker compose + init |
| `infra/EC2_설정_가이드.md` | EC2 설정 가이드 |
| `infra/userdata/` | postgresql·redis·rancher·monitoring·k6 서버 부트스트랩 |
| `k8s/eks/` | EKS 전용 (configmap-patch·karpenter-nodepool·serviceaccount) — EKS 팀 |
| `scripts/capture-loop.sh` | 실험 중 주기적 상태 스냅샷 캡처 |
| `scripts/analyze_experiment.py` | 스냅샷 → HTML 리포트 분석 |
| `terraform/` | 인프라 프로비저닝 (EC2+SG) — postgres · redis_k6 · monitoring_onprem · prometheus_aws |

> 관련 문서 → `문서/team/` (시나리오·부하테스트·동일화·모니터링·발표)
> ⚠️ 실험 스크립트(`capture-loop.sh`·`analyze_experiment.py`)는 본인이 작성했다면 개인(2번) 폴더로 옮겨도 됨 — 현재는 '실험/부하' 맥락으로 팀에 배치.
