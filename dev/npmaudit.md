# npm audit 결과 및 처리 방법

## 발견된 취약점

### 1. esbuild (moderate)
- **버전**: <=0.24.2
- **문제**: 개발 서버가 임의의 웹사이트 요청을 받아 응답을 읽을 수 있음
- **영향**: 개발 환경에서만 사용 (CDK 빌드 시)
- **수정**: `npm audit fix --force` (breaking change)

### 2. qs (low)
- **버전**: 6.7.0 - 6.14.1
- **문제**: arrayLimit bypass로 인한 DoS 가능성
- **수정**: `npm audit fix` (non-breaking)

## 권장 처리 방법

### 안전한 방법 (권장)

```bash
# 1. non-breaking 수정만 적용
npm audit fix

# 2. 빌드 및 테스트로 검증
npm run build
npm run test

# 3. 문제 없으면 진행
```

### esbuild 취약점 처리

esbuild는 **개발/빌드 시에만 사용**되고 프로덕션 런타임에는 영향 없음:
- CDK synth/deploy 시 사용
- 배포된 Lambda/Fargate에는 포함되지 않음

**선택지:**
1. **무시하고 진행** (권장): 프로덕션에 영향 없음
2. **강제 업데이트**: `npm audit fix --force` (CDK 호환성 확인 필요)

## 처리 기록

```bash
# 날짜: 2025-02-17
# 실행 명령어:
npm audit fix

# 결과:
# - qs 취약점 수정됨
# - esbuild는 breaking change이므로 보류
```

## 참고사항

- 이 취약점들은 **개발 환경**에만 영향
- 배포된 서비스(Lambda, Fargate)에는 영향 없음
- 정기적으로 `npm audit` 실행 권장
