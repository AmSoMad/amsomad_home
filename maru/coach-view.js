(function () {
  "use strict";
  const cleanName = (value) => String(value || "").trim().slice(0, 18);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const fallback = (state) => cleanName(state.coachName) || cleanName(state.coaches?.[0]) || "쌍둥이 코치님";
  const owner = (state, definition) => cleanName(definition.coachName) || fallback(state);
  function names(state) {
    return [...new Set([
      ...(Array.isArray(state.coaches) ? state.coaches : []).map(cleanName),
      fallback(state),
      ...(state.scheduleDefinitions || []).map((definition) => owner(state, definition)),
    ].filter(Boolean))];
  }
  const resolve = (state, requested) => names(state).includes(requested) ? requested : fallback(state);
  // A view only: callers must always save the complete, unfiltered monthly state.
  function forCoach(state, requested) {
    const name = resolve(state, requested);
    const definitions = state.scheduleDefinitions.filter((definition) => owner(state, definition) === name);
    return { ...state, coachName: name, scheduleDefinitions: definitions,
      schedules: Object.fromEntries(definitions.map((definition) => [definition.key, state.schedules[definition.key]])) };
  }
  function bindTabs(onSelect) {
    const container = document.getElementById("coachTabs");
    let currentNames = [];
    let disabled = false;
    function choose(index, keyboard = false) {
      if (disabled || !currentNames[index]) return;
      onSelect(currentNames[index]);
      const button = container.querySelector(`[data-coach-index="${index}"]`);
      button?.focus({ preventScroll: true });
      if (keyboard) button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    container.addEventListener("click", (event) => {
      const button = event.target.closest("[data-coach-index]");
      if (button) choose(Number(button.dataset.coachIndex));
    });
    container.addEventListener("keydown", (event) => {
      const button = event.target.closest("[data-coach-index]");
      if (!button || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let index = Number(button.dataset.coachIndex);
      if (event.key === "Home") index = 0;
      else if (event.key === "End") index = currentNames.length - 1;
      else index = (index + (event.key === "ArrowRight" ? 1 : -1) + currentNames.length) % currentNames.length;
      choose(index, true);
    });
    return {
      render(state, active, options = {}) {
        disabled = Boolean(options.disabled);
        currentNames = state ? names(state) : [];
        document.getElementById("coachTabsPanel").hidden = !state || Boolean(options.hidden);
        document.getElementById("coachCount").textContent = `${currentNames.length}명`;
        document.getElementById("coachSwipeHint").hidden = currentNames.length <= 1;
        container.innerHTML = currentNames.map((name, index) => {
          const count = state.scheduleDefinitions.filter((definition) => owner(state, definition) === name && (!options.publicOnly || state.schedules[definition.key]?.enabled)).length;
          return `<button type="button" role="tab" id="coach-tab-${index}" data-coach-index="${index}" aria-controls="top" aria-selected="${name === active}" tabindex="${name === active ? 0 : -1}" ${disabled ? "disabled" : ""}><span class="coach-tab-avatar" aria-hidden="true">${escapeHtml(name.slice(0, 1))}</span><span class="coach-tab-name">${escapeHtml(name)}</span><span class="coach-tab-count" aria-label="레슨 ${count}개">${count}</span></button>`;
        }).join("");
        // Keep the selected tab visible without moving the page away from its calendar.
        const selectedTab = container.querySelector('[aria-selected="true"]');
        if (selectedTab) {
          const bounds = container.getBoundingClientRect();
          const selected = selectedTab.getBoundingClientRect();
          if (selected.left < bounds.left) container.scrollLeft += selected.left - bounds.left - 3;
          else if (selected.right > bounds.right) container.scrollLeft += selected.right - bounds.right + 3;
        }
        const panel = document.getElementById("top");
        if (state) {
          panel.setAttribute("role", "tabpanel");
          panel.setAttribute("aria-labelledby", `coach-tab-${currentNames.indexOf(active)}`);
          panel.setAttribute("tabindex", "0");
        }
        document.getElementById("coachTabHint").textContent = options.publicOnly
          ? "코치를 선택해 레슨을 확인하세요. 이미지와 공유 링크도 선택한 코치 기준입니다."
          : "선택한 코치의 레슨을 편집합니다. 작업 저장·확정은 이 달의 모든 코치에게 함께 적용됩니다.";
      },
    };
  }
  const filename = (name) => cleanName(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  window.MaruCoaches = Object.freeze({ cleanName, owner, names, resolve, forCoach, bindTabs, filename });
})();
