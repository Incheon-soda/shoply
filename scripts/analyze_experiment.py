#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
온프레미스/EKS 부하 실험 결과 자동 리포트 생성기

사용법:
    python3 scripts/analyze_experiment.py 실험결과/0843
    python3 scripts/analyze_experiment.py 실험결과/0843 --title "온프레 시나리오 A"

입력: 폴더 안의 실험_이벤트*.txt / 실험_파드*.txt / 실험_노드*.txt / 실험_hpa*.txt
출력: 같은 폴더에 리포트_<폴더명>.html  (브라우저로 바로 열림)

해석은 전부 로그 파싱(정규식)이라 같은 입력 → 항상 같은 결과 (재현성 보장).
"""
import re
import sys
import glob
import html
import pathlib
import argparse


# ── 파일 찾기 (시간 붙은 이름도 글롭으로) ──────────────────────────
def find_file(folder: pathlib.Path, keyword: str):
    hits = sorted(folder.glob(f"*{keyword}*.txt"))
    return hits[0].read_text(encoding="utf-8") if hits else ""


# ── 이벤트 파싱 ────────────────────────────────────────────────────
def parse_events(text: str):
    # ① 한계 증거 — FailedScheduling + Insufficient
    failed = re.findall(r"FailedScheduling", text)
    insufficient = re.findall(r"Insufficient cpu", text)
    taint_blocked = "untolerated taint" in text
    limit_reached = len(insufficient) > 0

    # 대표 메시지 1줄 (가장 정보 많은 것)
    sample_msg = ""
    m = re.search(r"(0/\d+ nodes are available:[^\n]*)", text)
    if m:
        sample_msg = m.group(1).split("no new claims")[0].strip().rstrip(",")

    # ② 서비스별 최대 파드 수
    peaks = {}
    for svc, n in re.findall(r"Scaled up replica set (\w+?)-\w+ from \d+ to (\d+)", text):
        peaks[svc] = max(peaks.get(svc, 0), int(n))
    # scale down에서도 더 큰 from 값이 있으면 반영 (피크를 놓치지 않게)
    for svc, frm in re.findall(r"Scaled down replica set (\w+?)-\w+ from (\d+) to \d+", text):
        peaks[svc] = max(peaks.get(svc, 0), int(frm))

    # ③ 타임라인 — Rescale / FailedScheduling 시간 + 내용
    timeline = []
    for line in text.splitlines():
        if "SuccessfulRescale" in line or "FailedScheduling" in line or "Scaled up" in line or "Scaled down" in line:
            mt = re.match(r"\s*(\S+)\s", line)
            age = mt.group(1) if mt else "?"
            if "FailedScheduling" in line:
                timeline.append((age, "❌ Pending 발생 (스케줄 실패)"))
            elif "above target" in line:
                mm = re.search(r"New size: (\d+)", line)
                timeline.append((age, f"⬆️ 스케일업 → {mm.group(1) if mm else '?'}개 (CPU 초과)"))
            elif "below target" in line:
                mm = re.search(r"New size: (\d+)", line)
                timeline.append((age, f"⬇️ 스케일다운 → {mm.group(1) if mm else '?'}개 (CPU 여유)"))

    # 중복 압축 (같은 age+내용 연속이면 1개)
    compact = []
    for item in timeline:
        if not compact or compact[-1] != item:
            compact.append(item)

    return {
        "limit_reached": limit_reached,
        "failed_count": len(failed),
        "insufficient_count": len(insufficient),
        "taint_blocked": taint_blocked,
        "sample_msg": sample_msg,
        "peaks": peaks,
        "timeline": compact,
    }


# ── 노드(top) 파싱 ─────────────────────────────────────────────────
def parse_nodes(text: str):
    nodes = []
    for line in text.splitlines():
        m = re.match(r"(\S+)\s+(\d+)m\s+(\d+)%\s+(\d+)Mi\s+(\d+)%", line)
        if m:
            nodes.append({
                "name": m.group(1), "cpu_m": int(m.group(2)),
                "cpu_pct": int(m.group(3)), "mem_pct": int(m.group(5)),
            })
    return nodes


# ── 파드 파싱 ──────────────────────────────────────────────────────
def parse_pods(text: str):
    rows, dist = [], {}
    svc_status = {}                       # 서비스 -> {status: 개수}
    running = pending = failed = 0
    for line in text.splitlines():
        if line.startswith("NAME") or not line.strip():
            continue
        cols = line.split()
        if len(cols) >= 7:
            name, status, node = cols[0], cols[2], cols[6]
            rows.append({"name": name, "status": status, "node": node})
            dist[node] = dist.get(node, 0) + 1
            svc = re.sub(r"-[a-z0-9]+-[a-z0-9]+$", "", name)   # 파드명 → 서비스명
            svc_status.setdefault(svc, {})
            svc_status[svc][status] = svc_status[svc].get(status, 0) + 1
            if status == "Running":
                running += 1
            elif status == "Pending":
                pending += 1
            elif status != "Completed":
                failed += 1
    totals = {"running": running, "pending": pending, "failed": failed,
              "total": running + pending + failed}
    return rows, dist, svc_status, totals


# ── 노드 할당률(request 기준) 파싱 — Pending의 진짜 원인 ──────────────
def parse_alloc(text: str):
    out, cur = [], None
    for line in text.splitlines():
        m = re.search(r"node/(\S+)", line)
        if m:
            cur = m.group(1)
            continue
        m = re.match(r"\s*cpu\s+\d+m?\s*\((\d+)%\)", line)
        if m and cur:
            out.append({"node": cur, "cpu_req_pct": int(m.group(1))})
            cur = None
    return out


# ── HTML 렌더 ──────────────────────────────────────────────────────
def render_html(title, ev, nodes, pods, dist, svc_status, totals, alloc, diag):
    peaks = ev["peaks"]
    peak_total = sum(peaks.values())
    actual = totals["total"] if totals["total"] else len(pods)
    pending_now = totals["pending"]
    maxbar = max(peaks.values()) if peaks else 1

    def bar(v, color="#3b82f6,#60a5fa"):
        w = int(v / maxbar * 240)
        return f'<div class="bar" style="width:{w}px;background:linear-gradient(90deg,{color})"></div>'

    peaks_rows = "\n".join(
        f'<tr><td class="svc">{html.escape(s)}</td>'
        f'<td>{bar(n)}</td><td class="num">{n}</td></tr>'
        for s, n in sorted(peaks.items(), key=lambda x: -x[1])
    )

    # 서비스별 현재 status (Running / Pending / 실패) 표
    def svc_row(svc, st):
        r = st.get("Running", 0)
        p = st.get("Pending", 0)
        f = sum(v for k, v in st.items() if k not in ("Running", "Pending", "Completed"))
        pcell = f'<span class="pend">{p}</span>' if p else "0"
        fcell = f'<span class="fail">{f}</span>' if f else "0"
        return (f'<tr><td class="svc">{html.escape(svc)}</td>'
                f'<td class="num">{r}</td><td class="num">{pcell}</td>'
                f'<td class="num">{fcell}</td><td class="num">{r + p + f}</td></tr>')
    svc_rows = "\n".join(svc_row(s, st) for s, st in
                         sorted(svc_status.items(), key=lambda x: -sum(x[1].values())))

    # 노드 할당률 (request 기준) — 90%+ 빨강
    alloc_rows = "\n".join(
        f'<tr><td>{html.escape(a["node"])}</td>'
        f'<td class="num" style="color:{"#fca5a5" if a["cpu_req_pct"]>=90 else "#e6e6e6"}">'
        f'{a["cpu_req_pct"]}%</td></tr>'
        for a in alloc
    )
    diag_block = (f'<pre class="diag">{html.escape(diag.strip())}</pre>'
                  if diag.strip() else '<p class="muted">비정상 파드 없음 (모두 Running)</p>')

    # 타임라인: 파일은 오래된→최신 순서라 뒤집어서 "최신순"으로. 자르지 않고 전부 표시.
    tl_rows = "\n".join(
        f'<tr><td class="age">{html.escape(a)} 전</td><td>{html.escape(d)}</td></tr>'
        for a, d in reversed(ev["timeline"])
    )

    node_rows = "\n".join(
        f'<tr><td>{html.escape(n["name"])}</td>'
        f'<td class="num" style="color:{"#fca5a5" if n["cpu_pct"]>=85 else "#e6e6e6"}">{n["cpu_pct"]}%</td>'
        f'<td class="num">{n["mem_pct"]}%</td>'
        f'<td class="num">{dist.get(n["name"], 0)}개</td></tr>'
        for n in nodes
    )

    limit_badge = ('<span class="badge yes">✅ 한계 도달 (Pending 발생)</span>'
                   if ev["limit_reached"] else
                   '<span class="badge no">⬜ 한계 미도달 (여유 있음)</span>')

    running_now = totals["running"]
    conclusion = (
        f'온프레미스는 실험 노드(worker1·2)의 CPU 한계에서 파드 <b>{running_now}개</b>를 천장으로 '
        f'<b>Pending {pending_now}개</b>가 쌓인다. 캡처 시점 총 {actual}개 요청 중 {running_now}개만 배치 '
        f'→ 나머지 {pending_now}개는 노드 자리 없어 대기.'
        if ev["limit_reached"] or pending_now > 0 else
        f'아직 노드에 여유가 있어 Pending이 없다. 부하를 더 올려야 한계가 보인다. '
        f'(현재 Running {running_now}개)'
    )

    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>
  body{{font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;background:#0f1117;color:#e6e6e6;
       max-width:860px;margin:0 auto;padding:32px 24px;line-height:1.6}}
  h1{{font-size:24px;border-bottom:2px solid #3b82f6;padding-bottom:12px}}
  h2{{font-size:18px;margin-top:36px;color:#93c5fd}}
  .badge{{display:inline-block;padding:6px 14px;border-radius:8px;font-weight:700;font-size:15px}}
  .badge.yes{{background:#7f1d1d;color:#fecaca}} .badge.no{{background:#1e3a5f;color:#bfdbfe}}
  table{{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}}
  th,td{{text-align:left;padding:8px 10px;border-bottom:1px solid #232838}}
  th{{color:#9ca3af;font-weight:600}}
  .num{{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}}
  .svc{{font-weight:600;width:110px}}
  .bar{{height:16px;background:linear-gradient(90deg,#3b82f6,#60a5fa);border-radius:4px}}
  .age{{color:#9ca3af;width:90px;white-space:nowrap}}
  .summary{{background:#161a24;border:1px solid #232838;border-radius:12px;padding:18px 22px;margin-top:14px}}
  .summary td:first-child{{color:#9ca3af;width:160px}}
  .conc{{background:#1a2233;border-left:4px solid #3b82f6;border-radius:8px;padding:16px 20px;
         margin-top:14px;font-size:15px}}
  .msg{{font-family:ui-monospace,monospace;font-size:12px;color:#fca5a5;background:#1a1010;
        padding:10px 14px;border-radius:6px;margin-top:8px;word-break:break-all}}
  .pend{{color:#fbbf24;font-weight:700}} .fail{{color:#fca5a5;font-weight:700}}
  .diag{{font-family:ui-monospace,monospace;font-size:12px;color:#cbd5e1;background:#11151f;
         border:1px solid #232838;border-radius:8px;padding:14px 16px;
         max-height:360px;overflow:auto;white-space:pre-wrap;line-height:1.45}}
  .scroll{{max-height:360px;overflow-y:auto;border:1px solid #232838;border-radius:8px}}
  .scroll table{{margin-top:0}}
  .muted{{color:#6b7280}}
  .foot{{margin-top:40px;color:#6b7280;font-size:12px;border-top:1px solid #232838;padding-top:14px}}
</style></head><body>

<h1>📋 {html.escape(title)}</h1>

<h2>📊 요약</h2>
<div class="summary"><table>
  <tr><td>한계 도달</td><td>{limit_badge}</td></tr>
  <tr><td>한계 원인</td><td>{'Insufficient cpu (worker1·2 만재) + worker3 taint 격리' if ev['taint_blocked'] else 'Insufficient cpu'}</td></tr>
  <tr><td>총 파드 (요청)</td><td><b>{actual}개</b></td></tr>
  <tr><td>Running / Pending / 실패</td><td><b>{running_now}</b> / <span class="pend">{pending_now}</span> / <span class="fail">{totals['failed']}</span></td></tr>
  <tr><td>FailedScheduling 이벤트</td><td>{ev['failed_count']}건</td></tr>
</table>
{f'<div class="msg">{html.escape(ev["sample_msg"])}</div>' if ev["sample_msg"] else ''}
</div>

<h2>📦 서비스별 파드 현황 (캡처 시점) ★</h2>
<table>
<tr><th>서비스</th><th class="num">Running</th><th class="num">Pending</th><th class="num">실패</th><th class="num">합계</th></tr>
{svc_rows}
</table>

<h2>🩺 진단 — 왜 안 떴나 (비정상 파드 원인·로그)</h2>
{diag_block}

<h2>🧮 노드 CPU 할당률 (request 기준) — Pending의 진짜 원인</h2>
<p class="muted">스케줄링은 사용량(top)이 아니라 <b>request 합계 vs allocatable</b>로 결정됨. 90%+ 면 새 파드 못 받음.</p>
<table><tr><th>노드</th><th class="num">CPU request 할당률</th></tr>{alloc_rows}</table>

<h2>🖥 노드 사용률 / 파드 분포 (캡처 시점)</h2>
<table><tr><th>노드</th><th class="num">CPU</th><th class="num">MEM</th><th class="num">파드 수</th></tr>
{node_rows}</table>

<h2>📈 서비스별 최대 파드 수 (이벤트 로그 기준, 부하 전체)</h2>
<table>{peaks_rows}</table>

<h2>⏱ 타임라인 (최신순)</h2>
<div class="scroll"><table>{tl_rows}</table></div>

<h2>🎯 결론</h2>
<div class="conc">{conclusion}</div>

<div class="foot">로그 파싱 자동 생성 · 같은 입력 → 같은 결과 (재현성 보장) ·
generated by analyze_experiment.py</div>
</body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--title", default=None)
    args = ap.parse_args()

    folder = pathlib.Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"폴더 없음: {folder}")

    # ── run 폴더(snap_* 여러 개)면 한계(파드 최다) 스냅샷 자동 선택 → HTML 1개 ──
    snaps = sorted(folder.glob("snap_*"))
    if snaps:
        def podcount(d):
            try:
                return len(find_file(d, "파드").splitlines()) - 1
            except Exception:
                return 0
        peak = max(snaps, key=podcount)        # 점-시점 데이터는 "파드 최다(과부하)" 스냅샷
        last = snaps[-1]                        # 타임라인은 마지막(가장 완전한 이벤트)
        print(f"  run 폴더 감지 — snap {len(snaps)}개 중 한계 스냅샷: {peak.name} "
              f"(파드 {podcount(peak)}개)")
        ev_src, pt_src = last, peak
        default_title = f"부하 실험 리포트 — {folder.name} (한계: {peak.name})"
    else:
        ev_src = pt_src = folder               # 단일 스냅샷 폴더
        default_title = f"부하 실험 리포트 — {folder.name}"

    ev = parse_events(find_file(ev_src, "이벤트"))
    nodes = parse_nodes(find_file(pt_src, "_노드"))          # "_노드"로 노드할당률.txt 와 구분
    alloc = parse_alloc(find_file(pt_src, "노드할당률"))
    pods, dist, svc_status, totals = parse_pods(find_file(pt_src, "파드"))
    diag = find_file(pt_src, "진단")

    title = args.title or default_title
    out = folder / f"리포트_{folder.name}.html"             # run 폴더 루트에 HTML 1개
    out.write_text(render_html(title, ev, nodes, pods, dist, svc_status, totals, alloc, diag),
                   encoding="utf-8")
    print(f"✅ 생성: {out}")
    print(f"   한계도달={ev['limit_reached']}  Running={totals['running']}  "
          f"Pending={totals['pending']}  실패={totals['failed']}  "
          f"FailedScheduling={ev['failed_count']}건")


if __name__ == "__main__":
    main()
