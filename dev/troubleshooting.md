# Troubleshooting Guide

프로젝트 개발 중 발생한 문제와 해결 방법을 기록합니다.

---

## TypeScript 빌드 실패: `@serverless-openclaw/shared` 모듈을 찾을 수 없음

### 증상

```bash
npm run build
```

실행 시 다음과 같은 에러 발생:

```
error TS2307: Cannot find module '@serverless-openclaw/shared' or its corresponding type declarations.
```

34개의 에러가 발생하며 모두 `@serverless-openclaw/shared` 패키지를 import하는 부분에서 발생.

### 원인

1. **TypeScript composite 프로젝트 캐싱 문제**
   - `packages/shared/tsconfig.tsbuildinfo` 파일이 오래된 상태로 남아있음
   - TypeScript가 "변경사항 없음"으로 판단하고 빌드를 스킵
   - `packages/shared/dist/` 디렉토리가 생성되지 않거나 .js 파일이 없음

2. **npm workspaces 의존성 문제**
   - shared 패키지가 먼저 빌드되어야 다른 패키지에서 참조 가능
   - 빌드 순서는 올바르게 설정되어 있지만 캐시 문제로 실제 빌드가 스킵됨

### 해결 방법

#### 방법 1: 강제 재빌드 (권장)

```bash
# 1. 의존성 재설치
rm -rf node_modules package-lock.json
rm -rf packages/*/node_modules
npm install

# 2. shared 패키지 강제 빌드
rm -f packages/shared/tsconfig.tsbuildinfo
npx tsc --build packages/shared/tsconfig.json --force

# 3. 전체 빌드
npm run build
```

#### 방법 2: 빌드 캐시 정리

```bash
# 모든 tsbuildinfo 파일 삭제
find . -name "tsconfig.tsbuildinfo" -delete

# 모든 dist 디렉토리 삭제
rm -rf packages/*/dist

# 전체 재빌드
npm run build
```

#### 방법 3: shared 패키지만 먼저 빌드

```bash
# shared 패키지만 빌드
npm run build --workspace=packages/shared

# 전체 빌드
npm run build
```

### 확인 방법

빌드가 성공했는지 확인:

```bash
# shared/dist 디렉토리 확인
ls -la packages/shared/dist/

# 다음 파일들이 있어야 함:
# - constants.js, constants.d.ts
# - types.js, types.d.ts
# - index.js, index.d.ts
# - 각각의 .map 파일들
```

### 예방 방법

1. **git clone 직후 항상 실행**:
   ```bash
   npm install
   npm run build
   ```

2. **의존성 변경 후**:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npm run build
   ```

3. **빌드 에러 발생 시 첫 번째 시도**:
   ```bash
   npm run build --workspace=packages/shared
   npm run build
   ```

### 관련 이슈

- TypeScript composite projects의 incremental 빌드 캐싱 문제
- npm workspaces에서 패키지 간 의존성 빌드 순서

### 날짜

2025-02-17

---
