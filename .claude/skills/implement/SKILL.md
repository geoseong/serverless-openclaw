---
name: implement
description: Phase 1 MVP 구현 단계를 안내합니다. 특정 단계 번호를 인자로 전달하면 해당 단계의 목표, 산출물, 검증 기준, 세부 설계를 제공합니다.
argument-hint: "[step-number, e.g. 1-3]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Phase 1 MVP 구현 가이드

구현할 단계: **$ARGUMENTS**

## 구현 절차

1. 아래 레퍼런스에서 해당 단계의 목표, 산출물, 검증 기준을 확인
2. 의존 단계가 완료되었는지 확인
3. 산출물에 명시된 파일들을 생성/수정
4. 검증 기준에 따라 결과 확인
5. `docs/progress.md`의 해당 단계 상태를 업데이트

## 레퍼런스

- 구현 단계, 컨테이너/Bridge, Lambda 설계: [implementation-plan.md](../../../docs/implementation-plan.md)

## 구현 시 필수 확인

- NAT Gateway가 생성되지 않는지 확인
- 시크릿이 디스크에 기록되지 않는지 확인 (`openclaw.json`에 API 키/토큰 없어야 함)
- RunTask에서 `launchType` 대신 `capacityProviderStrategy` 사용
- Bridge 엔드포인트에 Bearer 토큰 인증 적용 (`/health` 제외)
- userId는 서버 측 결정 (IDOR 방지)
- Telegram은 webhook-only (config에서 `delete config.channels?.telegram`)

## 검증 후 작업

구현 완료 시:
1. `docs/progress.md`에서 해당 단계 상태를 "완료"로 변경
2. 관련 문서에 반영할 변경사항이 있는지 확인
