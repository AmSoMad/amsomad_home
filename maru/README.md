# 콕콕 레슨 캘린더

배드민턴 레슨 날짜를 고르고 공유용 정사각형 PNG 이미지로 저장하는 정적 웹페이지입니다. 서버와 계정 없이 브라우저에서만 동작합니다.

## 로컬에서 사용하기

`index.html`을 Chrome 또는 Edge에서 열면 바로 사용할 수 있습니다. 브라우저 보안 설정에 따라 이미지 저장이 제한되는 경우 아래처럼 간단한 로컬 서버로 실행하세요.

```powershell
python -m http.server 4173
```

그런 다음 `http://localhost:4173`을 엽니다.

## GitHub Pages에 올리기

1. 이 폴더의 파일을 GitHub 저장소의 기본 브랜치에 올립니다.
2. 저장소의 **Settings → Pages**로 이동합니다.
3. **Deploy from a branch**를 선택하고 기본 브랜치의 `/ (root)` 폴더를 지정합니다.
4. 표시되는 GitHub Pages 주소를 즐겨찾기하거나 공유합니다.

별도 빌드 명령은 필요하지 않습니다. 입력 내용은 각 기기의 브라우저 저장소에만 보관되며, 인터넷 서버로 전송되지 않습니다.

## 파일 구성

- `index.html`: 화면 구조
- `styles.css`: PC·모바일 화면과 저장 이미지 디자인
- `app.js`: 달력 생성, 날짜 선택, 자동 저장, 이미지 공유 기능
- `vendor/dom-export.js`: 미리보기를 PNG로 변환하는 내장 브라우저 모듈
- `vendor/korean-holidays.js`: 한국 정기 공휴일과 대체공휴일 계산 모듈
- `assets/maru-logo.png`: 화면과 저장 이미지에 사용하는 MARU 로고
- `assets/maru-logo-data.js`: 파일 직접 실행 시 PNG 저장에 사용하는 내장 로고 데이터
