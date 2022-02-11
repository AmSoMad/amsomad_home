function download() {
  var blob = new Blob([$("#result").val()], {
    type: "text/plain;charset=utf-8",
  });
  console.log(blob);
  saveAs(blob, "photo.geojson");
}

let newProj = ol.proj.get("EPSG:3857"); // 사용 좌표계
let newProjExtent = newProj.getExtent(); // 지도의 범위
/* 뷰 설정 초기 위치 값 및 지도의 지원 줌레벨 현재 줌레벨 지도의 좌표계설정을 설정  */
let olView = new ol.View({
  //center: ol.proj.transform([127.100616,37.402142], 'EPSG:4326', 'EPSG:3857'),
  //center: [14246500.1385945, 4332489.929359414],
  center: [14154805.114154082, 4476670.094450143],
  zoom: 16,
  minZoom: 1,
  maxZoom: 19,
  projection: newProj,
  extent: newProjExtent || undefined, // 해당 지역을 지도에서 벗어나지 않도록 설정
  //extent : [13678546.51713, 3834188.8033424, 14854453.760059, 5314661.8558898],
});

/* 오픈 레이어스에서 WMTS API를 이용 브이월드 배경지도를 호출  */
let BaseLayer = new ol.layer.Tile({
  source: new ol.source.XYZ({
    url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png",
    format: new ol.format.GeoJSON(),
  }),
  name: "2D배경지도",
  visible: true,
  //   minResolution: 0,
  //   maxResolution: 1400,
});

/**
 * 맵생성 정의.
 *
 * @class
 * @augments ol.Map
 * @param {String} url 타일 URL
 * @param {Object} Controls Options
 */
// The map

var map = new ol.Map({
  target: "map",
  // view: new ol.View ({
  //   zoom: 1,
  //   center: [270055, 3528229.]
  // }),
  view: olView,
  controls: ol.control.defaults().extend([
    new ol.control.LayerSwitcher({
      target: $(".layerSwitcher").get(0),
      trash: true,
      extent: true,
      collapsed: true, //false 는 열린상태로시작
      oninfo: function (l) {
        alert(l.get("title"));
      },
    }),
  ]),

  layers: [BaseLayer],
});

var global_Vector_Layer;
var global_Vector_Source;

const selectedStyle = new ol.style.Style({
  fill: new ol.style.Fill({
    color: "rgba(255, 255, 255, 0.6)",
  }),
  stroke: new ol.style.Stroke({
    color: "rgba(255, 255, 255, 0.7)",
    width: 2,
  }),
});

// a normal select interaction to handle click
const select = new ol.interaction.Select({
  style: function (feature) {
    const color = feature.get("COLOR_BIO") || "#eeeeee";
    selectedStyle.getFill().setColor(color);
    return selectedStyle;
  },
});
map.addInteraction(select);

const selectedFeatures = select.getFeatures();

// a DragBox interaction used to select features by drawing boxes
const dragBox = new ol.interaction.DragBox({
  condition: ol.events.condition.platformModifierKeyOnly,
  style: new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: "white",
      width: 2,
    }),
    fill: new ol.style.Fill({
      color: "rgba(0,0,255,0.6)",
    }),
  }),
});

map.addInteraction(dragBox);

const selectSingleClick = new ol.interaction.Select({ style: selectedStyle });

// select interaction working on "click"
const selectClick = new ol.interaction.Select({
  condition: ol.events.condition.click,
  style: selectedStyle,
});

// select interaction working on "pointermove"
const selectPointerMove = new ol.interaction.Select({
  condition: ol.events.condition.pointerMove,
  style: selectedStyle,
});
map.addInteraction(selectSingleClick);
map.addInteraction(selectClick);
//map.addInteraction(selectPointerMove);

dragBox.on("boxend", function () {
  const extent = dragBox.getGeometry().getExtent();
  const boxFeatures = global_Vector_Source
    .getFeaturesInExtent(extent)
    //.getExtent(extent)
    .filter((feature) => feature.getGeometry().intersectsExtent(extent));

  const rotation = map.getView().getRotation();
  const oblique = rotation % (Math.PI / 2) !== 0;

  if (oblique) {
    const anchor = [0, 0];
    const geometry = dragBox.getGeometry().clone();
    geometry.rotate(-rotation, anchor);
    const extent = geometry.getExtent();
    boxFeatures.forEach(function (feature) {
      const geometry = feature.getGeometry().clone();
      geometry.rotate(-rotation, anchor);
      if (geometry.intersectsExtent(extent)) {
        selectedFeatures.push(feature);
      }
    });
  } else {
    selectedFeatures.extend(boxFeatures);
  }

});

dragBox.on("boxstart", function () {
  selectedFeatures.clear();
});

const infoBox = document.getElementById("info");

selectedFeatures.on(["add", "remove"], function () {
  const names = selectedFeatures.getArray().map(function (feature) {
    return feature.get("url");
  });
  if (names.length > 0) {
    infoBox.innerHTML = names.length;
  } else {
    infoBox.innerHTML = "None";
  }
});

dragBox.on("select", function (e) {

  
});

/**
 * drag & drop 부분
 *
 * @class
 * @augments
 * @param {String} url 타일 URL
 * @param {Object} Controls Options
 */

$(function () {
  $("#dropzone").on("dragover", function () {
    $(this).addClass("hover");
  });

  $("#dropzone").on("dragleave", function () {
    $(this).removeClass("hover");
  });

  $("#dropzone input").on("change", function (e) {
    var file = this.files[0];


    $("#dropzone").removeClass("hover");

    if (this.accept && $.inArray(file.type, this.accept.split(/, ?/)) == -1) {
      return alert("File type not allowed.");
    }

    $("#dropzone").addClass("dropped");
    $("#dropzone img").remove();

    if (/^image\/(gif|png|jpeg)$/i.test(file.type)) {
      var reader = new FileReader(file);

      reader.readAsDataURL(file);

      reader.onload = function (e) {
        var data = e.target.result,
          $img = $("<img />").attr("src", data).fadeIn();

        $("#dropzone div").html($img);
      };
    } else {
      var ext = file.name.split(".").pop();

      $("#dropzone div").html(ext);
    }
    console.log("등록된 파일 갯수");
    console.log($("#dropfile_input")[0].files.length);
    var inputfiles = $("#dropfile_input")[0].files;
    $("#filecnt").html(inputfiles.length + " 개");

    //파일 geojson 변환
    img_to_geojson(inputfiles);
  });
});

/**
 * drag & drop 부분
 *
 * @class
 * @augments
 * @param {File}
 */

function img_to_geojson(files) {
  exif2geojson(files, {
    onLoad: function (json) {
 
      $("#result").val(JSON.stringify(json, null, " "));
      var format = new ol.format.GeoJSON();
      var features = format.readFeatures(json, {
        featureProjection: map.getView().getProjection(),
      });

      var vector = new ol.source.Vector({
        features: features,
        name: "업로드사진",
      });

      var vectorLayer = new ol.layer.Vector({
        source: vector,
        opacity: 1,
        name: "업로드사진",
        visible: true,
      });
      attach_file_list();
      global_Vector_Source = vector;
      global_Vector_Layer = vectorLayer;
      map.addLayer(vectorLayer);
    },
  });
}

/**
 * 선택한파일 다운버튼함수
 * 선택한 feature의 이름비교하여 같은것만 압축에 포함한다.
 * 
 * @class
 * @augments
 * @param {File}
 */

function select_download_zip() {
  // global_Vector_Source.getFeatures() 전체 레이어 객체
  // global_Vector_Source.getFeatures()[0].A.url 전체 레이어 파일명
  // selectedFeatures.R[0].A.url 선택된 레이어 파일명
  try {
    var corrdinates = selectedFeatures.R[0].A.geometry.flatCoordinates

    var p_5179 = proj4('EPSG:3857','EPSG:5179',[corrdinates[0],corrdinates[1]]);

    Reverse_GeoCodding(p_5179[0],p_5179[1]);
    

  } catch (error) {
    console.log(error);
    alert("선택하신 위치가 없습니다.");
    
  }

}

/**
 * zip파일 생성 및 다운로드
 * 선택한 feature의 이름비교하여 같은이름의 파일을 압축에포함한다.
 * 폴더명 및 압축명도 해당주소 동까지 지정
 * 
 * @class
 * @augments
 * @param {File}
 */
function createZipFile(){
  var addr = $("#bunji_address").val();
  var zip = new JSZip();
  var zipFolder = zip.folder(addr);
  
  for(var i = 0; i < selectedFeatures.R.length; i++){
    var fileName = selectedFeatures.R[i].A.url
    zipFolder.file(fileName, srch_file_Data(fileName));
  }

  zip.generateAsync({ type: "blob" }).then(function (blob) {
    saveAs(blob, String(addr));
  });
}



/**
 * 선택한파일 비교리턴
 * 선택한 feature의 이름비교하여 같은이름의 파일을 리턴
 * 
 * @class
 * @augments
 * @param {File}
 */
function srch_file_Data(param_FileName){
  var files = $("#dropfile_input")[0].files;
  for(var z = 0; z < files.length; z++ ){
    if(files[z].name == param_FileName){
      return files[z];
    }
  }
  
}
/**
 * SGIS 지오코딩
 * 기능 : 해당주소를 5179좌표로 변환하여 알려준다.
 * 참고사항 : SGIS api 활용 단 주소가 옛날 체계를 사용함(법정동도 껴있음)
 * @class
 * @augments
 * @param {File}
 */
function srch_addr(address) {
  //주소
  var param = {
    address: address,
    accessToken: $("input[name=SGIS_AccessToken]").val(),
    pagenum: 0, //페이지수 default : 0
    resultcount: 1, // 결과수 최소 1 최대 50  기본값 5
  };
  $.ajax({
    type: "GET",
    url: "https://sgisapi.kostat.go.kr/OpenAPI3/addr/geocode.json",
    data: param,
    dataType: "json",
    success: function (data) {
      var coordinate_x = data.result.resultdata[0].x;
      var coordinate_y = data.result.resultdata[0].y;
      var point = new ol.geom.Point([
        Number(coordinate_x),
        Number(coordinate_y),
      ]);

      var p_3857 = proj4("EPSG:5179", "EPSG:3857", [
        point.flatCoordinates[0],
        point.flatCoordinates[1],
      ]);

      flyTo(p_3857, function () {});
    },
  });
}

/**
 * SGIS 리버스 지오코딩
 * 기능 : 해당좌표를 도로명,지번으로 조회한다
 * 참고사항 : SGIS api 활용 단 주소가 옛날 체계를 사용함(법정동도 껴있음)
 * @class
 * @augments
 * @param {File}
 */
function Reverse_GeoCodding(loc_x, loc_y, addr_type) {

  // 행정동
  var param = {
    x_coor: loc_x,
    y_coor: loc_y,
    addr_type: "20",
    accessToken: $("input[name=SGIS_AccessToken]").val(),
  };
  var param2 = {
    x_coor: loc_x,
    y_coor: loc_y,
    addr_type: "21",
    accessToken: $("input[name=SGIS_AccessToken]").val(),
  };

  geocode_promise_function(param)
    //.then(geocode_promise_function(param2))
    .finally();
  //.then(notification.show([$("input[name=road_address]").val() +"  "+ $("input[name=bunji_address]").val()]));
}

function geocode_promise_function(param) {
  return new Promise((resolve, reject) => {
    $.ajax({
      type: "GET",
      url: "https://sgisapi.kostat.go.kr/OpenAPI3/addr/rgeocode.json",
      data: param,
      dataType: "json",
      success: function (data) {
        console.log(data);
        if (data.errMsg == "Success") {
          // if (data.result[0].hasOwnProperty("emdong_nm")) {
          //   $("input[name=bunji_address]").val(data.result[0].full_addr);
          // } else {
          //   $("input[name=road_address]").val(data.result[0].full_addr);
          // }
          $("input[name=bunji_address]").val(data.result[0].full_addr);
          createZipFile();
          // if (data.result[0].hasOwnProperty("sido_nm")) {
          //   $("input[name=sido_nm]").val(data.result[0].sido_nm);
          // }
        } else {
          $("input[name=bunji_address]").val("알수없는주소");
        }
      },
    });
  });
}
/**
 * SGIS 인증키발급
 * 기능 : SGIS 인증키를 매번 실행시 받는다.
 * 참고사항 : 매번 실행시 인증키가 변경됌
 * @class
 * @augments
 * @param {File}
 */
function sgis_authkey() {
  var cunsumer_key = "c8fa0b47181b4c48897f";
  var consumer_secret = "5172bd52d4d7465ba144";
  var param = {
    consumer_key: cunsumer_key,
    consumer_secret: consumer_secret,
  };

  $.ajax({
    type: "GET",
    url: "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json",
    data: param,
    dataType: "json",
    success: function (getResult) {
      console.log(getResult);
      $("input[name=SGIS_AccessToken]").val(getResult.result.accessToken);
    },
  });
}

/**
 * 문서시작시
 * 기능 :
 * 참고사항 :
 * @class
 * @augments
 * @param {File}
 */
$(document).ready(function () {
  sgis_authkey();
});

/**
 * 파일다운로드 FileSavers.js
 * 기능 :
 * 참고사항 :
 * @class
 * @augments
 * @param {File}
 */
function attach_file_list() {
  var html = `<table border="1">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Create Time</th>
                  <th>Model</th>
                  <th>Type</th>
                </tr>
              </thead>`;
  var files = $("#dropfile_input")[0].files;
  var filesArr = Array.prototype.slice.call(files);
  filesArr.forEach(function (currentValue, index, array) {
    html += "<tr>";
    html += "<td>" + filesArr[index].name + "</td>";
    html += "<td>" + filesArr[index].exifdata.DateTime + "</td>";
    html += "<td>" + filesArr[index].exifdata.Model + "</td>";
    html += "<td>" + filesArr[index].type + "</td>";
    html += "</tr>";
  });
  html += "</table>";
  $("#attach_file_list").html(html);
}

// 출처: https://jamssoft.tistory.com/191 [What should I do?]

