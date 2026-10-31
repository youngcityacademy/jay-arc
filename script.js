
"use strict";

/* =========================================================
   JAY ARC 2.0 — APPLICATION CORE
   Storage key intentionally retained for existing records.
========================================================= */

const STORAGE_KEY = "jayArcAppState";
const BACKUP_VERSION = 1;
const SAVINGS_TARGET = 10000;

const HABITS = [
  { id: "football", label: "Football or movement", icon: "⚽" },
  { id: "learning", label: "Learn something useful", icon: "⌘" },
  { id: "fitness", label: "Strength or recovery", icon: "✦" },
  { id: "focus", label: "Focused work", icon: "◈" },
  { id: "reflection", label: "Reflect on the day", icon: "✎" }
];

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
  videoIdeas: []
};

let state = loadState();
let installPrompt = null;
let saveTimer = null;
let saveError = false;

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

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The saved data is not a valid object.");
    }

    // Preserve existing fields, including fields this version doesn't use.
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      days: parsed.days && typeof parsed.days === "object"
        ? parsed.days
        : {},
      savings: Array.isArray(parsed.savings) ? parsed.savings : [],
      learningGoals: Array.isArray(parsed.learningGoals)
        ? parsed.learningGoals
        : [],
      videoIdeas: Array.isArray(parsed.videoIdeas)
        ? parsed.videoIdeas
        : []
    };
  } catch (error) {
    console.error("JAY ARC could not read saved data:", error);
    showStatus("Saved data could not be read. Export or recover a backup before making changes.", true);
    return structuredClone(DEFAULT_STATE);
  }
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

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    saveError = false;
    updateSyncStatus("Saved locally");
    return true;
  } catch (error) {
    saveError = true;
    console.error("JAY ARC could not save:", error);
    updateSyncStatus("Save failed");
    showStatus("Your changes may not be saved. Export a backup or free browser storage space.", true);
    return false;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  updateSyncStatus("Saving…");
  saveTimer = setTimeout(() => {
    saveState();
  }, 200);
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
  container.innerHTML = HABITS.map(habit => {
    const checked = isHabitComplete(day.habits[habit.id]);

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
      scheduleSave();
      renderOverview();
      renderHabits();
    });
  });
}

function habitCountForDay(day) {
  const habits = day?.habits || {};
  return HABITS.filter(habit => isHabitComplete(habits[habit.id])).length;
}

function activeDates() {
  return Object.keys(state.days).filter(key => {
    const day = state.days[key];
    if (!day || typeof day !== "object") return false;

    return habitCountForDay(day) > 0 ||
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
  const percentage = Math.round((completed / HABITS.length) * 100);
  const totalSaved = getSavingsTotal();

  if ($("completionValue")) $("completionValue").textContent = `${percentage}%`;
  if ($("completedCount")) $("completedCount").textContent = completed;
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

  const weeklyCounts = keys.map(key => habitCountForDay(state.days[key] || {}));
  const active = weeklyCounts.filter(count => count > 0).length;
  const weeklyAverage = Math.round(
    weeklyCounts.reduce((sum, count) => sum + count, 0) /
    (keys.length * HABITS.length) * 100
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
  const totalMinutes = sessions.reduce(
    (sum, session) => sum + number(session.minutes), 0
  );

  if ($("footballMinutesTotal")) {
    $("footballMinutesTotal").textContent = `${totalMinutes} min`;
  }
  if ($("footballSummary")) {
    $("footballSummary").textContent = sessions.length
      ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} logged`
      : "No sessions yet";
  }

  history.innerHTML = sessions.length
    ? sessions.slice(0, 12).map(session => `
        <article class="history-item">
          <div>
            <strong>${escapeHTML(session.type || "Football session")}</strong>
            <small>${escapeHTML(dateLabel(session.date))} · ${escapeHTML(session.intensity || "Solid")}</small>
            ${session.notes ? `<p>${escapeHTML(session.notes)}</p>` : ""}
          </div>
          <span class="stat-badge">${number(session.minutes)} min</span>
        </article>`).join("")
    : '<p class="empty-state">Your first session starts here.</p>';
}

function initFootball() {
  $("footballForm")?.addEventListener("submit", event => {
    event.preventDefault();

    const minutes = number($("footballMinutes")?.value);
    if (minutes < 1 || minutes > 600) {
      showStatus("Enter session minutes between 1 and 600.", true);
      return;
    }

    getDay().footballSessions.push({
      id: makeId(),
      date: todayKey(),
      type: $("footballType")?.value || "Football",
      minutes,
      intensity: $("footballIntensity")?.value || "Solid",
      notes: $("footballNotes")?.value.trim() || ""
    });

    if (!saveState()) return;

    $("footballNotes").value = "";
    renderFootball();
    renderOverview();
    showStatus("Football session saved.");
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
      getDay().workout.exercises[input.dataset.exercise] = input.checked;
      scheduleSave();
      renderWorkout();
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
  $("saveWorkout")?.addEventListener("click", () => {
    const workout = getDay().workout;
    workout.saved = true;
    workout.date = todayKey();
    workout.sets = getWorkoutSets(getDay());

    if (saveState()) {
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
    input.addEventListener("change", () => {
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

      saveState();
      renderLearning();
    });
  });

  container.querySelectorAll("[data-delete-goal]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.deleteGoal);
      state.learningGoals.splice(index, 1);
      saveState();
      renderLearning();
      showStatus("Learning goal removed.");
    });
  });
}

function initLearning() {
  $("learningTaskForm")?.addEventListener("submit", event => {
    event.preventDefault();

    const input = $("learningTaskInput");
    const text = input?.value.trim();
    if (!text) return;

    state.learningGoals.push({ id: makeId(), text, done: false });
    if (!saveState()) return;

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
    button.addEventListener("click", () => {
      state.videoIdeas.splice(Number(button.dataset.deleteIdea), 1);
      saveState();
      renderVideoIdeas();
      showStatus("Video idea removed.");
    });
  });
}

function initVideoIdeas() {
  $("videoIdeaForm")?.addEventListener("submit", event => {
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

    if (!saveState()) return;

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
  $("savingsForm")?.addEventListener("submit", event => {
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

    if (!saveState()) return;

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
      ? "Entry saved locally"
      : "No entry saved yet";
  }

  renderAchievements();
}

function initJournal() {
  $("saveJournal")?.addEventListener("click", () => {
    getDay().journal = $("journalText")?.value || "";

    if (saveState()) {
      renderJournal();
      renderHabits();
      renderOverview();
      showStatus("Journal entry saved.");
    }
  });

  // Autosave a draft while typing, without waiting for the Save button.
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
    { title: "First steps", description: "Complete your first habit", earned: activeDates().some(key => habitCountForDay(state.days[key]) > 0) },
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
    context.fillStyle = "#71852d";
    context.beginPath();
    context.roundRect(x, baseline - barHeight, barWidth, Math.max(3, barHeight), 5);
    context.fill();

    context.fillStyle = "#65746a";
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
    Math.round(habitCountForDay(state.days[key] || {}) / HABITS.length * 100)
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

  context.strokeStyle = "rgba(29,41,34,0.14)";
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

  drawLine(completions, "#71852d", 100);

  const maxDeposit = Math.max(SAVINGS_TARGET / 10, ...deposits);
  drawLine(deposits, "#d85d42", maxDeposit);

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

function exportBackup() {
  try {
    // Include the complete state, including fields this version doesn't use.
    const backup = {
      app: "JAY ARC",
      backupVersion: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
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
    URL.revokeObjectURL(url);

    showStatus("Backup exported. Keep the file somewhere safe.");
  } catch (error) {
    console.error("Backup export failed:", error);
    showStatus("Could not export your backup.", true);
  }
}

function validateBackup(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The file does not contain a valid backup.");
  }

  const candidate = parsed.data && typeof parsed.data === "object"
    ? parsed.data
    : parsed;

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("The backup data is invalid.");
  }

  if (!candidate.days || typeof candidate.days !== "object" || Array.isArray(candidate.days)) {
    throw new Error("The backup is missing its daily records.");
  }

  if (candidate.savings !== undefined &&
      !Array.isArray(candidate.savings) &&
      typeof candidate.savings !== "number") {
    throw new Error("The savings records are invalid.");
  }

  if (candidate.learningGoals !== undefined &&
      !Array.isArray(candidate.learningGoals)) {
    throw new Error("The learning goals are invalid.");
  }

  if (candidate.videoIdeas !== undefined &&
      !Array.isArray(candidate.videoIdeas)) {
    throw new Error("The video ideas are invalid.");
  }

  return {
    ...structuredClone(DEFAULT_STATE),
    ...candidate,
    days: candidate.days,
    savings: Array.isArray(candidate.savings) ? candidate.savings : [],
    learningGoals: Array.isArray(candidate.learningGoals) ? candidate.learningGoals : [],
    videoIdeas: Array.isArray(candidate.videoIdeas) ? candidate.videoIdeas : []
  };
}

function initBackup() {
  $("exportBackup")?.addEventListener("click", exportBackup);

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

    if (!confirm("Restore this backup? Your current JAY ARC records will be replaced. Export a backup of the current records first if you need them.")) {
      return;
    }

    const previousState = state;
    state = candidate;

    if (!saveState()) {
      state = previousState;
      showStatus("Restore failed because the browser could not save the imported data.", true);
      return;
    }

    renderAll();
    input.value = "";
    showStatus("Backup restored successfully.");
  });
}

/* =========================================================
   RESET, CLEAR DATA AND INSTALL
========================================================= */

function initResetControls() {
  $("resetDay")?.addEventListener("click", () => {
    // This action does not erase existing records.
    getDay();
    saveState();
    renderAll();
    showStatus("Today's record is ready. Your saved history is unchanged.");
  });

  $("clearAll")?.addEventListener("click", () => {
    const confirmed = confirm(
      "This permanently clears JAY ARC data from this browser. Export a backup first. Continue?"
    );

    if (!confirmed) return;

    try {
      localStorage.removeItem(STORAGE_KEY);
      state = structuredClone(DEFAULT_STATE);
      getDay();
      if (!saveState()) return;

      renderAll();
      showStatus("Local JAY ARC data cleared.");
    } catch (error) {
      console.error(error);
      showStatus("Could not clear the saved data.", true);
    }
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

/* =========================================================
   RENDER AND STARTUP
========================================================= */

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
}

function init() {
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

  // Save newly initialized data without deleting legacy fields.
  saveState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
