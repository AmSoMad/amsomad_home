(function (global) {
  "use strict";

  function collectCss() {
    return Array.from(document.styleSheets)
      .map(function (sheet) {
        try {
          return Array.from(sheet.cssRules)
            .map(function (rule) {
              return rule.cssText;
            })
            .join("\n");
        } catch (_error) {
          return "";
        }
      })
      .join("\n");
  }

  function escapeXml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function copyFormValues(source, clone) {
    var sourceFields = source.querySelectorAll("input, textarea, select");
    var cloneFields = clone.querySelectorAll("input, textarea, select");
    sourceFields.forEach(function (field, index) {
      var target = cloneFields[index];
      if (!target) return;
      if (field.tagName === "TEXTAREA") target.textContent = field.value;
      else if (field.tagName === "SELECT") target.value = field.value;
      else target.setAttribute("value", field.value);
      if (field.checked) target.setAttribute("checked", "");
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function imageToDataUrl(image) {
    var canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    var context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function inlineImages(source, clone) {
    var sourceImages = Array.from(source.querySelectorAll("img"));
    var cloneImages = Array.from(clone.querySelectorAll("img"));
    await Promise.all(
      sourceImages.map(async function (image, index) {
        var target = cloneImages[index];
        var url = image.currentSrc || image.src;
        if (!target || !url) return;
        if (target.hasAttribute("data-maru-logo") && global.MARU_LOGO_DATA) {
          target.setAttribute("src", global.MARU_LOGO_DATA);
          return;
        }
        if (url.indexOf("data:") === 0) {
          target.setAttribute("src", url);
          return;
        }
        try {
          if (global.location && global.location.protocol === "file:") throw new Error("로컬 파일은 직접 가져오지 않습니다.");
          var response = await fetch(url);
          if (!response.ok) throw new Error("이미지 파일을 읽지 못했습니다.");
          target.setAttribute("src", await blobToDataUrl(await response.blob()));
        } catch (_error) {
          if (image.complete && image.naturalWidth) {
            try {
              target.setAttribute("src", imageToDataUrl(image));
            } catch (_canvasError) {
              target.removeAttribute("src");
              target.setAttribute("alt", "");
            }
          }
        }
      }),
    );
  }

  async function nodeToSvg(node, options) {
    var width = options.width;
    var height = options.height;
    var clone = node.cloneNode(true);
    copyFormValues(node, clone);
    await inlineImages(node, clone);
    clone.style.width = width + "px";
    clone.style.height = height + "px";
    clone.style.transform = "none";
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    var serialized = new XMLSerializer().serializeToString(clone);
    var css = collectCss();
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      width +
      '" height="' +
      height +
      '" viewBox="0 0 ' +
      width +
      " " +
      height +
      '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%"><style>' +
      escapeXml(css) +
      "</style>" +
      serialized +
      "</div></foreignObject></svg>"
    );
  }

  function renderCanvas(node, options) {
    options = Object.assign({ width: node.offsetWidth, height: node.offsetHeight, scale: 1 }, options);
    return nodeToSvg(node, options).then(function (svg) {
      // Some hosted pages disallow blob: image sources through their CSP.  An
      // encoded data URL keeps the whole render self-contained and works on
      // static hosting as well as file:// pages.
      var url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

      return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = options.width * options.scale;
            canvas.height = options.height * options.scale;
            var context = canvas.getContext("2d");
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve(canvas);
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = function () {
          reject(new Error("미리보기를 이미지로 변환하지 못했습니다."));
        };
        image.src = url;
      });
    });
  }

  function render(node, options) {
    return renderCanvas(node, options).then(function (canvas) {
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (pngBlob) {
          if (pngBlob) resolve(pngBlob);
          else reject(new Error("이미지를 만들지 못했습니다."));
        }, "image/png", 1);
      });
    });
  }

  function renderDataUrl(node, options) {
    return renderCanvas(node, options).then(function (canvas) {
      return canvas.toDataURL("image/png", 1);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var mimeMatch = parts[0].match(/data:([^;]+)/);
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeMatch ? mimeMatch[1] : "image/png" });
  }

  function download(file, filename) {
    var isDataUrl = typeof file === "string" && file.indexOf("data:") === 0;
    var url = isDataUrl ? file : URL.createObjectURL(file);
    var link = document.createElement("a");
    link.download = filename;
    link.href = url;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    if (!isDataUrl) {
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
    }
  }

  global.DomExport = {
    render: render,
    renderDataUrl: renderDataUrl,
    dataUrlToBlob: dataUrlToBlob,
    download: download,
  };
})(window);
