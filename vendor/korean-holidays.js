(function (global, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  global.KoreanHolidays = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var cache = new Map();

  function isoDate(year, month, day) {
    return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
  }

  function dateFromIso(value) {
    var parts = value.split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 3));
  }

  function shiftIso(value, amount) {
    var date = dateFromIso(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  function weekday(value) {
    return dateFromIso(value).getUTCDay();
  }

  function lunarAnchors(year) {
    var formatter;
    try {
      formatter = new Intl.DateTimeFormat("ko-KR-u-ca-dangi", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
      });
      if (formatter.resolvedOptions().calendar !== "dangi") throw new Error("단기력 미지원");
    } catch (_error) {
      return null;
    }

    var anchors = {};
    var cursor = new Date(Date.UTC(year, 0, 1, 3));
    var end = new Date(Date.UTC(year + 1, 0, 1, 3));
    while (cursor < end) {
      var parts = formatter.formatToParts(cursor);
      var monthPart = parts.find(function (part) {
        return part.type === "month";
      });
      var dayPart = parts.find(function (part) {
        return part.type === "day";
      });
      var lunarMonth = monthPart ? Number(monthPart.value) : NaN;
      var lunarDay = dayPart ? Number(dayPart.value) : NaN;
      var isLeapMonth = monthPart && /윤|bis|leap/i.test(monthPart.value);
      var solar = isoDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate());

      if (!isLeapMonth && lunarMonth === 1 && lunarDay === 1) anchors.newYear = solar;
      if (!isLeapMonth && lunarMonth === 4 && lunarDay === 8) anchors.buddha = solar;
      if (!isLeapMonth && lunarMonth === 8 && lunarDay === 15) anchors.chuseok = solar;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return anchors;
  }

  function buildYear(year) {
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return [];
    if (cache.has(year)) return cache.get(year).map(function (holiday) { return Object.assign({}, holiday); });

    var base = new Map();
    var events = [];

    function addBase(date, name) {
      var existing = base.get(date);
      if (existing) {
        existing.names.push(name);
        existing.name = existing.names.join(" · ");
      } else {
        base.set(date, { date: date, name: name, names: [name], isSubstitute: false });
      }
    }

    function addEvent(label, dates, weekendMode, eligible) {
      dates.forEach(function (entry) {
        addBase(entry.date, entry.name);
      });
      events.push({ label: label, dates: dates.map(function (entry) { return entry.date; }), weekendMode: weekendMode, eligible: eligible !== false });
    }

    addEvent("신정", [{ date: isoDate(year, 1, 1), name: "신정" }], "none", false);
    addEvent("삼일절", [{ date: isoDate(year, 3, 1), name: "삼일절" }], "sat-sun");
    if (year >= 2026) addEvent("노동절", [{ date: isoDate(year, 5, 1), name: "노동절" }], "sat-sun");
    addEvent("어린이날", [{ date: isoDate(year, 5, 5), name: "어린이날" }], "sat-sun");
    addEvent("현충일", [{ date: isoDate(year, 6, 6), name: "현충일" }], "none", false);
    if (year >= 2026) addEvent("제헌절", [{ date: isoDate(year, 7, 17), name: "제헌절" }], "sat-sun");
    addEvent("광복절", [{ date: isoDate(year, 8, 15), name: "광복절" }], "sat-sun");
    addEvent("개천절", [{ date: isoDate(year, 10, 3), name: "개천절" }], "sat-sun");
    addEvent("한글날", [{ date: isoDate(year, 10, 9), name: "한글날" }], "sat-sun");
    addEvent("기독탄신일", [{ date: isoDate(year, 12, 25), name: "기독탄신일" }], year >= 2023 ? "sat-sun" : "none", year >= 2023);

    var lunar = lunarAnchors(year);
    if (lunar && lunar.newYear) {
      addEvent(
        "설날",
        [
          { date: shiftIso(lunar.newYear, -1), name: "설날 전날" },
          { date: lunar.newYear, name: "설날" },
          { date: shiftIso(lunar.newYear, 1), name: "설날 다음 날" },
        ],
        "sun",
      );
    }
    if (lunar && lunar.buddha) {
      addEvent("부처님오신날", [{ date: lunar.buddha, name: "부처님오신날" }], year >= 2023 ? "sat-sun" : "none", year >= 2023);
    }
    if (lunar && lunar.chuseok) {
      addEvent(
        "추석",
        [
          { date: shiftIso(lunar.chuseok, -1), name: "추석 전날" },
          { date: lunar.chuseok, name: "추석" },
          { date: shiftIso(lunar.chuseok, 1), name: "추석 다음 날" },
        ],
        "sun",
      );
    }

    function firstAvailableAfter(date) {
      var candidate = shiftIso(date, 1);
      while (weekday(candidate) === 0 || weekday(candidate) === 6 || base.has(candidate)) {
        candidate = shiftIso(candidate, 1);
      }
      return candidate;
    }

    events.forEach(function (event) {
      if (!event.eligible || event.weekendMode === "none") return;
      var overlaps = event.dates.some(function (date) {
        return (base.get(date) || { names: [] }).names.length > 1;
      });
      var weekendCollision = event.dates.some(function (date) {
        var day = weekday(date);
        return event.weekendMode === "sun" ? day === 0 : day === 0 || day === 6;
      });
      if (!overlaps && !weekendCollision) return;

      var sortedDates = event.dates.slice().sort();
      var lastDate = sortedDates[sortedDates.length - 1];
      var substitute = firstAvailableAfter(lastDate);
      addBase(substitute, event.label + " 대체공휴일");
      base.get(substitute).isSubstitute = true;
    });

    var holidays = Array.from(base.values())
      .filter(function (holiday) {
        return Number(holiday.date.slice(0, 4)) === year;
      })
      .sort(function (a, b) {
        return a.date.localeCompare(b.date);
      })
      .map(function (holiday) {
        return { date: holiday.date, name: holiday.name, isSubstitute: holiday.isSubstitute };
      });

    cache.set(year, holidays);
    return holidays.map(function (holiday) { return Object.assign({}, holiday); });
  }

  function forMonth(year, month) {
    var prefix = year + "-" + String(month).padStart(2, "0") + "-";
    return buildYear(year)
      .filter(function (holiday) {
        return holiday.date.indexOf(prefix) === 0;
      })
      .map(function (holiday) {
        return Object.assign({ day: Number(holiday.date.slice(8, 10)) }, holiday);
      });
  }

  return { forYear: buildYear, forMonth: forMonth };
});
