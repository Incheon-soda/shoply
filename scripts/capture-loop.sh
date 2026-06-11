#!/bin/bash
# ============================================================
# 자동 캡처 루프 — 부하 실험 중 주기적으로 클러스터 스냅샷 저장
#
#   master VM에서 실행 (kubectl 되는 곳).
#   부하 시작 직전에 켜두면, Ctrl+C 할 때까지 주기적으로
#   파드/노드/hpa/이벤트를 폴더별로 저장한다.
#   → 과부하(Pending) 구간이 자동으로 캡처되므로 "순간"을 놓칠 일 없음.
#
# 사용법:
#   ./capture-loop.sh [namespace] [주기초]
#   예:  ./capture-loop.sh shoply 30      # shoply NS, 30초마다
#   멈춤: Ctrl+C  (마지막에 요약 출력 후 종료)
# ============================================================
# VM이 UTC라 파일명이 한국시간과 9시간 어긋남 → 한국시간(KST)으로 고정
export TZ='Asia/Seoul'

NS="${1:-shoply}"
INTERVAL="${2:-30}"
RUN_DIR="$HOME/실험결과/run_$(date +%m%d_%H%M%S)"
mkdir -p "$RUN_DIR"

echo "▶ 캡처 시작 : ns=$NS, 주기=${INTERVAL}s"
echo "  저장 위치 : $RUN_DIR"
echo "  멈추려면  : Ctrl+C"
echo

best_count=0
best_dir=""

snapshot() {
  local ts d n pending failed
  ts=$(date +%H%M%S)
  d="$RUN_DIR/snap_$ts"
  mkdir -p "$d"
  # 이벤트는 누적(1시간)이라 매번 같이 저장 → 각 폴더가 단독으로 분석 가능
  kubectl get events -n "$NS" --sort-by='.lastTimestamp' > "$d/실험_이벤트.txt" 2>/dev/null
  kubectl get pods   -n "$NS" -o wide                    > "$d/실험_파드.txt"   2>/dev/null
  kubectl get hpa    -n "$NS"                            > "$d/실험_hpa.txt"    2>/dev/null
  kubectl top nodes                                       > "$d/실험_노드.txt"   2>/dev/null
  kubectl top pods   -n "$NS"                            > "$d/실험_파드CPU.txt" 2>/dev/null
  # 노드 할당률(request 기준) — Pending의 진짜 원인. top(사용량) 아님!
  for node in $(kubectl get nodes -o name 2>/dev/null); do
    echo "===== $node ====="
    kubectl describe "$node" 2>/dev/null | grep -A6 "Allocated resources"
  done > "$d/실험_노드할당률.txt"

  # ── 서비스별 집계 (서비스 몇 개씩, status별, 총/Pending/실패) ──
  # mawk(우분투 기본)에서도 돌게 sort|uniq -c 사용 (asorti 같은 gawk 전용 함수 금지)
  {
    echo "=== 서비스별 파드 수 (status) ==="
    tail -n +2 "$d/실험_파드.txt" \
      | awk '{svc=$1; sub(/-[a-z0-9]+-[a-z0-9]+$/,"",svc); print svc" "$3}' \
      | sort | uniq -c \
      | awk '{printf "  %-14s %-14s x%s\n", $2, $3, $1}'
    echo
    echo "=== 합계 ==="
    awk 'NR>1{t++; if($3=="Running")r++; else if($3=="Pending")p++; else if($3!="Completed")f++}
         END{printf "  총 %d   Running %d   Pending %d   실패/Crash %d\n", t+0, r+0, p+0, f+0}' \
      "$d/실험_파드.txt"
  } > "$d/요약.txt" 2>/dev/null

  # ── 진단: 비정상(Running 아닌) 파드의 원인 + 로그 ──
  : > "$d/진단.txt"
  kubectl get pods -n "$NS" --no-headers 2>/dev/null \
    | awk '$3!="Running" && $3!="Completed"{print $1" "$3}' \
    | while read -r pod st; do
        {
          echo "════════ $pod  ($st) ════════"
          kubectl describe pod -n "$NS" "$pod" 2>/dev/null | grep -A8 "Events:"
          if [ "$st" != "Pending" ]; then
            echo "──── 로그(현재) ────"
            kubectl logs -n "$NS" "$pod" --tail=20 2>/dev/null
            echo "──── 로그(직전 컨테이너) ────"
            kubectl logs -n "$NS" "$pod" --tail=20 --previous 2>/dev/null
          fi
          echo
        } >> "$d/진단.txt"
      done

  n=$(( $(wc -l < "$d/실험_파드.txt") - 1 ))   # 헤더 제외 파드 수
  [ "$n" -lt 0 ] && n=0
  pending=$(grep -c Pending "$d/실험_파드.txt" 2>/dev/null)
  failed=$(awk 'NR>1 && $3!="Running" && $3!="Pending" && $3!="Completed"' "$d/실험_파드.txt" 2>/dev/null | wc -l | tr -d ' ')
  printf "  [%s] 총 %2s개  Pending %s  실패 %s → snap_%s\n" "$ts" "$n" "$pending" "$failed" "$ts"

  if [ "$n" -gt "$best_count" ]; then best_count=$n; best_dir="$d"; fi
}

cleanup() {
  echo
  echo "■ 캡처 종료"
  echo "  총 스냅샷       : $(ls -d "$RUN_DIR"/snap_* 2>/dev/null | wc -l | tr -d ' ')개"
  echo "  파드 최다 스냅샷 : ${best_dir:-(없음)}  (${best_count}개)"
  echo
  echo "  ▶ 다음 단계:"
  echo "    1) 이 폴더 통째로 맥으로 가져가기"
  echo "       scp -r -i ~/key/aws-3tier-keypair.pem \\"
  echo "         -o ProxyCommand=\"ssh -i ~/key/aws-3tier-keypair.pem -W %h:%p ubuntu@<EC2공인IP>\" \\"
  echo "         'ubuntu@<masterVM-IP>:$RUN_DIR' ~/Downloads/"
  echo "    2) 파드 최다 폴더에 리포트 생성"
  echo "       python3 scripts/analyze_experiment.py '~/Downloads/$(basename "$RUN_DIR")/snap_XXXXXX'"
  exit 0
}
trap cleanup INT TERM

while true; do
  snapshot
  sleep "$INTERVAL"
done
