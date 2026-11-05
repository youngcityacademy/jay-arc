
"use strict";

/* =========================================================
   JAY ARC 2.0 — APPLICATION CORE
========================================================= */

const BACKUP_VERSION = 2;
const SAVINGS_TARGET = 10000;

const HABITS = [
  { id: "football", label: "Young City team training", icon: "⚽" },
  { id: "learning", label: "Learn something useful", icon: "⌘" },
  { id: "fitness", label: "Strength or recovery", icon: "✦" },
  { id: "focus", label: "Focused work", icon: "◈" },
  { id: "reflection", label: "Reflect on the day", icon: "✎" }
];

const PERSONAL_FOOTBALL_HABIT = {
  id: "personalFootball",
  label: "Individual ball training",
  icon: "⚽"
};

const EXERCISES = [
  { id: "pushups", label: "Push-ups", sets: 3 },
  { id: "squats", label: "Bodyweight squats", sets: 3 },
  { id: "lunges", label: "Lunges", sets: 2 },
  { id: "core", label: "Core work", sets: 3 }
];

const DEFAULT_STATE = {
  days: {},
  savings: [],
  learningGoals: [],
  videoIdeas: [],
  footballSchedule: [],
  footballPersonalTrainingEnabled: false,
  footballPersonalTrainingPeriods: []
};

let state = structuredClone(DEFAULT_STATE);
let installPrompt = null;
let saveTimer = null;
let saveError = false;
let dataDatabase = null;
let persistenceMode = "starting";
let persistenceQueue = Promise.resolve();
let saveRevision = 0;

function $(id) {
  return document.getElementById(id);
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeState(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The saved data is not a valid object.");
  }
  if (parsed.days !== undefined &&
      (!parsed.days || typeof parsed.days !== "object" || Array.isArray(parsed.days))) {
    throw new Error("Daily records are malformed; saved data was not changed.");
  }
  for (const [date, day] of Object.entries(parsed.days || {})) {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      throw new Error(`Daily record ${date} is malformed; saved data was not changed.`);
    }
  }
  if (parsed.savings !== undefined &&
      !Array.isArray(parsed.savings) &&
      !(Number.isFinite(Number(parsed.savings)) && Number(parsed.savings) >= 0)) {
    throw new Error("Savings data is malformed; saved data was not changed.");
  }
  for (const key of ["learningGoals", "videoIdeas", "footballSchedule"]) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`${key} data is malformed; saved data was not changed.`);
    }
    if (parsed.footballPersonalTrainingPeriods !== undefined &&
        !Array.isArray(parsed.footballPersonalTrainingPeriods)) {
      throw new Error("Individual training history is malformed; saved data was not changed.");
    }
  }

  const savings = Array.isArray(parsed.savings)
    ? parsed.savings
    : Number.isFinite(Number(parsed.savings)) && Number(parsed.savings) > 0
      ? [{ amount: Number(parsed.savings), note: "Legacy balance" }]
      : [];

  return {
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    days: parsed.days && typeof parsed.days === "object" && !Array.isArray(parsed.days)
      ? parsed.days
      : {},
    savings,
    learningGoals: Array.isArray(parsed.learningGoals) ? parsed.learningGoals : [],
    videoIdeas: Array.isArray(parsed.videoIdeas) ? parsed.videoIdeas : [],
    footballSchedule: Array.isArray(parsed.footballSchedule) ? parsed.footballSchedule : [],
    footballPersonalTrainingEnabled: Boolean(parsed.footballPersonalTrainingEnabled),
    footballPersonalTrainingPeriods: Array.isArray(parsed.footballPersonalTrainingPeriods)
      ? parsed.footballPersonalTrainingPeriods
      : parsed.footballPersonalTrainingEnabled
        ? [{ startDate: todayKey(), endDate: null }]
        : []
  };
}

function getDay(key = todayKey()) {
  if (!state.days[key] || typeof state.days[key] !== "object") {
    state.days[key] = {
      habits: {},
      footballSessions: [],
      workout: {},
      journal: ""
    };
  }

  const day = state.days[key];

  if (!day.habits || typeof day.habits !== "object") day.habits = {};
  if (!Array.isArray(day.footballSessions)) day.footballSessions = [];
  if (!day.workout || typeof day.workout !== "object") day.workout = {};
  if (typeof day.journal !== "string") day.journal = String(day.journal ?? "");

  return day;
}

async function saveState() {
  if (persistenceMode === "starting") {
    showStatus("Data storage is not ready yet. Your change has not been saved.", true);
    return false;
  }

  const revision = ++saveRevision;
  const snapshot = structuredClone(state);
  updateSyncStatus("Saving");
  const task = persistenceQueue.then(() => JayArcAuth.saveData(snapshot));
  persistenceQueue = task.then(() => undefined, () => undefined);
  try {
    await task;
    if (revision !== saveRevision) return true;
    saveError = false;
    updateSyncStatus("Saved");
    if ($("journalStatus") && $("journalText") && document.activeElement === $("journalText")) {
      $("journalStatus").textContent = "Entry autosaved";
    }
    renderDataProtection();
    return true;
  } catch (error) {
    handleSaveFailure(error);
    return false;
  }
}

function handleSaveFailure(error) {
  saveError = true;
  console.error("JAY ARC primary save failed:", error);
  updateSyncStatus("Save failed");
  showStatus(error.message || "Cloud save failed. Your previous cloud records were not overwritten.", true);
  if ($("journalStatus") && $("journalText")) {
    $("journalStatus").textContent = "Save failed";
  }
  renderDataProtection();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  updateSyncStatus("Saving");
  saveTimer = setTimeout(() => {
    void saveState();
  }, 500);
}

function updateSyncStatus(message) {
  const element = $("syncStatus");
  if (!element) return;

  element.innerHTML = `<i></i> ${escapeHTML(message)}`;
  element.classList.toggle("save-error", message === "Save failed");
}

function showStatus(message, isError = false) {
  const backupStatus = $("backupStatus");
  if (backupStatus) backupStatus.textContent = message;

  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => toast.classList.remove("show"), 3500);
  }

  if (isError) console.warn(message);
}

function money(value) {
  return Math.round(number(value)).toLocaleString("en-KE");
}

function dateLabel(key) {
  const date = new Date(`${key}T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function getSavingsAmount(entry) {
  if (typeof entry === "number") return number(entry);
  if (typeof entry === "string") return number(entry);
  return number(entry?.amount ?? entry?.value ?? entry?.deposit);
}

function getSavingsTotal() {
  // Also tolerate legacy numeric totals.
  if (!Array.isArray(state.savings)) return number(state.savings);

  return state.savings.reduce((total, entry) => total + getSavingsAmount(entry), 0);
}

/* =========================================================
   NAVIGATION
========================================================= */

function showPage(page) {
  const valid = [
    "overview", "training", "strength", "learning",
    "youtube", "savings", "journal", "backup"
  ];

  if (!valid.includes(page)) page = "overview";

  document.querySelectorAll(".page-view").forEach(view => {
    const active = view.dataset.view === page;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });

  document.querySelectorAll(".nav-link").forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);

    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (location.hash !== `#${page}`) {
    history.replaceState(null, "", `#${page}`);
  }

  if (page === "overview") renderCharts();
}

function initNavigation() {
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      showPage(link.dataset.page);
    });
  });

  document.querySelector(".brand")?.addEventListener("click", event => {
    event.preventDefault();
    showPage("overview");
  });

  window.addEventListener("hashchange", () => {
    showPage(location.hash.slice(1) || "overview");
  });

  showPage(location.hash.slice(1) || "overview");
}

/* =========================================================
   DATE, HABITS, STREAK AND OVERVIEW
========================================================= */

function initDate() {
  const now = new Date();

  if ($("currentDay")) {
    $("currentDay").textContent = now.toLocaleDateString("en-KE", {
      weekday: "long"
    });
  }

  if ($("currentDate")) {
    $("currentDate").textContent = now.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  if ($("todayLabel")) $("todayLabel").textContent = dateLabel(todayKey());

  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil((((now - start) / 86400000) + start.getDay() + 1) / 7);
  if ($("weekNumber")) $("weekNumber").textContent = week;
}

function isHabitComplete(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    return ["true", "done", "complete", "completed", "yes", "1"].includes(
      value.toLowerCase()
    );
  }
  return Boolean(value?.done ?? value?.completed);
}

function renderHabits() {
  const container = $("habitList");
  if (!container) return;

  const day = getDay();
  const habits = activeHabits();
  container.innerHTML = habits.map(habit => {
    const checked = isHabitCompleteForDay(day, habit);

    return `
      <label class="habit-item ${checked ? "completed" : ""}">
        <input type="checkbox" data-habit="${habit.id}" ${checked ? "checked" : ""}>
        <span class="habit-icon">${habit.icon}</span>
        <span class="habit-label">${escapeHTML(habit.label)}</span>
        <span class="habit-check">${checked ? "✓" : ""}</span>
      </label>`;
  }).join("");

  container.querySelectorAll("[data-habit]").forEach(input => {
    input.addEventListener("change", () => {
      getDay().habits[input.dataset.habit] = input.checked;
      const item = input.closest(".habit-item");
      item?.classList.toggle("completed", input.checked);
      const checkmark = item?.querySelector(".habit-check");
      if (checkmark) checkmark.textContent = input.checked ? "✓" : "";
      scheduleSave();
      renderOverview();
    });
  });
}

function activeHabits(date = todayKey()) {
  const enabled = state.footballPersonalTrainingPeriods.some(period =>
    typeof period?.startDate === "string" &&
    period.startDate <= date &&
    (!period.endDate || date < period.endDate)
  );
  return enabled ? [...HABITS, PERSONAL_FOOTBALL_HABIT] : HABITS;
}

function habitCountForDay(day, date = todayKey()) {
  return activeHabits(date).filter(habit => isHabitCompleteForDay(day, habit)).length;
}

function isHabitCompleteForDay(day, habit) {
  const manuallyCompleted = isHabitComplete(day?.habits?.[habit.id]);
  if (manuallyCompleted) return true;
  const sessions = Array.isArray(day?.footballSessions) ? day.footballSessions : [];
  if (habit.id === "football") {
    return sessions.some(session =>
      ["team training", "match"].includes(String(session.type || "").toLowerCase()) &&
      ["attended", "late"].includes(String(session.attendanceStatus || "attended").toLowerCase())
    );
  }
  if (habit.id === PERSONAL_FOOTBALL_HABIT.id) {
    return sessions.some(session =>
      /ball mastery|weak-foot|dribbl|finishing|crossing|speed|individual/i.test(session.type || "")
    );
  }
  return false;
}

function activeDates() {
  return Object.keys(state.days).filter(key => {
    const day = state.days[key];
    if (!day || typeof day !== "object") return false;

    return habitCountForDay(day, key) > 0 ||
      (Array.isArray(day.footballSessions) && day.footballSessions.length > 0) ||
      Boolean(day.workout?.saved) ||
      Boolean(day.journal);
  }).sort();
}

function calculateStreak() {
  const active = new Set(activeDates());
  let date = new Date();
  let streak = 0;

  // Allow a streak to continue if today hasn't been logged yet.
  if (!active.has(todayKey())) date.setDate(date.getDate() - 1);

  while (active.has(todayKey(date))) {
    streak++;
    date.setDate(date.getDate() - 1);
  }

  return streak;
}

function renderOverview() {
  const day = getDay();
  const completed = habitCountForDay(day);
  const habitTotal = activeHabits(todayKey()).length;
  const percentage = Math.round((completed / habitTotal) * 100);
  const totalSaved = getSavingsTotal();

  if ($("completionValue")) $("completionValue").textContent = `${percentage}%`;
  if ($("completedCount")) $("completedCount").textContent = completed;
  if ($("activeHabitsCount")) $("activeHabitsCount").textContent = habitTotal;
  if ($("sidebarGoal")) $("sidebarGoal").textContent = `${percentage}%`;
  if ($("sidebarGoalBar")) $("sidebarGoalBar").style.width = `${percentage}%`;
  if ($("moneyValue")) $("moneyValue").textContent = money(totalSaved);
  if ($("streakValue")) $("streakValue").textContent = calculateStreak();

  if ($("streakMessage")) {
    $("streakMessage").textContent = calculateStreak() > 0
      ? "Keep building your consistency."
      : "Start with one small win today.";
  }

  const keys = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    keys.push(todayKey(date));
  }

  const weeklyCounts = keys.map(key => habitCountForDay(state.days[key] || {}, key));
  const active = weeklyCounts.filter(count => count > 0).length;
  const weeklyAverage = Math.round(
    weeklyCounts.reduce((sum, count) => sum + count, 0) /
    keys.reduce((sum, key) => sum + activeHabits(key).length, 0) * 100
  );

  if ($("weekCompletion")) $("weekCompletion").textContent = `${weeklyAverage}%`;
  if ($("weekDays")) $("weekDays").textContent = active;

  renderCharts();
}

/* =========================================================
   FOOTBALL TRAINING
========================================================= */

function getSessions() {
  const sessions = [];

  Object.entries(state.days).forEach(([date, day]) => {
    const entries = Array.isArray(day?.footballSessions)
      ? day.footballSessions
      : [];

    entries.forEach(session => {
      sessions.push({ ...session, date: session.date || date });
    });
  });

  return sessions.sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
}

function renderFootball() {
  const history = $("footballHistory");
  if (!history) return;

  const sessions = getSessions();
  const teamSessions = sessions.filter(session =>
    !session.type || !/ball mastery|weak-foot|dribbl|finishing|crossing|speed|individual/i.test(session.type)
  );
  const totalMinutes = sessions.reduce(
    (sum, session) => sum + number(session.minutes), 0
  );
  const matches = teamSessions.reduce((sum, session) =>
    sum + (number(session.matches) || (/^match$/i.test(session.type || "") ? 1 : 0)), 0
  );
  const goals = teamSessions.reduce((sum, session) => sum + number(session.goals), 0);
  const assists = teamSessions.reduce((sum, session) => sum + number(session.assists), 0);

  if ($("footballMinutesTotal")) {
    $("footballMinutesTotal").textContent = `${totalMinutes} min`;
  }
  if ($("teamMatchTotal")) $("teamMatchTotal").textContent = matches;
  if ($("teamGoalTotal")) $("teamGoalTotal").textContent = goals;
  if ($("teamAssistTotal")) $("teamAssistTotal").textContent = assists;
  if ($("footballSummary")) {
    const latest = teamSessions[0];
    const extras = latest ? [
      latest.attendanceStatus ? latest.attendanceStatus : null,
      latest.attendance !== undefined && latest.attendance !== null
        ? `${number(latest.attendance)}% attendance`
        : null,
      latest.matches !== undefined ? `${number(latest.matches)} appearances` : null,
      latest.goals !== undefined ? `${number(latest.goals)} goals` : null,
      latest.assists !== undefined ? `${number(latest.assists)} assists` : null,
      latest.performance !== undefined ? `perf ${number(latest.performance)}/10` : null
    ].filter(Boolean).slice(0, 3).join(" • ") : "";

    $("footballSummary").textContent = sessions.length
      ? extras
        ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} logged • ${extras}`
        : `${sessions.length} session${sessions.length === 1 ? "" : "s"} logged`
      : "No sessions yet";
  }

  history.innerHTML = sessions.length
    ? sessions.slice(0, 12).map(session => {
        const stats = [
          session.team ? escapeHTML(session.team) : null,
          session.attendanceStatus ? `Attendance: ${session.attendanceStatus}` : null,
          session.attendance !== undefined && session.attendance !== null
            ? `Att. ${number(session.attendance)}%`
            : null,
          session.matches !== undefined ? `${number(session.matches)} appearances` : null,
          session.goals !== undefined ? `G.${number(session.goals)}` : null,
          session.assists !== undefined ? `A.${number(session.assists)}` : null,
          session.performance !== undefined ? `Perf. ${number(session.performance)}/10` : null,
          session.matchResult ? `Result: ${session.matchResult}` : null
        ].filter(Boolean).join(" • ");

        return `
        <article class="history-item">
          <div>
            <strong>${escapeHTML(session.type || "Football session")}</strong>
            <small>${escapeHTML(dateLabel(session.date))}${session.time ? ` · ${escapeHTML(session.time)}` : ""} · ${escapeHTML(session.intensity || "Solid")}</small>
            ${stats ? `<p>${escapeHTML(stats)}</p>` : ""}
            ${session.notes ? `<p>${escapeHTML(session.notes)}</p>` : ""}
          </div>
          <span class="stat-badge">${number(session.minutes)} min</span>
        </article>`;
      }).join("")
    : '<p class="empty-state">Your first session starts here.</p>';

  renderFootballSchedule();
}

function renderFootballSchedule() {
  const container = $("footballScheduleList");
  if (!container) return;
  const schedule = state.footballSchedule.slice().sort((left, right) =>
    `${left.date} ${left.time || ""}`.localeCompare(`${right.date} ${right.time || ""}`)
  );
  const upcoming = schedule.filter(item => item.date >= todayKey());
  container.innerHTML = upcoming.length
    ? upcoming.map(item => `
        <article class="history-item">
          <div>
            <strong>Young City team training</strong>
            <small>${escapeHTML(dateLabel(item.date))}${item.time ? ` · ${escapeHTML(item.time)}` : ""}</small>
            ${item.note ? `<p>${escapeHTML(item.note)}</p>` : ""}
          </div>
          <button class="text-button" type="button" data-delete-schedule="${escapeHTML(item.id)}" aria-label="Remove scheduled training">Remove</button>
        </article>`).join("")
    : '<p class="empty-state">No upcoming team sessions scheduled.</p>';

  container.querySelectorAll("[data-delete-schedule]").forEach(button => {
    button.addEventListener("click", async () => {
      state.footballSchedule = state.footballSchedule.filter(item =>
        item.id !== button.dataset.deleteSchedule
      );
      renderFootballSchedule();
      await saveState();
    });
  });
}

function initFootball() {
  const personalToggle = $("personalTrainingToggle");
  const personalOptions = $("individualTrainingOptions");
  if (personalToggle) {
    personalToggle.checked = state.footballPersonalTrainingEnabled;
    if (personalOptions) personalOptions.hidden = !personalToggle.checked;
    personalToggle.addEventListener("change", async () => {
      state.footballPersonalTrainingEnabled = personalToggle.checked;
      const currentPeriod = state.footballPersonalTrainingPeriods.find(period => !period.endDate);
      if (personalToggle.checked && !currentPeriod) {
        state.footballPersonalTrainingPeriods.push({ startDate: todayKey(), endDate: null });
      } else if (!personalToggle.checked && currentPeriod) {
        if (currentPeriod.startDate >= todayKey()) {
          state.footballPersonalTrainingPeriods = state.footballPersonalTrainingPeriods.filter(period => period !== currentPeriod);
        } else {
          currentPeriod.endDate = todayKey();
        }
      }
      if (personalOptions) personalOptions.hidden = !personalToggle.checked;
      if (!personalToggle.checked &&
          $("footballType")?.selectedOptions[0]?.parentElement?.id === "individualTrainingOptions") {
        $("footballType").value = "Team training";
      }
      renderHabits();
      renderOverview();
      if ($("personalTrainingHelp")) {
        $("personalTrainingHelp").textContent = personalToggle.checked
          ? "Individual training is active and counts as a daily habit again."
          : "Disabled while you are without a football. Historical individual sessions remain saved.";
      }
      await saveState();
    });
  }

  const activitySelect = $("footballType");
  activitySelect?.addEventListener("change", () => {
    const isRestDay = activitySelect.value === "Recovery / rest";
    const minutes = $("footballMinutes");
    if (minutes) {
      minutes.min = isRestDay ? "0" : "1";
      if (isRestDay) minutes.value = "0";
      else if (number(minutes.value) < 1) minutes.value = "45";
    }
  });

  if ($("footballDate")) $("footballDate").value = todayKey();
  if ($("scheduleDate")) $("scheduleDate").value = todayKey();

  $("footballForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const minutes = number($("footballMinutes")?.value);
    const activity = $("footballType")?.value || "Team training";
    const isRestDay = activity === "Recovery / rest";
    const date = $("footballDate")?.value || todayKey();
    if ((!isRestDay && (minutes < 1 || minutes > 600)) ||
        (isRestDay && (minutes < 0 || minutes > 600))) {
      showStatus(isRestDay
        ? "Recovery minutes must be between 0 and 600."
        : "Enter session minutes between 1 and 600.", true);
      return;
    }

    const personalType = /ball mastery|weak-foot|dribbl|finishing|crossing|speed|individual/i.test(activity);
    if (personalType && !state.footballPersonalTrainingEnabled) {
      showStatus("Enable individual training first when you have a football.", true);
      return;
    }

    const session = {
      id: makeId(),
      date,
      time: $("footballTime")?.value || "",
      team: $("footballTeam")?.value.trim() || "Young City",
      type: activity,
      minutes,
      intensity: $("footballIntensity")?.value || "Solid",
      notes: $("footballNotes")?.value.trim() || "",
      attendanceStatus: isRestDay ? "recovery/rest" : $("teamAttendanceStatus")?.value || "attended",
      attendance: $("teamAttendance")?.value === "" ? null : number($("teamAttendance")?.value),
      matches: number($("teamMatches")?.value),
      goals: number($("teamGoals")?.value),
      assists: number($("teamAssists")?.value),
      performance: number($("teamPerformance")?.value),
      matchResult: $("teamMatchResult")?.value.trim() || ""
    };
    const day = getDay(date);
    day.footballSessions.push(session);
    if (!isRestDay && ["attended", "late"].includes(session.attendanceStatus)) {
      if (personalType) day.habits.personalFootball = true;
      else if (["Team training", "Match"].includes(activity)) day.habits.football = true;
    }
    renderFootball();
    renderOverview();
    if (!await saveState()) return;

    $("footballNotes").value = "";
    $("teamAttendance").value = "";
    $("teamAttendanceStatus").value = "attended";
    $("teamMatches").value = "0";
    $("teamGoals").value = "0";
    $("teamAssists").value = "0";
    $("teamPerformance").value = "7.5";
    $("teamMatchResult").value = "";
    $("footballDate").value = todayKey();
    $("footballTime").value = "";
    renderFootball();
    renderOverview();
    showStatus(isRestDay ? "Recovery / rest day saved." : "Football activity saved.");
  });

  $("footballScheduleForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const date = $("scheduleDate")?.value;
    if (!date) {
      showStatus("Choose a training date.", true);
      return;
    }

    const item = {
      id: makeId(),
      team: "Young City",
      date,
      time: $("scheduleTime")?.value || "",
      note: $("scheduleNote")?.value.trim() || "",
      createdAt: new Date().toISOString()
    };
    if (state.footballSchedule.some(session =>
      session.date === item.date && (session.time || "") === item.time
    )) {
      showStatus("A Young City session is already scheduled for that date and time.", true);
      return;
    }
    state.footballSchedule.push(item);
    renderFootballSchedule();
    if (!await saveState()) return;
    $("scheduleNote").value = "";
    $("scheduleTime").value = "";
    renderFootballSchedule();
    showStatus("Young City training scheduled.");
  });
}

/* =========================================================
   STRENGTH WORKOUTS
========================================================= */

function renderWorkout() {
  const container = $("exerciseList");
  if (!container) return;

  const workout = getDay().workout;
  if (!workout.exercises || typeof workout.exercises !== "object") {
    workout.exercises = {};
  }

  container.innerHTML = EXERCISES.map(exercise => {
    const checked = Boolean(workout.exercises[exercise.id]);

    return `
      <label class="exercise-item ${checked ? "completed" : ""}">
        <input type="checkbox" data-exercise="${exercise.id}" ${checked ? "checked" : ""}>
        <span>${escapeHTML(exercise.label)}</span>
        <small>${exercise.sets} sets</small>
      </label>`;
  }).join("");

  container.querySelectorAll("[data-exercise]").forEach(input => {
    input.addEventListener("change", () => {
      const workout = getDay().workout;
      workout.exercises[input.dataset.exercise] = input.checked;
      workout.saved = true;
      workout.date = todayKey();
      workout.sets = getWorkoutSets(getDay());
      input.closest(".exercise-item")?.classList.toggle("completed", input.checked);
      scheduleSave();
      renderVolume();
    });
  });
}

function getWorkoutSets(day) {
  if (!day?.workout) return 0;

  if (typeof day.workout.sets === "number") return day.workout.sets;

  const exercises = day.workout.exercises || {};
  return EXERCISES.reduce((sum, exercise) => {
    return sum + (exercises[exercise.id] ? exercise.sets : 0);
  }, 0);
}

function renderVolume() {
  const dates = [];
  const now = new Date();

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    dates.push(todayKey(date));
  }

  const sets = dates.map(date => getWorkoutSets(state.days[date]));
  if ($("setsTotal")) $("setsTotal").textContent = sets.reduce((a, b) => a + b, 0);

  drawBarChart($("volumeChart"), sets, ["M", "T", "W", "T", "F", "S", "S"]);
}

function initWorkout() {
  $("saveWorkout")?.addEventListener("click", async () => {
    const workout = getDay().workout;
    workout.saved = true;
    workout.date = todayKey();
    workout.sets = getWorkoutSets(getDay());

    if (await saveState()) {
      renderOverview();
      showStatus("Workout saved.");
    }
  });
}

/* =========================================================
   LEARNING GOALS
========================================================= */

function renderLearning() {
  const container = $("learningTaskList");
  if (!container) return;

  const goals = state.learningGoals;
  const done = goals.filter(goal =>
    typeof goal === "object" && Boolean(goal.done ?? goal.completed)
  ).length;

  if ($("learningDoneCount")) $("learningDoneCount").textContent = done;
  if ($("learningTotalCount")) $("learningTotalCount").textContent = goals.length;

  container.innerHTML = goals.length
    ? goals.map((goal, index) => {
        const object = typeof goal === "object" && goal !== null;
        const label = object ? goal.text ?? goal.title ?? goal.name ?? "Learning goal" : String(goal);
        const checked = object && Boolean(goal.done ?? goal.completed);

        return `
          <div class="learning-task ${checked ? "completed" : ""}">
            <label>
              <input type="checkbox" data-goal-index="${index}" ${checked ? "checked" : ""}>
              <span>${escapeHTML(label)}</span>
            </label>
            <button class="text-button" type="button" data-delete-goal="${index}" aria-label="Delete learning goal">×</button>
          </div>`;
      }).join("")
    : '<p class="empty-state">Add one useful skill to work on.</p>';

  container.querySelectorAll("[data-goal-index]").forEach(input => {
    input.addEventListener("change", async () => {
      const index = Number(input.dataset.goalIndex);
      const goal = state.learningGoals[index];

      if (typeof goal === "object" && goal !== null) {
        if ("completed" in goal && !("done" in goal)) goal.completed = input.checked;
        else goal.done = input.checked;
      } else {
        state.learningGoals[index] = {
          text: String(goal),
          done: input.checked
        };
      }

      await saveState();
      renderLearning();
    });
  });

  container.querySelectorAll("[data-delete-goal]").forEach(button => {
    button.addEventListener("click", async () => {
      const index = Number(button.dataset.deleteGoal);
      state.learningGoals.splice(index, 1);
      await saveState();
      renderLearning();
    });
  });
}

function initLearning() {
  $("learningTaskForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const input = $("learningTaskInput");
    const text = input?.value.trim();
    if (!text) return;

    state.learningGoals.push({ id: makeId(), text, done: false });
    if (!await saveState()) return;

    input.value = "";
    renderLearning();
    showStatus("Learning goal added.");
  });
}

/* =========================================================
   YOUTUBE IDEA TRACKER
========================================================= */

function renderVideoIdeas() {
  const container = $("videoIdeaList");
  if (!container) return;

  if ($("videoIdeaCount")) {
    $("videoIdeaCount").textContent =
      `${state.videoIdeas.length} idea${state.videoIdeas.length === 1 ? "" : "s"}`;
  }

  container.innerHTML = state.videoIdeas.length
    ? state.videoIdeas.map((idea, index) => {
        const object = typeof idea === "object" && idea !== null;
        const title = object ? idea.title ?? idea.text ?? idea.idea ?? "Untitled idea" : String(idea);
        const channel = object ? idea.channel ?? "Unassigned channel" : "Existing idea";

        return `
          <article class="video-idea">
            <div>
              <strong>${escapeHTML(title)}</strong>
              <small>${escapeHTML(channel)}</small>
            </div>
            <button class="text-button" type="button" data-delete-idea="${index}" aria-label="Delete video idea">×</button>
          </article>`;
      }).join("")
    : '<p class="empty-state">Your next great idea goes here.</p>';

  container.querySelectorAll("[data-delete-idea]").forEach(button => {
    button.addEventListener("click", async () => {
      state.videoIdeas.splice(Number(button.dataset.deleteIdea), 1);
      await saveState();
      renderVideoIdeas();
    });
  });
}

function initVideoIdeas() {
  $("videoIdeaForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const input = $("videoIdeaInput");
    const title = input?.value.trim();
    if (!title) return;

    state.videoIdeas.push({
      id: makeId(),
      title,
      channel: $("videoIdeaChannel")?.value || "Stick Explainer",
      createdAt: new Date().toISOString()
    });

    if (!await saveState()) return;

    input.value = "";
    renderVideoIdeas();
    showStatus("Video idea saved.");
  });
}

/* =========================================================
   SAVINGS
========================================================= */

function renderSavings() {
  const total = getSavingsTotal();
  const percent = Math.min(100, Math.round((total / SAVINGS_TARGET) * 100));
  const remaining = Math.max(0, SAVINGS_TARGET - total);

  if ($("savingsTotal")) $("savingsTotal").textContent = money(total);
  if ($("savingsPercent")) $("savingsPercent").textContent = `${percent}% funded`;
  if ($("savingsRemaining")) {
    $("savingsRemaining").textContent = remaining
      ? `KES ${money(remaining)} to go`
      : "Target reached!";
  }
  if ($("savingsBar")) $("savingsBar").style.width = `${percent}%`;

  const history = $("savingsHistory");
  if (!history) return;

  const entries = Array.isArray(state.savings) ? state.savings : [];
  history.innerHTML = entries.length
    ? entries.slice().reverse().map(entry => {
        const amount = getSavingsAmount(entry);
        const note = typeof entry === "object"
          ? entry.note ?? entry.description ?? "Deposit"
          : "Deposit";
        const date = typeof entry === "object"
          ? entry.date ?? entry.createdAt ?? ""
          : "";

        return `
          <article class="history-item">
            <div>
              <strong>${escapeHTML(note || "Deposit")}</strong>
              ${date ? `<small>${escapeHTML(String(date).slice(0, 10))}</small>` : ""}
            </div>
            <span class="stat-badge">+ KES ${money(amount)}</span>
          </article>`;
      }).join("")
    : '<p class="empty-state">Your first deposit starts here.</p>';
}

function initSavings() {
  $("savingsForm")?.addEventListener("submit", async event => {
    event.preventDefault();

    const amount = number($("savingsAmount")?.value);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      showStatus("Enter a valid positive whole-number amount.", true);
      return;
    }

    if (!Array.isArray(state.savings)) state.savings = [];

    state.savings.push({
      id: makeId(),
      amount,
      note: $("savingsNote")?.value.trim() || "Deposit",
      date: todayKey()
    });

    if (!await saveState()) return;

    $("savingsAmount").value = "";
    $("savingsNote").value = "";
    renderSavings();
    renderOverview();
    showStatus("Deposit saved.");
  });
}

/* =========================================================
   JOURNAL
========================================================= */

function renderJournal() {
  const day = getDay();
  const textarea = $("journalText");

  if (textarea && document.activeElement !== textarea) {
    textarea.value = day.journal || "";
  }

  if ($("journalStatus")) {
    $("journalStatus").textContent = day.journal
      ? "Entry autosaved"
      : "No entry saved yet";
  }

  renderAchievements();
}

function initJournal() {
  $("journalText")?.addEventListener("input", () => {
    getDay().journal = $("journalText").value;
    if ($("journalStatus")) $("journalStatus").textContent = "Saving draft…";
    scheduleSave();
  });
}

function renderAchievements() {
  const container = $("achievementList");
  if (!container) return;

  const sessions = getSessions();
  const totalMinutes = sessions.reduce((sum, session) => sum + number(session.minutes), 0);
  const totalSaved = getSavingsTotal();
  const completedDays = activeDates().length;

  const achievements = [
    { title: "First steps", description: "Complete your first habit", earned: activeDates().some(key => habitCountForDay(state.days[key], key) > 0) },
    { title: "Training mindset", description: "Log your first football session", earned: sessions.length > 0 },
    { title: "One hour of effort", description: "Accumulate 60 football minutes", earned: totalMinutes >= 60 },
    { title: "Consistency builder", description: "Record activity on 7 different days", earned: completedDays >= 7 },
    { title: "First savings milestone", description: "Save your first KES 100", earned: totalSaved >= 100 },
    { title: "Savings target", description: "Reach KES 10,000", earned: totalSaved >= SAVINGS_TARGET }
  ];

  container.innerHTML = achievements.map(item => `
    <article class="achievement-item ${item.earned ? "unlocked" : ""}">
      <span>${item.earned ? "✓" : "◇"}</span>
      <div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.description)}</small></div>
    </article>`).join("");
}

/* =========================================================
   CHARTS — DRAWN WITHOUT EXTERNAL LIBRARIES
========================================================= */

function drawBarChart(canvas, values, labels) {
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = Number(canvas.getAttribute("height")) || 180;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const max = Math.max(1, ...values);
  const gap = 10;
  const barWidth = Math.max(8, (width - gap * (values.length + 1)) / values.length);
  const baseline = height - 20;

  values.forEach((value, index) => {
    const x = gap + index * (barWidth + gap);
    const barHeight = (value / max) * (height - 48);
    context.fillStyle = "#197a59";
    context.beginPath();
    context.roundRect(x, baseline - barHeight, barWidth, Math.max(3, barHeight), 5);
    context.fill();

    context.fillStyle = "#62766c";
    context.font = "11px sans-serif";
    context.textAlign = "center";
    context.fillText(labels[index] || "", x + barWidth / 2, height - 4);
  });
}

function drawProgressChart() {
  const canvas = $("progressChart");
  if (!canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 300;
  const height = Number(canvas.getAttribute("height")) || 230;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const keys = [];
  const now = new Date();

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    keys.push(todayKey(date));
  }

  const completions = keys.map(key =>
    Math.round(habitCountForDay(state.days[key] || {}, key) / activeHabits(key).length * 100)
  );
  const deposits = keys.map(key => {
    const entries = Array.isArray(state.savings) ? state.savings : [];
    return entries
      .filter(entry => String(entry?.date ?? entry?.createdAt ?? "").slice(0, 10) === key)
      .reduce((sum, entry) => sum + getSavingsAmount(entry), 0);
  });

  const padding = { left: 12, right: 12, top: 16, bottom: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = index => padding.left + (plotWidth * index) / 6;
  const y = value => padding.top + plotHeight * (1 - value / 100);

  context.strokeStyle = "rgba(23,43,36,0.14)";
  context.lineWidth = 1;

  [0, 25, 50, 75, 100].forEach(value => {
    context.beginPath();
    context.moveTo(padding.left, y(value));
    context.lineTo(width - padding.right, y(value));
    context.stroke();
  });

  function drawLine(values, color, maxValue) {
    context.beginPath();
    values.forEach((value, index) => {
      const scaled = Math.min(100, value / maxValue * 100);
      if (index === 0) context.moveTo(x(index), y(scaled));
      else context.lineTo(x(index), y(scaled));
    });

    context.strokeStyle = color;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.stroke();

    values.forEach((value, index) => {
      const scaled = Math.min(100, value / maxValue * 100);
      context.beginPath();
      context.arc(x(index), y(scaled), 3.5, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    });
  }

  drawLine(completions, "#197a59", 100);

  const maxDeposit = Math.max(SAVINGS_TARGET / 10, ...deposits);
  drawLine(deposits, "#e56e50", maxDeposit);

  const labels = $("progressLabels");
  if (labels) {
    labels.innerHTML = keys.map(key =>
      `<span>${escapeHTML(new Date(`${key}T12:00:00`).toLocaleDateString("en-KE", { weekday: "short" }))}</span>`
    ).join("");
  }
}

function renderCharts() {
  drawProgressChart();
  renderVolume();
}

window.addEventListener("resize", () => {
  clearTimeout(renderCharts.timer);
  renderCharts.timer = setTimeout(renderCharts, 150);
});

/* =========================================================
   BACKUP AND RESTORE
========================================================= */

function countProtectedRecords() {
  let count = state.footballSchedule.length + state.savings.length +
    state.learningGoals.length + state.videoIdeas.length;

  Object.values(state.days).forEach(day => {
    count++;
    count += Object.keys(day.habits || {}).length;
    count += Array.isArray(day.footballSessions) ? day.footballSessions.length : 0;
    count += day.workout?.saved ? 1 : 0;
    count += day.journal ? 1 : 0;
  });
  return count;
}

function formatTimestamp(value) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

async function renderDataProtection() {
  const history = $("backupHistory");
  if (!history) return;

  if ($("totalRecords")) $("totalRecords").textContent = countProtectedRecords().toLocaleString("en-KE");
  if ($("storageStatus")) $("storageStatus").textContent = "Supabase cloud · account protected";
  if ($("backupStatus")) {
    $("backupStatus").textContent = saveError
      ? "The latest cloud save needs attention. Your previous cloud records were kept."
      : "Cloud data is protected by account-scoped Row Level Security. Recovery snapshots stay on this device and are separated by account.";
  }
  if (!dataDatabase) {
    if ($("backupHealth")) $("backupHealth").textContent = "Unavailable";
    if ($("storageUsage")) $("storageUsage").textContent = "Private device snapshots unavailable";
    history.innerHTML = '<p class="empty-state">Cloud saving is active. Device recovery snapshots require IndexedDB.</p>';
    return;
  }

  try {
    const [stats, backups] = await Promise.all([
      JayArcDataStore.getStats(dataDatabase, state),
      JayArcDataStore.listBackups(dataDatabase)
    ]);
    if ($("backupHealth")) $("backupHealth").textContent = saveError
      ? "Needs attention" : backups.length ? "Protected" : "No snapshot";
    if ($("lastBackup")) $("lastBackup").textContent = formatTimestamp(stats.lastBackupAt);
    if ($("backupCount")) $("backupCount").textContent = `${stats.backupCount} of ${stats.maxBackups} snapshots`;
    if ($("storageUsage")) {
      const bytes = stats.storageBytes ?? stats.payloadBytes;
      $("storageUsage").textContent = `${(bytes / (1024 * 1024)).toFixed(2)} MB used${stats.storageQuotaBytes ? ` of ${(stats.storageQuotaBytes / (1024 * 1024)).toFixed(0)} MB` : ""}`;
    }
    history.innerHTML = backups.length
      ? backups.map(backup => `
          <article class="history-item backup-history-item">
            <div>
              <strong>${escapeHTML(backup.reason.replaceAll("-", " "))}</strong>
              <small>${escapeHTML(formatTimestamp(backup.createdAt))} · schema ${number(backup.schemaVersion)}</small>
            </div>
            <button class="text-button" type="button" data-restore-snapshot="${escapeHTML(backup.id)}">Review &amp; restore</button>
          </article>`).join("")
      : '<p class="empty-state">Your first recovery snapshot will appear here.</p>';

    history.querySelectorAll("[data-restore-snapshot]").forEach(button => {
      button.addEventListener("click", async () => {
        const selected = backups.find(item => item.id === button.dataset.restoreSnapshot);
        if (!selected || selected.checksum !== JayArcDataStore.checksum(selected.payload)) {
          showStatus("That recovery snapshot failed its integrity check. Current data was not changed.", true);
          return;
        }
        await restoreData(selected.payload, `snapshot from ${formatTimestamp(selected.createdAt)}`);
      });
    });
  } catch (error) {
    console.error("Could not read account backup status:", error);
    if ($("backupHealth")) $("backupHealth").textContent = "Needs attention";
    if ($("storageUsage")) $("storageUsage").textContent = "Recovery status could not be read";
    history.innerHTML = '<p class="empty-state">Private recovery history could not be read. Export the current data before continuing.</p>';
  }
}

async function restoreData(candidate, description) {
  const days = Object.values(candidate.days || {});
  const summary = [
    `${Object.keys(candidate.days || {}).length} daily records`,
    `${days.reduce((sum, day) => sum + (Array.isArray(day.footballSessions) ? day.footballSessions.length : 0), 0)} football records`,
    `${Array.isArray(candidate.footballSchedule) ? candidate.footballSchedule.length : 0} scheduled sessions`,
    `${Array.isArray(candidate.savings) ? candidate.savings.length : 0} savings records`,
    `${Array.isArray(candidate.learningGoals) ? candidate.learningGoals.length : 0} learning goals`,
    `${Array.isArray(candidate.videoIdeas) ? candidate.videoIdeas.length : 0} YouTube ideas`,
    `${days.filter(day => Boolean(day.journal)).length} journal entries`
  ].join("\n");
  const recordCount = countRecordsIn(candidate);
  const confirmed = confirm(
    `Restore ${description}?\n\nData in this backup:\n${summary}\nTotal: ${recordCount} records.\n\nThis will replace current JAY ARC data. A backup of the current data will be created first.`
  );
  if (!confirmed) return;

  const previousState = state;
  const nextState = normalizeState(candidate);
  try {
    if (dataDatabase) {
      await persistenceQueue;
      await JayArcDataStore.createSnapshot(dataDatabase, structuredClone(state), "before-restore");
    }
    state = nextState;
    if (!await saveState()) throw new Error("Cloud restore save failed.");
    renderAll();
    showStatus(dataDatabase
      ? "Backup restored to your account. A private pre-restore snapshot was kept."
      : "Backup restored to your account.");
    await renderDataProtection();
  } catch (error) {
    state = previousState;
    console.error("Backup restore failed:", error);
    showStatus(`Backup was not restored: ${error.message}`, true);
  }
}

function countRecordsIn(data) {
  const days = data.days && typeof data.days === "object" ? Object.values(data.days) : [];
  let count = (Array.isArray(data.footballSchedule) ? data.footballSchedule.length : 0) +
    (Array.isArray(data.savings) ? data.savings.length : 1) +
    (Array.isArray(data.learningGoals) ? data.learningGoals.length : 0) +
    (Array.isArray(data.videoIdeas) ? data.videoIdeas.length : 0);
  days.forEach(day => {
    count++;
    count += Object.keys(day.habits || {}).length;
    count += Array.isArray(day.footballSessions) ? day.footballSessions.length : 0;
    count += day.workout?.saved ? 1 : 0;
    count += day.journal ? 1 : 0;
  });
  return count;
}

function exportBackup() {
  try {
    const backup = {
      app: "JAY ARC",
      backupVersion: BACKUP_VERSION,
      schemaVersion: JayArcDataStore.constants.SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sync: {
        provider: "supabase",
        status: "account-cloud",
        note: "This file is a downloadable copy of this account's data."
      },
      integrity: {
        algorithm: "FNV-1a checksum",
        checksum: JayArcDataStore.checksum(state)
      },
      data: state
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `jay-arc-backup-${todayKey()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showStatus("Backup exported. Keep the file somewhere safe.");
  } catch (error) {
    console.error("Backup export failed:", error);
    showStatus("Could not export your backup.", true);
  }
}

function validateBackup(parsed) {
  return normalizeState(JayArcDataStore.verifyBackup(parsed));
}

function initBackup() {
  $("exportBackup")?.addEventListener("click", exportBackup);

  $("createBackup")?.addEventListener("click", async () => {
    try {
      if (!dataDatabase) throw new Error("Private device snapshots are unavailable in this browser.");
      if (!await saveState()) return;
      await JayArcDataStore.createSnapshot(dataDatabase, structuredClone(state), "manual-backup");
      showStatus("Private account snapshot created and cloud data saved.");
      await renderDataProtection();
    } catch (error) {
      console.error("Manual backup failed:", error);
      showStatus(`Backup failed: ${error.message}`, true);
    }
  });

  $("restoreBackup")?.addEventListener("click", async () => {
    const input = $("importBackup");
    const file = input?.files?.[0];

    if (!file) {
      showStatus("Choose a JSON backup file first.", true);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showStatus("That file is over the 10 MB backup limit.", true);
      return;
    }

    let candidate;

    try {
      const parsed = JSON.parse(await file.text());
      candidate = validateBackup(parsed);
    } catch (error) {
      showStatus(`Backup not restored: ${error.message}`, true);
      return;
    }

    const summary = `${countRecordsIn(candidate)} records across ${Object.keys(candidate.days).length} days`;
    await restoreData(candidate, `imported backup (${summary})`);
    input.value = "";
  });
}

/* =========================================================
   RESET, CLEAR DATA AND INSTALL
========================================================= */

function initResetControls() {
  $("resetDay")?.addEventListener("click", async () => {
    // This action does not erase existing records.
    getDay();
    if (!await saveState()) return;
    renderAll();
    showStatus("Today's record is ready. Your saved history is unchanged.");
  });

  $("clearAll")?.addEventListener("click", () => {
    const confirmed = confirm(
      dataDatabase
        ? "Clear this account's JAY ARC records? A private recovery snapshot will be kept first. Continue?"
        : "Clear this account's JAY ARC records? Device recovery snapshots are unavailable, so export a JSON backup first if you need one. Continue?"
    );

    if (!confirmed) return;

    (async () => {
      const previousState = state;
      const nextState = normalizeState(structuredClone(DEFAULT_STATE));
      try {
        if (dataDatabase) {
          await persistenceQueue;
          await JayArcDataStore.createSnapshot(dataDatabase, structuredClone(state), "before-clear");
        }
        state = nextState;
        getDay();
        await persistLatestState();
        renderAll();
        showStatus("Your account workspace was cleared. A private pre-clear snapshot was kept.");
      } catch (error) {
        state = previousState;
        console.error("Could not start a fresh workspace:", error);
        showStatus(`Workspace was not cleared: ${error.message}`, true);
      }
    })();
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if ($("installButton")) $("installButton").hidden = false;
  });

  $("installButton")?.addEventListener("click", async () => {
    if (!installPrompt) return;

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $("installButton").hidden = true;
  });
}

async function persistLatestState() {
  const snapshot = structuredClone(state);
  await JayArcAuth.saveData(snapshot);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) ||
      (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1")) {
    return;
  }
  navigator.serviceWorker.register("./sw.js").then(() => {
    if ($("storageStatus")) $("storageStatus").textContent += " · offline shell ready";
  }).catch(error => {
    console.error("JAY ARC offline cache registration failed:", error);
    showStatus("Offline app caching could not be enabled. Online saving remains available.", true);
  });
}

function renderAll() {
  initDate();
  renderHabits();
  renderOverview();
  renderFootball();
  renderWorkout();
  renderLearning();
  renderVideoIdeas();
  renderSavings();
  renderJournal();
  renderAchievements();
  renderCharts();
  void renderDataProtection();
}

window.JayArcPersistence = {
  async flush() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
      return saveState();
    }
    if (saveError) return saveState();
    await persistenceQueue;
    return !saveError;
  }
};

async function init() {
  const account = await JayArcAuth.ready;
  if (!account) return;

  state = normalizeState(account.data || DEFAULT_STATE);
  persistenceMode = "cloud";
  try {
    dataDatabase = await JayArcDataStore.initializeAccountBackups(account.user.id);
  } catch (error) {
    console.error("Private account backup storage could not be opened:", error);
    showStatus("Cloud saving is available, but this browser cannot create private recovery snapshots.", true);
  }

  updateSyncStatus("Cloud ready");
  getDay();
  initNavigation();
  initFootball();
  initWorkout();
  initLearning();
  initVideoIdeas();
  initSavings();
  initJournal();
  initBackup();
  initResetControls();
  renderAll();
  if (!account.updatedAt && !await saveState()) return;
  renderDataProtection();
  registerServiceWorker();
}

if (!window.JayArcAuth) {
  location.replace(new URL("./index.html", location.href).href);
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { void init(); }, { once: true });
} else {
  void init();
}
