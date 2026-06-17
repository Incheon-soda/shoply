# msa_shoply — 프로젝트 파일 구조

**앱 / 온프레미스(개인) / 팀** 세 갈래로 정리.

| 폴더 | 내용 |
|---|---|
| [`app/`](app/) | 애플리케이션 코드 — gateway·services·frontend·db·docker-compose |
| [`onprem/`](onprem/) | 내가 한 온프레미스 배포·운영 — k8s(common·onprem)·scripts(호스트·복원) |
| [`team/`](team/) | 팀 영역 — k6(부하)·infra(monitoring·postgres·redis·userdata)·k8s/eks·scripts(실험 캡처·분석)·**terraform** |

> ⚠️ 카테고리 폴더 도입으로 `.github/workflows`(CI/CD)의 경로(`msa_shoply/gateway/**` 등)는 더 이상 맞지 않음. CI를 다시 쓰려면 경로를 `msa_shoply/app/...`로 갱신 필요.
> ✅ `docker-compose.yml`은 앱 파일과 함께 `app/`으로 옮겨져 상대경로가 그대로 유효 — 빌드 정상.
> ☁️ 인프라 프로비저닝 Terraform은 `team/terraform/`(postgres·redis_k6·monitoring·prometheus 4세트).
