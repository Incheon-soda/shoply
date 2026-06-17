# app — 애플리케이션 자체

쇼핑몰 앱(서비스) 그 자체에 대한 문서. 인프라·실험과 분리된 **순수 애플리케이션 영역**.

| 문서 | 내용 |
|---|---|
| [앱_서비스_설명](앱_서비스_설명.md) | MSA 7개 서비스(gateway·product·inventory·order·payment·user·frontend) 구성·역할·핵심 로직·API·서비스 간 통신 |
| [데이터베이스](데이터베이스.md) | PostgreSQL 16 + Redis 7 — 스키마·ERD·인덱스·핵심 쿼리·동시성(SELECT FOR UPDATE)·캐시·시드·관리 쿼리 |

> 상위 인덱스 → [../README.md](../README.md)
