(function () {
  "use strict";
  const calendar = window.MaruCalendar;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let editMode = params.get("edit") === "1";
  const validMonth = (value) => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value || "");
  const originalState = calendar.getState();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let month = validMonth(params.get("month")) ? params.get("month") : (editMode ? originalState.targetMonth : currentMonth);
  let identity = null;
  let service;
  let busy = false;
  let revision = null;
  let dirty = false;
  let hasPublic = false;
  let publicMonths = [];
  let subscribed = false;
  let operation = 0;
  let active = false;
  let lastSnapshot = "";
  let storage;
  try { storage = window.localStorage; } catch (_) { storage = { getItem: () => null, setItem: () => { throw new Error("storage"); } }; }
  const drafts = window.MaruDraftStore.createStore(storage);
  let hasLegacy = false;
  try { hasLegacy = Boolean(storage.getItem("cockcock-lesson-calendar-v1")); } catch (_) { /* unavailable */ }
  if (hasLegacy && !drafts.read(originalState.targetMonth)) {
    drafts.write(originalState.targetMonth, { state: originalState, revision: null, dirty: true });
  }

  function status(message, error = false) {
    $("cloudStatus").textContent = message;
    $("cloudStatus").classList.toggle("is-error", error);
  }

  function setBusy(value) { busy = value; syncUi(); }

  function shareUrl() {
    const url = new URL("https://amsomad.com/maru/");
    url.searchParams.set("month", month);
    return url.href;
  }

  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set("month", month);
    if (editMode) url.searchParams.set("edit", "1"); else url.searchParams.delete("edit");
    try { history.replaceState(null, "", url); } catch (_) { /* file:// */ }
    $("shareLink").value = shareUrl();
  }

  function syncUi() {
    document.body.dataset.mode = editMode ? "edit" : "public";
    document.body.dataset.publicReady = String(hasPublic);
    $("cloudTitle").textContent = editMode ? "월별 일정 관리" : "확정 레슨 일정";
    $("cloudMonth").value = month;
    $("cloudMonth").disabled = busy;
    $("publishedMonths").disabled = busy;
    $("modeButton").textContent = editMode ? "공개 일정 보기" : "관리자 편집";
    $("modeButton").disabled = busy;
    $("refreshCloudButton").disabled = busy;
    $("authArea").hidden = !editMode;
    $("loginForm").hidden = Boolean(identity?.admin);
    $("signedInArea").hidden = !identity?.admin;
    $("signedInEmail").textContent = identity?.user?.email || "";
    $("loginButton").disabled = busy;
    $("logoutButton").disabled = busy;
    $("saveDraftButton").disabled = busy || !identity?.admin || Boolean(calendar.getState().confirmedAt);
    $("loadDraftButton").disabled = busy || !identity?.admin;
    $("restoreLocalButton").disabled = busy || !drafts.read(month)?.backup;
    $("localBackupButton").disabled = busy;
    $("adminCloudActions").hidden = !editMode;
    $("publicEmpty").hidden = editMode || hasPublic;
    calendar.setAccess({ readOnly: !editMode, busy });
    for (const id of ["downloadButton", "downloadPreviewButton", "shareButton"]) {
      $(id).disabled = busy || (!editMode && !hasPublic);
    }
    $("confirmScheduleButton").textContent = calendar.getState().confirmedAt ? "수정하기" : "확정 · 공개하기";
    if (editMode && !calendar.getState().confirmedAt) {
      $("confirmDescription").textContent = identity?.admin
        ? "작업 저장은 관리자만 볼 수 있어요. 확정하면 방문자에게 공개됩니다."
        : "현재 내용은 이 기기에 저장됩니다. 로그인 후 확정하면 공개할 수 있어요.";
    }
    if (!editMode && hasPublic) {
      $("posterStatusBadge").textContent = "✓ 공개된 확정 일정";
    }
    $("savedState").textContent = editMode
      ? (dirty ? "이 기기 작업본 · 서버 저장 전" : revision > 0 ? "서버에서 불러온 일정" : "이 기기 작업본")
      : "공개된 확정 일정";
    $("preview-title").textContent = editMode ? "공유 이미지 미리보기" : "확정 레슨 일정";
    document.querySelector(".preview-hint").textContent = editMode
      ? "확정 전에는 미리보기 날짜도 수정할 수 있어요. 저장 이미지는 세로형입니다."
      : "아래로 내려 전체 일정을 확인하세요. PNG 저장 또는 링크로 공유할 수 있어요.";
    updateUrl();
  }

  function remember(value = calendar.getState()) {
    if (!editMode || !active) return;
    const old = drafts.read(month);
    const saved = drafts.write(month, { state: value, revision, dirty, backup: old?.backup || null });
    if (!saved) status("이 브라우저에서는 기기 저장을 사용할 수 없어요. 작업본 백업이나 서버 저장을 이용해주세요.", true);
  }

  function apply(value) {
    calendar.applyState(value);
    lastSnapshot = JSON.stringify(calendar.getState());
  }

  function showLocal(target) {
    const local = drafts.read(target);
    let value = local?.state || calendar.newMonth(target);
    try { apply(value); } catch (_) { value = calendar.newMonth(target); apply(value); }
    month = target;
    revision = local?.revision ?? null;
    dirty = local?.dirty ?? false;
    active = true;
    remember();
    syncUi();
  }

  async function connect() {
    if (!service) service = await window.MaruCloud.connect();
    if (!subscribed) {
      subscribed = true;
      service.onSignOut(() => {
        identity = null;
        syncUi();
        if (editMode) status("로그아웃되었습니다. 작업본은 이 기기에 보관됩니다.");
      });
    }
    return service;
  }

  async function refreshMonths() {
    publicMonths = await (await connect()).listPublished();
    $("publishedMonths").replaceChildren(new Option("확정된 월 선택", ""));
    publicMonths.forEach((item) => {
      const value = item.month.slice(0, 7);
      $("publishedMonths").add(new Option(value.replace("-", "년 ") + "월", value));
    });
  }

  async function loadPublic(target, useLatest = false) {
    const ticket = ++operation;
    active = false;
    hasPublic = false;
    month = target;
    setBusy(true);
    status("공개 일정을 불러오는 중…");
    $("publicEmpty").textContent = "확정 일정을 불러오고 있어요.";
    try {
      await refreshMonths();
      if (ticket !== operation) return;
      if (useLatest && publicMonths.length && !publicMonths.some((item) => item.month.startsWith(target))) {
        month = publicMonths[0].month.slice(0, 7);
      }
      const record = await (await connect()).published(month);
      if (ticket !== operation) return;
      if (record) {
        if (!record.confirmed_at || record.data?.targetMonth !== month) throw new Error("공개 일정 데이터가 올바르지 않습니다.");
        apply({ ...record.data, confirmedAt: record.confirmed_at });
        hasPublic = true;
        status(`${month.replace("-", "년 ")}월 · 마지막 확정 ${new Date(record.confirmed_at).toLocaleString("ko-KR")}`);
      } else {
        status("이 달에는 아직 공개된 확정 일정이 없어요.");
        $("publicEmpty").textContent = "아직 확정된 일정이 없습니다. 다른 달을 선택하거나 나중에 다시 확인해주세요.";
      }
    } catch (error) {
      if (ticket !== operation) return;
      status(window.MaruCloud.errorMessage(error), true);
      $("publicEmpty").textContent = "일정을 불러오지 못했습니다. 위 안내를 확인하고 새로고침해주세요.";
    } finally { if (ticket === operation) setBusy(false); }
  }

  async function loadDraft(explicit = false) {
    if (!identity?.admin) return;
    if (explicit && dirty && !window.confirm("현재 작업본을 백업한 뒤 서버 일정을 불러올까요?")) return;
    setBusy(true);
    status("서버 작업본을 확인하는 중…");
    try {
      const record = await (await connect()).draft(month);
      const local = drafts.read(month);
      if (!record) {
        revision = 0;
        remember();
        status("이 달의 서버 저장본은 아직 없어요. 작성 후 작업 저장 또는 확정해주세요.");
      } else if (!explicit && dirty) {
        // An unbased local draft must never acquire a remote revision silently.
        status(revision === record.revision
          ? "이 기기의 미저장 작업을 이어서 편집하고 있어요."
          : "서버에도 이 달의 일정이 있어요. 작업본을 백업하고 '서버 일정 불러오기'로 확인해주세요.");
      } else {
        if (local?.state && JSON.stringify(local.state) !== JSON.stringify(record.data)) {
          drafts.write(month, { ...local, backup: local.state });
        }
        apply(record.data);
        revision = record.revision;
        dirty = false;
        remember();
        status("서버에 저장된 일정을 불러왔어요.");
      }
    } catch (error) { status(window.MaruCloud.errorMessage(error), true); }
    finally { setBusy(false); }
  }

  async function selectMonth(target) {
    if (busy || !validMonth(target)) { syncUi(); return; }
    if (!editMode) { await loadPublic(target); return; }
    remember();
    showLocal(target);
    if (identity?.admin) await loadDraft();
    else status("이 기기 작업본을 열었어요. 로그인하면 서버에 저장할 수 있어요.");
  }

  async function save(publish = false) {
    if (busy || !editMode) return;
    if (!identity?.admin) {
      status("등록된 관리자 계정으로 로그인한 뒤 저장해주세요.", true);
      $("authDetails").open = true;
      $("loginEmail").focus();
      return;
    }
    setBusy(true);
    status(publish ? "일정을 확정하고 공개하는 중…" : "서버에 작업본을 저장하는 중…");
    try {
      if (revision === null) {
        const existing = await (await connect()).draft(month);
        if (existing) throw new Error("서버에 이 달의 저장본이 있어요. 작업본을 백업하고 서버 일정을 먼저 불러와주세요.");
        revision = 0;
      }
      const result = await (await connect()).save(calendar.getState(), revision, publish);
      apply(result.data);
      revision = result.revision;
      dirty = false;
      remember();
      status(publish ? "확정 일정이 공개되었습니다. 공유 링크에서 누구나 확인할 수 있어요." : "서버에 작업본을 저장했어요. 공개 일정은 확정할 때 갱신됩니다.");
      calendar.showToast(publish ? "일정을 확정하고 공개했어요." : "서버에 작업본을 저장했어요.");
      // Listing failure must not change the result of a successful save.
      if (publish) void refreshMonths().catch(() => {});
    } catch (error) {
      remember();
      status(window.MaruCloud.errorMessage(error), true);
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !editMode) return;
    const state = calendar.getState();
    if (state.confirmedAt) {
      apply({ ...state, confirmedAt: null });
      dirty = true;
      remember();
      syncUi();
      status("수정을 시작했어요. 방문자에게는 마지막 확정본이 계속 표시됩니다.");
    } else await save(true);
  }

  window.MaruCloudUI = { selectMonth, confirm };
  window.addEventListener("maru:change", (event) => {
    if (!editMode || !active) return;
    const snapshot = JSON.stringify(event.detail);
    if (snapshot !== lastSnapshot) {
      dirty = true;
      lastSnapshot = snapshot;
      remember(event.detail);
      syncUi();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (busy) { event.preventDefault(); event.returnValue = ""; }
  });

  $("cloudMonth").addEventListener("change", (event) => void selectMonth(event.target.value));
  $("publishedMonths").addEventListener("change", (event) => { if (event.target.value) void selectMonth(event.target.value); });
  $("saveDraftButton").addEventListener("click", () => void save());
  $("loadDraftButton").addEventListener("click", () => void loadDraft(true));
  $("modeButton").addEventListener("click", async () => {
    if (busy) return;
    if (editMode) remember();
    editMode = !editMode;
    if (editMode) {
      showLocal(month);
      await initialize();
    } else await loadPublic(month);
  });
  $("refreshCloudButton").addEventListener("click", async () => {
    if (!editMode) await loadPublic(month);
    else if (identity?.admin) await loadDraft(true);
    else await initialize();
  });
  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    status("관리자 계정을 확인하는 중…");
    try {
      identity = await (await connect()).login($("loginEmail").value, $("loginPassword").value);
      if (!identity?.admin) {
        await service.logout();
        identity = null;
        throw new Error("이 계정에는 관리자 권한이 없습니다.");
      }
      status("관리자로 로그인했어요.");
    } catch (error) { identity = null; status(window.MaruCloud.errorMessage(error), true); }
    finally { $("loginPassword").value = ""; setBusy(false); }
    if (identity?.admin) await loadDraft();
  });
  $("logoutButton").addEventListener("click", async () => {
    if (busy) return;
    remember();
    setBusy(true);
    try {
      await (await connect()).logout();
      identity = null;
      editMode = false;
    } catch (error) { status(window.MaruCloud.errorMessage(error), true); }
    finally { setBusy(false); }
    if (!editMode) await loadPublic(month);
  });
  $("copyPublicLinkButton").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(shareUrl()); calendar.showToast("공개 일정 링크를 복사했어요."); }
    catch (_) { $("shareLink").focus(); $("shareLink").select(); calendar.showToast("선택된 주소를 복사해주세요."); }
  });
  $("localBackupButton").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(calendar.getState(), null, 2)], { type: "application/json" });
    window.DomExport.download(blob, `${month}-레슨-작업본.json`);
  });
  $("restoreLocalButton").addEventListener("click", () => {
    if (busy) return;
    const record = drafts.read(month);
    if (!record?.backup || !window.confirm("백업된 작업본을 불러올까요? 현재 내용도 백업으로 보관됩니다.")) return;
    const previous = calendar.getState();
    apply({ ...record.backup, confirmedAt: null });
    drafts.write(month, { ...record, backup: previous });
    dirty = true;
    remember();
    syncUi();
    status("백업한 작업본을 불러왔어요. 날짜를 확인한 뒤 저장해주세요.");
  });

  async function initialize() {
    if (editMode) {
      if (!active) showLocal(month);
      setBusy(true);
      status("로그인 상태를 확인하는 중…");
      try {
        identity = await (await connect()).identity();
        await refreshMonths();
        status(identity?.admin ? "관리자로 연결되었어요." : "이 기기에서 작성 중입니다. 로그인 후 서버에 저장할 수 있어요.");
      } catch (error) { status(window.MaruCloud.errorMessage(error), true); }
      finally { setBusy(false); }
      if (identity?.admin) await loadDraft();
    } else {
      await loadPublic(month, !validMonth(params.get("month")));
    }
  }
  syncUi();
  void initialize();
})();
