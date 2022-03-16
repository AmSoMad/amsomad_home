# 🐐 MakeUpImg

> 사진의 GPS(exif)정보를 통하여 지도를 통하여 장소별로 사진을 분리하기 <br>

구현페이지 : [https://amsomad.com/makeupimg/makeupimg.html](https://amsomad.com/makeupimg/makeupimg.html)

구현히스토리 : [amsomad.github.io](https://amsomad.github.io/%EA%B0%9C%EB%B0%9C%EC%9D%B4%EC%95%BC%EA%B8%B0/post2/)

## 🐐 사용방법 예시
> 1. 장소별 분리를 하고싶은 사진을 DropZone에 드래그엔 드롭을 한다.
> 2. GPS정보가 있는 사진은 지도에 Point로 표시가된다.
>  - 오차는 ± 10m 이다
> 3. 분리하고싶은 지역을 alt + 클릭으로 범위선택을 한다.
> 4. 하단의 선택된 사진 압축 다운로드를 누른다.

#

## 🔔 기대효과
> 1. 밀린 사진정리를 단번에 할수있다.
> 2. 사진정리는 생성시간기준별 정리밖에 없었다.
> 3. 내가 독단적이다!
#

## 🔨 문제점
> 1. 브라우져의 한계는 존제한다.
> 2. 대량 작업시 400장과 2Gb까지가 최대효율이 발생한다.
> 3. 상위의 이유는 jszip.js 해당 라이브러리의 제작자가 더이상 개발을 멈춘듯 하다.. issues에 나와같은 증상의 글들이 많다.
> 3. 해결방안은 fileStream ? 일써야 한다는데...
#

## 🔨 적용된 기능
#

> 1. 드래그엔 드롭
> 2. exif to EPSG:3857  (사진GPS 정보를 3857좌표계로 변환)
> 3. 첨부된 파일 일부만 추출하여 압축
> 4. 첫번째 파일의 주소(읍면동)를 폴더명으로 지정

## 🔨 추가적용 예정인 기능리스트
#

> 1. GPS정보가 없는파일은 input-file에서 삭제
> 2. 디자인 변경(필히 필요함)
> 3. 폴리곤 다중선택 가능
> 4. 위치 개별저장 (ol-ext 있음)
> 5. 현위치 인쇄 (ol-ext 있음)
> 6. ...

## 🔨 기능검토
[fflate](https://github.com/101arrowz/fflate)
[UZIP](https://github.com/photopea/UZIP.js)

#

**Note:** `5명 사용중!!!!!!!!!!!!`