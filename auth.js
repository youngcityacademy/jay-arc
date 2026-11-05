"use strict";

(function () {
  const config = window.JAY_ARC_SUPABASE_CONFIG || {};
  const authViews = ["login", "signup", "forgot", "reset"];
  const REMEMBER_ME_KEY = "jayArcRememberMe";
  const MIGRATION_ACCOUNT_KEY = "jayArcMigrationAccount";
  let client = null;
  let current = null;
  let authView = "login";
  let rememberMePreference = true;
  let supabaseStorageKey = null;
  let passwordRecovery = location.hash.includes("reset-password") ||
    new URLSearchParams(location.hash.slice(1)).get("type") === "recovery" ||
    new URLSearchParams(location.search).get("type") === "recovery";

  function $(id) {
    return document.getElementById(id);
  }

  function setMessage(message, isError = false) {
    const element = $("authMessage");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", isError);
    element.hidden = !message;
  }

  function errorMessage(error) {
    return error?.message || "An unexpected error occurred. Please try again.";
  }

  function showView(view) {
    authView = authViews.includes(view) ? view : "login";
    for (const name of authViews) {
      const form = $(`${name}Form`);
      if (form) form.hidden = name !== authView;
    }
    const reset = authView === "reset";
    const recovery = authView === "forgot" || reset;
    $("authTitle").textContent = reset ? "Choose a new password."
      : authView === "signup" ? "Start building your arc."
        : authView === "forgot" ? "Reset your password."
          : "Welcome back.";
    $("authDescription").textContent = reset ? "Use a strong password you have not used before."
      : authView === "signup" ? "Create your private JAY ARC account."
        : authView === "forgot" ? "We’ll email you a secure password reset link."
          : "Sign in to continue building your arc.";
    $("authSwitch").hidden = recovery;
    $("authSwitch").querySelector("span").textContent =
      authView === "signup" ? "Already have an account?" : "New to JAY ARC?";
    const switchButton = $("authSwitch").querySelector("button");
    switchButton.textContent = authView === "signup" ? "Sign in" : "Create an account";
    switchButton.dataset.authView = authView === "signup" ? "login" : "signup";
    $("authBack").hidden = !recovery;
    setMessage("");
  }

  function setBusy(form, busy, label) {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
    } else {
      button.textContent = button.dataset.originalLabel || label;
    }
    button.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
  }

  function makeStorageAdapter() {
    const persistent = window.localStorage;
    const temporary = window.sessionStorage;
    return {
      getItem(key) {
        return (rememberMePreference ? persistent : temporary).getItem(key);
      },
      setItem(key, value) {
        if (rememberMePreference) {
          persistent.setItem(key, value);
          temporary.removeItem(key);
        } else {
          temporary.setItem(key, value);
          persistent.removeItem(key);
        }
      },
      removeItem(key) {
        persistent.removeItem(key);
        temporary.removeItem(key);
      }
    };
  }

  function moveAuthStorage(remember) {
    if (!supabaseStorageKey) return;
    const source = remember ? window.sessionStorage : window.localStorage;
    const destination = remember ? window.localStorage : window.sessionStorage;
    for (const key of [supabaseStorageKey, `${supabaseStorageKey}-code-verifier`]) {
      const value = source.getItem(key);
      if (value !== null && destination.getItem(key) === null) {
        destination.setItem(key, value);
      }
      source.removeItem(key);
    }
  }

  function initializeRememberMe() {
    const rememberMe = $("rememberMe");
    const savedPreference = localStorage.getItem(REMEMBER_ME_KEY);
    rememberMePreference = savedPreference === null
      ? rememberMe.checked
      : savedPreference === "true";
    rememberMe.checked = rememberMePreference;
    supabaseStorageKey = `sb-${new URL(config.url).hostname.split(".")[0]}-auth-token`;
    moveAuthStorage(rememberMePreference);
    if (savedPreference === null) {
      localStorage.setItem(REMEMBER_ME_KEY, String(rememberMePreference));
    }

    rememberMe.addEventListener("change", () => {
      const previousPreference = rememberMePreference;
      const nextPreference = rememberMe.checked;
      try {
        moveAuthStorage(nextPreference);
        localStorage.setItem(REMEMBER_ME_KEY, String(nextPreference));
        rememberMePreference = nextPreference;
        setMessage("");
      } catch (error) {
        rememberMe.checked = previousPreference;
        rememberMePreference = previousPreference;
        try {
          moveAuthStorage(previousPreference);
          localStorage.setItem(REMEMBER_ME_KEY, String(previousPreference));
        } catch (restoreError) {
          setMessage(`The sign-in storage preference could not be changed or restored: ${restoreError.message}`, true);
          return;
        }
        setMessage(`The sign-in storage preference could not be changed: ${error.message}`, true);
      }
    });
  }

  function setAuthenticatedShell(isAuthenticated) {
    $("authScreen").hidden = isAuthenticated;
    $("appShell").hidden = !isAuthenticated;
  }

  function profileInitials(profile) {
    return String(profile.full_name || profile.username || "JA")
      .split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();
  }

  function updateProfileMenu(profile) {
    const name = profile.full_name || profile.username;
    $("profileAvatar").textContent = profileInitials(profile);
    $("profileName").textContent = name;
    $("profileMenuName").textContent = name;
    $("profileMenuUsername").textContent = `@${profile.username}`;
    $("openAdminPanel").hidden = profile.role !== "admin";
  }

  async function loadAccount(user) {
    const [profileResult, dataResult] = await Promise.all([
      client.from("profiles").select("id, username, full_name, role, is_active, created_at").eq("id", user.id).single(),
      client.from("user_data").select("data, updated_at").eq("user_id", user.id).maybeSingle()
    ]);
    if (profileResult.error) throw new Error(`Account profile could not be loaded: ${profileResult.error.message}`);
    if (dataResult.error) throw new Error(`Private account data could not be loaded: ${dataResult.error.message}`);
    if (!profileResult.data.is_active) {
      await client.auth.signOut({ scope: "local" });
      setAuthenticatedShell(false);
      throw new Error("This account has been disabled. Contact the JAY ARC administrator.");
    }
    current = {
      user,
      profile: profileResult.data,
      data: dataResult.data?.data ?? null,
      updatedAt: dataResult.data?.updated_at ?? null
    };
    updateProfileMenu(current.profile);
    setAuthenticatedShell(true);
    return current;
  }

  function hasRecords(payload) {
    if (!payload || typeof payload !== "object") return false;
    return Object.entries(payload).some(([key, value]) => {
      if (key === "days") return value && Object.keys(value).length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value > 0;
      return value !== null && value !== undefined && value !== "";
    });
  }

  function countRecords(payload) {
    const days = Object.values(payload.days || {});
    return days.length +
      days.reduce((total, day) => total + Object.keys(day.habits || {}).length +
        (Array.isArray(day.footballSessions) ? day.footballSessions.length : 0) +
        (day.workout?.saved ? 1 : 0) + (day.journal ? 1 : 0), 0) +
      (typeof payload.savings === "number" && payload.savings > 0 ? 1 : 0) +
      ["savings", "learningGoals", "videoIdeas", "footballSchedule"].reduce(
        (total, key) => total + (Array.isArray(payload[key]) ? payload[key].length : 0), 0
      );
  }

  async function offerLocalMigration() {
    let sources;
    try {
      sources = await JayArcDataStore.getLegacySources();
    } catch (error) {
      console.error("Existing browser records could not be verified for migration:", error);
      showMessage(`Existing browser records could not be verified and were not imported: ${error.message}`, true);
      return;
    }
    const available = sources.filter(item => hasRecords(item.payload));
    if (!available.length) return;
    let migratedAccount;
    try {
      migratedAccount = localStorage.getItem(MIGRATION_ACCOUNT_KEY);
    } catch (error) {
      showMessage(`Browser-local records could not be safely associated with an account and were not imported: ${error.message}`, true);
      return;
    }
    if (migratedAccount && migratedAccount !== current.user.id) {
      showMessage("These browser-local records are already associated with a different account. They were not offered for import to this account.", true);
      return;
    }

    available.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    const selected = available[0];
    const cloudExists = Boolean(current.data);
    const unclaimed = !migratedAccount;
    $("migrationTitle").textContent = cloudExists
      ? "Your cloud records are already here."
      : unclaimed ? "Unclaimed browser-local records"
        : "Browser-local records reserved for this account";
    $("migrationDescription").textContent =
      cloudExists
        ? `We found ${countRecords(selected.payload).toLocaleString("en-KE")} browser-local records in ${selected.source}. They are separate from this signed-in account. Your cloud data will not be overwritten. Download a copy to preserve these local records.`
        : `We found ${countRecords(selected.payload).toLocaleString("en-KE")} ${unclaimed ? "unclaimed browser-local" : "browser-local"} records in ${selected.source}. ${unclaimed ? "They are not yet associated with any account. " : "They are reserved for this account. "}Nothing will be removed from this browser. Import them into the currently signed-in account?`;
    $("confirmMigration").hidden = cloudExists;
    $("exportMigration").hidden = !cloudExists;
    $("skipMigration").textContent = cloudExists ? "Close" : "Not now";
    $("migrationDialog").showModal();
    const decision = await new Promise(resolve => {
      let resolved = false;
      const finish = value => {
        if (resolved) return;
        resolved = true;
        $("confirmMigration").removeEventListener("click", confirm);
        $("exportMigration").removeEventListener("click", exportLocal);
        $("skipMigration").removeEventListener("click", skip);
        $("migrationDialog").removeEventListener("cancel", cancel);
        $("migrationDialog").removeEventListener("close", close);
        if ($("migrationDialog").open) $("migrationDialog").close();
        resolve(value);
      };
      const confirm = () => finish("import");
      const exportLocal = () => finish("export");
      const skip = () => finish("skip");
      const cancel = event => {
        event.preventDefault();
        finish("skip");
      };
      const close = () => finish("skip");
      $("confirmMigration").addEventListener("click", confirm, { once: true });
      $("exportMigration").addEventListener("click", exportLocal, { once: true });
      $("skipMigration").addEventListener("click", skip, { once: true });
      $("migrationDialog").addEventListener("cancel", cancel, { once: true });
      $("migrationDialog").addEventListener("close", close, { once: true });
    });
    if (decision === "export") {
      downloadMigration(selected.payload);
      return;
    }
    if (decision !== "import") return;

    if (migratedAccount !== current.user.id) {
      try {
        localStorage.setItem(MIGRATION_ACCOUNT_KEY, current.user.id);
      } catch (error) {
        showMessage(`Browser-local records could not be reserved for this account, so they were not imported: ${error.message}`, true);
        return;
      }
    }

    let importResult;
    try {
      importResult = await client.rpc("save_user_data", {
        p_data: selected.payload,
        p_expected_updated_at: null
      });
    } catch (error) {
      showMessage(`Local records were not imported. They remain reserved for this account; sign in to this same account to retry. ${error.message}`, true);
      return;
    }
    const { data, error } = importResult;
    if (error) {
      showMessage(`Local records were not imported. They remain reserved for this account; sign in to this same account to retry. ${error.message}`, true);
      return;
    }
    if (!data) {
      let latest;
      try {
        latest = await client.from("user_data").select("data, updated_at")
          .eq("user_id", current.user.id).maybeSingle();
      } catch (error) {
        showMessage(`Could not check this account after migration. Local records remain reserved for this account. ${error.message}`, true);
        return;
      }
      if (latest.error) throw new Error(`Could not check the account after migration: ${latest.error.message}`);
      current.data = latest.data?.data ?? null;
      current.updatedAt = latest.data?.updated_at ?? null;
      showMessage("Your account already has cloud records. They were not changed; local records remain reserved for this account in this browser.", true);
      return;
    }
    current.data = selected.payload;
    current.updatedAt = data;
    showMessage("Your browser-local records were imported into this account. Their local originals remain in this browser and are reserved for this account.");
  }

  function downloadMigration(payload) {
    const backup = {
      app: "JAY ARC",
      backupVersion: 2,
      schemaVersion: JayArcDataStore.constants.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sync: { provider: "none", status: "local-migration-copy" },
      integrity: {
        algorithm: "FNV-1a checksum",
        checksum: JayArcDataStore.checksum(payload)
      },
      data: payload
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jay-arc-local-migration-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage("The local records were downloaded. Cloud data was left unchanged.");
  }

  function showMessage(message, isError = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => toast.classList.remove("show"), 5000);
  }

  async function initialize() {
    wireAuthViewControls();
    const validConfig = typeof config.url === "string" &&
      /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url) &&
      typeof config.anonKey === "string" && config.anonKey.length > 20 &&
      !config.anonKey.includes("YOUR_");
    if (!validConfig || !window.supabase?.createClient) {
      $("authConfigWarning").textContent = !validConfig
        ? "Supabase is not configured. Add your project URL and public anon key to supabase-config.js, then reload. Never put a service-role key in this file."
        : "The Supabase client library did not load. Check your internet connection and reload.";
      $("authConfigWarning").hidden = false;
      document.querySelectorAll("#authScreen button[type='submit']").forEach(button => {
        button.disabled = true;
      });
      return null;
    }
    initializeRememberMe();
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        flowType: "pkce",
        storage: makeStorageAdapter()
      }
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        passwordRecovery = true;
        setAuthenticatedShell(false);
        showView("reset");
      }
    });
    wireAuthForms();

    let result;
    try {
      result = await client.auth.getSession();
    } catch (error) {
      setMessage(`Could not restore your sign-in session: ${error.message}`, true);
      return null;
    }
    const { data, error } = result;
    if (error) {
      setMessage(`Could not restore your sign-in session: ${error.message}`, true);
      return null;
    }
    if (passwordRecovery) {
      setAuthenticatedShell(false);
      showView("reset");
      return null;
    }
    if (!data.session) {
      setAuthenticatedShell(false);
      return null;
    }
    try {
      const account = await loadAccount(data.session.user);
      await offerLocalMigration();
      return account;
    } catch (error) {
      setAuthenticatedShell(false);
      setMessage(error.message, true);
      return null;
    }
  }

  function wireAuthViewControls() {
    document.querySelectorAll("[data-auth-view]").forEach(button => {
      button.addEventListener("click", () => showView(button.dataset.authView));
    });
    document.querySelectorAll("[data-toggle-password]").forEach(button => {
      button.addEventListener("click", () => {
        const input = $(button.dataset.togglePassword);
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.textContent = visible ? "Hide" : "Show";
        button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} password`);
      });
    });
  }

  function wireAuthForms() {
    $("loginForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true, "Signing in…");
      try {
        const { error } = await client.auth.signInWithPassword({
          email: $("loginEmail").value.trim(),
          password: $("loginPassword").value
        });
        if (error) {
          setMessage(/invalid login credentials/i.test(error.message)
            ? "Email or password is incorrect."
            : `Sign in failed: ${error.message}`, true);
          return;
        }
        location.reload();
      } catch (error) {
        setMessage(`Sign in failed: ${errorMessage(error)}`, true);
      } finally {
        setBusy(form, false, "Sign in");
      }
    });

    $("signupForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = $("signupPassword").value;
      if (password !== $("signupConfirmPassword").value) {
        setMessage("Passwords do not match.", true);
        return;
      }
      const username = $("signupUsername").value.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        setMessage("Username must be 3–24 letters, numbers or underscores.", true);
        return;
      }
      setBusy(form, true, "Creating account…");
      try {
        const { data, error } = await client.auth.signUp({
          email: $("signupEmail").value.trim(),
          password,
          options: {
            data: { full_name: $("signupName").value.trim(), username },
            emailRedirectTo: location.origin + location.pathname
          }
        });
        if (error) {
          setMessage(`Account could not be created: ${error.message}`, true);
          return;
        }
        if (data.session) {
          location.reload();
        } else {
          showView("login");
          setMessage("Account created. Check your email to confirm the address, then sign in.");
        }
      } catch (error) {
        setMessage(`Account could not be created: ${errorMessage(error)}`, true);
      } finally {
        setBusy(form, false, "Create account");
      }
    });

    $("forgotForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      setBusy(form, true, "Sending link…");
      try {
        const { error } = await client.auth.resetPasswordForEmail($("forgotEmail").value.trim(), {
          redirectTo: `${location.origin}${location.pathname}#reset-password`
        });
        setMessage(error ? `Reset email could not be sent: ${error.message}`
          : "If an account exists for that email, a secure reset link is on its way.", Boolean(error));
      } catch (error) {
        setMessage(`Reset email could not be sent: ${errorMessage(error)}`, true);
      } finally {
        setBusy(form, false, "Send reset link");
      }
    });

    $("resetForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const password = $("resetPassword").value;
      if (password !== $("resetConfirmPassword").value) {
        setMessage("Passwords do not match.", true);
        return;
      }
      setBusy(form, true, "Updating password…");
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) {
          setMessage(`Password could not be updated: ${error.message}`, true);
          return;
        }
        const { error: signOutError } = await client.auth.signOut({ scope: "local" });
        if (signOutError) {
          setMessage(`Password updated, but this session could not be closed: ${signOutError.message}`, true);
          return;
        }
        showView("login");
        setMessage("Your password was updated. Sign in with your new password.");
      } catch (error) {
        setMessage(`Password recovery failed: ${errorMessage(error)}`, true);
      } finally {
        setBusy(form, false, "Update password");
      }
    });

    $("signOutButton").addEventListener("click", async () => {
      const saved = await window.JayArcPersistence?.flush();
      if (saved === false && !confirm("Your latest changes were not saved to the cloud. Sign out anyway?")) return;
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) {
        showMessage(`Sign out failed: ${error.message}`, true);
        return;
      }
      location.reload();
    });

    $("openProfileSettings").addEventListener("click", () => {
      $("profileFullName").value = current.profile.full_name;
      $("profileUsername").value = current.profile.username;
      $("profileEmail").value = current.user.email || "";
      $("profileNewPassword").value = "";
      $("profileConfirmPassword").value = "";
      $("profileMenu").open = false;
      $("profileDialog").showModal();
    });
    $("profileForm").addEventListener("submit", async event => {
      event.preventDefault();
      const fullName = $("profileFullName").value.trim();
      const username = $("profileUsername").value.trim().toLowerCase();
      const newPassword = $("profileNewPassword").value;
      const confirmPassword = $("profileConfirmPassword").value;
      if (!fullName || !/^[a-z0-9_]{3,24}$/.test(username)) {
        showMessage("Enter a name and a valid 3–24 character username.", true);
        return;
      }
      if ((newPassword || confirmPassword) &&
          (newPassword.length < 8 || newPassword !== confirmPassword)) {
        showMessage("Enter matching passwords with at least 8 characters, or leave both password fields blank.", true);
        return;
      }
      const { data, error } = await client.from("profiles").update({
        full_name: fullName,
        username
      }).eq("id", current.user.id).select("id, username, full_name, role, is_active, created_at").single();
      if (error) {
        showMessage(`Profile was not updated: ${error.message}`, true);
        return;
      }
      current.profile = data;
      updateProfileMenu(data);
      if (newPassword) {
        const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
        if (passwordError) {
          showMessage(`Profile saved, but the password was not changed: ${passwordError.message}`, true);
          return;
        }
      }
      $("profileDialog").close();
      showMessage(newPassword ? "Profile and password settings saved." : "Profile settings saved.");
    });

    $("openAdminPanel").addEventListener("click", async () => {
      $("profileMenu").open = false;
      $("adminDialog").showModal();
      $("adminSummary").textContent = "Loading account statistics…";
      $("adminUserList").replaceChildren();
      const { data, error } = await client.rpc("admin_list_users");
      if (error) {
        $("adminSummary").textContent = `Account statistics could not be loaded: ${error.message}`;
        return;
      }
      const users = data || [];
      $("adminSummary").textContent = `${users.length} registered accounts · ${users.filter(user => user.is_active).length} active`;
      $("adminUserList").innerHTML = users.map(user => `
        <article class="admin-user">
          <div>
            <strong>${escapeHTML(user.full_name || user.username)}</strong>
            <small>@${escapeHTML(user.username)} · ${escapeHTML(user.email || "No email")} · ${Number(user.record_count) || 0} records</small>
            <small>Joined ${escapeHTML(new Date(user.created_at).toLocaleDateString())} · ${escapeHTML(user.role)}</small>
          </div>
          ${user.id === current.user.id ? '<span class="stat-badge">You</span>' :
            `<button type="button" class="text-button" data-toggle-user="${escapeHTML(user.id)}" data-active="${user.is_active}">${user.is_active ? "Disable" : "Enable"}</button>`}
        </article>`).join("") || '<p class="empty-state">No accounts found.</p>';
      $("adminUserList").querySelectorAll("[data-toggle-user]").forEach(button => {
        button.addEventListener("click", async () => {
          const nextActive = button.dataset.active !== "true";
          if (!nextActive && !confirm("Disable this account? It will lose access to its dashboard data until re-enabled.")) return;
          button.disabled = true;
          const { error: updateError } = await client.rpc("admin_set_user_active", {
            p_user_id: button.dataset.toggleUser,
            p_is_active: nextActive
          });
          if (updateError) {
            button.disabled = false;
            showMessage(`Account was not changed: ${updateError.message}`, true);
            return;
          }
          $("adminDialog").close();
          $("openAdminPanel").click();
        });
      });
    });

    document.querySelectorAll("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => $(button.dataset.closeDialog).close());
    });
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function storageError(error) {
    return error?.message || "Supabase request failed.";
  }

  window.JayArcAuth = {
    ready: null,
    get current() { return current; },
    get client() { return client; },
    async saveData(payload) {
      if (!current) throw new Error("Sign in is required to save private records.");
      const { data, error } = await client.rpc("save_user_data", {
        p_data: payload,
        p_expected_updated_at: current.updatedAt
      });
      if (error) throw new Error(`Cloud save failed: ${storageError(error)}`);
      if (!data) {
        throw new Error("This account changed on another device. Reload before saving to avoid overwriting newer records.");
      }
      current.updatedAt = data;
      current.data = payload;
      return data;
    }
  };
  window.JayArcAuth.ready = initialize().catch(error => {
    console.error("JAY ARC authentication could not initialize:", error);
    setAuthenticatedShell(false);
    setMessage(`Authentication could not be initialized: ${error.message}`, true);
    return null;
  });
})();
