(function (global) {
  "use strict";

  let sdkPromise;
  function loadSdk(url) {
    if (global.supabase?.createClient) return Promise.resolve(global.supabase);
    if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => fail(), 15000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        sdkPromise = null;
        reject(new Error("로그인 모듈을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요."));
      }
      script.src = url;
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        clearTimeout(timer);
        if (!global.supabase?.createClient) return fail();
        resolve(global.supabase);
      };
      document.head.appendChild(script);
    });
    return sdkPromise;
  }

  function errorMessage(error) {
    const message = String(error?.message || "");
    if (/MARU_REVISION_CONFLICT/.test(message)) return "다른 기기에서 이 달의 일정이 변경됐어요. 현재 작성본은 이 기기에 남겨두었습니다. 서버 일정을 불러와 확인해주세요.";
    if (/MARU_ADMIN_REQUIRED/.test(message) || error?.code === "42501") return "저장 권한이 없어요. 등록된 관리자 계정으로 로그인해주세요.";
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(error?.code)) return "서버 초기 설정이 필요해요. Supabase SQL Editor에서 setup.sql을 실행해주세요.";
    if (/Invalid login credentials/i.test(message)) return "이메일 또는 비밀번호가 맞지 않아요. Supabase에 관리자 사용자를 생성했는지 확인해주세요.";
    if (/Email not confirmed/i.test(message)) return "이메일 확인이 필요해요. Supabase에서 관리자 계정의 이메일 확인 상태를 확인해주세요.";
    if (/fetch|network|timeout|abort|Failed to load/i.test(message)) return "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.";
    return message || "요청을 완료하지 못했어요. 잠시 후 다시 시도해주세요.";
  }

  function createService(client) {
    const unwrap = async (request) => {
      const { data, error } = await request;
      if (error) throw error;
      return data;
    };
    return {
      async identity() {
        const session = await unwrap(client.auth.getSession());
        if (!session?.session) return null;
        const result = await unwrap(client.auth.getUser());
        if (!result?.user) return null;
        const admin = await unwrap(client.rpc("maru_is_admin"));
        return { user: result.user, admin: admin === true };
      },
      async login(email, password) {
        await unwrap(client.auth.signInWithPassword({ email: email.trim(), password }));
        return this.identity();
      },
      async logout() { await unwrap(client.auth.signOut({ scope: "local" })); },
      onSignOut(callback) {
        return client.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") setTimeout(callback, 0);
        });
      },
      listPublished() {
        return unwrap(client.from("maru_published").select("month,revision,confirmed_at").order("month", { ascending: false }));
      },
      published(month) {
        return unwrap(client.from("maru_published").select("month,data,revision,confirmed_at").eq("month", `${month}-01`).maybeSingle());
      },
      draft(month) {
        return unwrap(client.from("maru_drafts").select("month,data,revision,updated_at").eq("month", `${month}-01`).maybeSingle());
      },
      save(state, revision, publish = false) {
        return unwrap(client.rpc("maru_save_schedule", {
          p_month: state.targetMonth, p_data: state,
          p_expected_revision: revision, p_publish: publish,
        }));
      },
    };
  }

  let servicePromise;
  async function connect() {
    if (!servicePromise) {
      servicePromise = (async () => {
        const config = global.MARU_SUPABASE;
        if (!config?.url || !config?.publishableKey) throw new Error("Supabase 연결 정보가 없습니다.");
        const sdk = await loadSdk(config.sdkUrl);
        const client = sdk.createClient(config.url, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          global: {
            fetch: async (input, init = {}) => {
              const controller = new AbortController();
              const abort = () => controller.abort();
              if (init.signal?.aborted) abort();
              init.signal?.addEventListener("abort", abort, { once: true });
              const timer = setTimeout(abort, 15000);
              try { return await global.fetch(input, { ...init, signal: controller.signal }); }
              finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
            },
          },
        });
        return createService(client);
      })().catch((error) => { servicePromise = null; throw error; });
    }
    return servicePromise;
  }

  const api = { connect, createService, errorMessage };
  global.MaruCloud = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
