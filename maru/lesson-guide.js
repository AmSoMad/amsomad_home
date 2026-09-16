(() => {
  "use strict";
  document.querySelectorAll("[data-maru-logo]").forEach((image) => {
    if (window.MARU_LOGO_DATA) image.src = window.MARU_LOGO_DATA;
  });

  const channel = document.getElementById("lessonChannelLink");
  try {
    const url = new URL(window.MARU_LESSON_GUIDE?.channelUrl || "");
    if (url.protocol === "https:" && !url.username && !url.password) {
      channel.href = url.href;
      channel.hidden = false;
    }
  } catch { /* No channel URL yet: keep the contact text, not a broken button. */ }

  const dialog = document.getElementById("lessonPaymentDialog");
  const openButton = document.getElementById("lessonAccountButton");
  const accountField = document.getElementById("lessonAccountCopy");
  const status = document.getElementById("lessonCopyStatus");
  // The visible account is the source of truth, not a separate hidden payment URL.
  accountField.value = document.getElementById("lessonAccountNumber").textContent.trim();
  let copyAttempt = 0;

  async function copyAccount() {
    const attempt = ++copyAttempt;
    const digits = accountField.value.replace(/\D/g, "");
    delete status.dataset.state;
    status.textContent = "계좌번호를 복사하고 있어요…";
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(digits);
        copied = true;
      }
    } catch { /* file:// and restricted in-app browsers may deny clipboard access. */ }
    if (attempt !== copyAttempt || !dialog.open) return;
    if (!copied) {
      // The input stays visible inside the modal, so manual selection also works.
      const previousFocus = document.activeElement;
      accountField.value = digits;
      accountField.focus({ preventScroll: true });
      accountField.select();
      accountField.setSelectionRange(0, digits.length);
      try { copied = document.execCommand("copy"); } catch { /* Manual fallback below. */ }
      if (copied) previousFocus?.focus({ preventScroll: true });
    }
    status.textContent = copied
      ? "계좌번호가 복사됐어요. 은행 앱에 붙여넣어주세요."
      : "자동 복사가 제한됐어요. 위 계좌번호를 길게 누르거나 Ctrl+C로 복사해주세요.";
    status.dataset.state = copied ? "success" : "manual";
  }

  openButton.addEventListener("click", () => {
    if (dialog.open) return;
    dialog.showModal();
    document.body.classList.add("lesson-dialog-open");
    void copyAccount();
  });
  document.getElementById("lessonCopyAccountButton").addEventListener("click", copyAccount);
  document.getElementById("lessonPaymentClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  });
  dialog.addEventListener("close", () => {
    copyAttempt++;
    document.body.classList.remove("lesson-dialog-open");
    openButton.focus({ preventScroll: true });
  });
  // Bank navigation remains a normal, explicit link. No timer, guessed URL
  // scheme, installation detection, account prefill or automatic transfer.
})();
