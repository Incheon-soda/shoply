# Terraform — Shoply 실험 인프라

`0_vpc`는 네트워크 기반(VPC·서브넷·EIP·EC2 SG)을 만들고, `1~4`는 각 서버를 **EC2 + 보안그룹만** 생성한다(VPC·서브넷·키페어는 변수 참조). 각 EC2는 user_data로 **Docker만 설치** — 실제 컨테이너(postgres/redis/prometheus 등) 기동은 각 서버의 docker compose로 별도 진행.

## 폴더 구성

| 폴더 | 생성 리소스 | 기본 타입 |
|---|---|---|
| `0_vpc/` | VPC + 퍼블릭 서브넷 1(1 AZ) + IGW + 라우팅 + **EIP 1** + **EC2용 SG 1** (프라이빗 서브넷 0) | — |
| `1_postgres/` | PostgreSQL EC2 + SG | t3.medium |
| `2_redis_k6/` | Redis EC2 + k6 EC2 + 각 SG | t3.small / t3.medium |
| `3_monitoring_onprem/` | **온프레미스** 모니터링 EC2 (Prometheus + **Grafana** + **Loki**) + SG | t3.small |
| `4_prometheus_aws/` | **AWS(EKS)** 측 Prometheus EC2 + SG | t3.small |

> Grafana는 **`3_monitoring_onprem` 한 대로 통합**. EKS 측은 `4_prometheus_aws`에 Prometheus만 두고, 온프레 Grafana가 이를 데이터소스로 끌어온다.

## 보안그룹 인바운드 요약

| 서버 | 포트 | 소스 |
|---|---|---|
| 0_vpc EC2 SG | 22 / 전체 | admin / VPC 내부 |
| postgres | 22 / 5432 / 9187 / 9100 | admin / internal / internal / internal |
| redis | 22 / 6379 / 9121 / 9100 | admin / internal / internal / internal |
| k6 | 22 | admin (그 외 아웃바운드만) |
| **monitoring(온프레)** | 22 / **3000 / 9090 / 3100** | admin / **0.0.0.0/0 (전체 개방)** |
| prometheus(EKS) | 22 / 9090 | admin / admin + 온프레 Grafana IP |

- `admin_cidr` = 본인 IP/32 (SSH)
- `internal_cidr` = VPC CIDR (DB/Redis 접속, exporter scrape)
- `grafana_source_cidr` (4번) = 온프레 모니터링 EC2 공인 IP/32
- ⚠️ **모니터링의 Grafana(3000)·Prometheus(9090)·Loki(3100)는 0.0.0.0/0 전체 개방**(요청 사항). 공개 인터넷에 노출되므로 실험 후 SG를 좁히거나 인스턴스를 내릴 것.

## 사용법

```bash
cd 0_vpc                            # 또는 1_postgres / 2_redis_k6 / 3_monitoring_onprem / 4_prometheus_aws
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars 값 채우기 (1~4는 vpc_id·subnet_id에 0_vpc 출력값 사용)
terraform init && terraform plan && terraform apply
```

## 적용 순서 (권장)

1. **`0_vpc`** — VPC/서브넷/EIP/SG 먼저. 출력 `vpc_id`·`public_subnet_id`·`vpc_cidr`·`eip_*` 메모.
2. `1_postgres`, `2_redis_k6` — `vpc_id`/`subnet_id`에 0_vpc 출력 입력.
3. `3_monitoring_onprem` — 동일. 출력된 public_ip 메모.
4. `4_prometheus_aws` — `grafana_source_cidr`에 3번 public_ip/32 입력 후 apply.

> `0_vpc`가 만든 **EIP**는 미연결 상태로 발급된다 — k8s 호스트(KVM) EC2에 연결해서 진입 EIP로 쓰면 된다. `eip_allocation_id` 출력 사용.

## 메모

- AMI는 비워두면 **Ubuntu 24.04(Noble) 최신**을 Canonical 계정에서 자동 조회.
- 상태(state)는 로컬 기본값. 팀 공유 시 S3 backend 권장.
- 폴더 간 직접 참조는 없다(독립 root). `0_vpc` 출력을 1~4의 tfvars에 손으로 넣는 구조. 자동 연동을 원하면 remote state(`terraform_remote_state`)로 묶을 수 있다.
