const STORAGE_KEY = "musicCampBudgetScenarios.v2";
const LEGACY_STORAGE_KEY = "musicCampBudgetScenarios.v1";
const DRIVE_FILE_NAME = "音樂班寒暑訓經費規劃備份.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const FIREBASE_SDK_VERSION = "11.10.0";
const FIREBASE_CONFIG = window.MUSIC_BUDGET_FIREBASE_CONFIG || {};
const FIREBASE_REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

const $ = (id) => document.getElementById(id);
const money = (value) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const today = new Date();
const pad2 = (n) => String(n).padStart(2, "0");
const isoDate = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const dateText = (value) => (value ? value.replaceAll("-", "/") : "未設定");

const courseTemplates = [
  { key: "sectional", label: "分部課" },
  { key: "ensemble", label: "合奏課程" },
];

const defaultReminders = [
  "請家長協助學生預留暑訓日期，並提醒學生準時出席、攜帶樂器與譜本。",
  "暑訓及後續學習期間，若學生無法認真練習、未完成老師指定要求，或出席率不佳，經指揮老師評估後，可能調整回 B 團。",
  "若因病、重要家庭因素或其他不可抗力無法出席，請事先向藝才組或指導老師請假。",
].join("\n");

const defaultRoster = [
  "第一小提琴|大合奏教室|",
  "第二小提琴|弦 A 教室|",
  "第三小提琴|弦 B 教室|",
  "大提琴、低音提琴|二樓團輔教室|",
].join("\n");

const defaultSectionGroups = [
  { part: "第一小提琴", location: "大合奏教室", students: "" },
  { part: "第二小提琴", location: "弦 A 教室", students: "" },
  { part: "第三小提琴", location: "弦 B 教室", students: "" },
  { part: "大提琴、低音提琴", location: "二樓團輔教室", students: "" },
];

let scenarios = loadScenarios();
let activeId = scenarios[0].id;
let dirty = false;
let driveToken = "";
let driveFileId = localStorage.getItem("musicCampBudget.driveFileId") || "";
let firebaseAuth = null;
let firebaseAuthApi = null;

function defaultScenario() {
  return {
    id: crypto.randomUUID(),
    name: "115年弦樂 A 團暑訓",
    schoolName: "南屏國小",
    ensembleName: "弦樂 A 團",
    schoolYear: "115",
    organizerName: "南屏國小藝才組",
    campType: "summer",
    courses: [
      { key: "sectional", label: "分部課", teachers: 6, rate: 1000 },
      { key: "ensemble", label: "合奏課程", teachers: 1, rate: 1200 },
    ],
    periods: [
      {
        id: crypto.randomUUID(),
        name: "第一階段",
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        sectionalSessions: 20,
        ensembleSessions: 10,
      },
    ],
    studentCount: 48,
    publicSubsidy: 70000,
    paymentDue: isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14)),
    noticeDate: isoDate(today),
    collectionMethod: "各班術導彙整後，統一繳交至藝才組",
    paymentNote: "請交予音樂班辦公室，或依學校公告方式完成繳費。",
    reminders: defaultReminders,
    sectionRoster: defaultRoster,
    sectionGroups: structuredClone(defaultSectionGroups),
    googleClientId: localStorage.getItem("musicCampBudget.googleClientId") || "",
    updatedAt: new Date().toISOString(),
  };
}

function loadScenarios() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (Array.isArray(saved) && saved.length) return saved.map(normalizeScenario);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length) return legacy.map(normalizeScenario);
  } catch {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  return [defaultScenario()];
}

function hasFirebaseConfig() {
  return FIREBASE_REQUIRED_KEYS.every((key) => {
    const value = FIREBASE_CONFIG[key];
    return typeof value === "string" && value.trim() && !value.includes("YOUR_") && !value.includes("填入");
  });
}

function setAuthStatus(message, type = "") {
  const box = $("authStatus");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("is-error", type === "error");
  box.classList.toggle("is-success", type === "success");
}

function setLoginBusy(isBusy) {
  const button = $("loginSubmitBtn");
  if (!button) return;
  button.disabled = isBusy || !hasFirebaseConfig();
  button.innerHTML = isBusy
    ? '<svg class="icon"><use href="#icon-key"></use></svg>登入中...'
    : '<svg class="icon"><use href="#icon-key"></use></svg>登入系統';
}

function showAuthenticatedApp(user) {
  document.body.classList.add("authenticated");
  $("appShell")?.removeAttribute("aria-hidden");
  if ($("currentUserEmail")) $("currentUserEmail").textContent = user?.email || "已登入";
  setAuthStatus("已登入，正在開啟系統。", "success");
}

function showLogin() {
  document.body.classList.remove("authenticated");
  $("appShell")?.setAttribute("aria-hidden", "true");
  if ($("currentUserEmail")) $("currentUserEmail").textContent = "尚未登入";
}

function authErrorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/invalid-email": "帳號格式不正確，請輸入 Email 格式的帳號。",
    "auth/invalid-credential": "帳號或密碼不正確，請確認後再試一次。",
    "auth/user-disabled": "此帳號已停用，請洽系統管理者。",
    "auth/too-many-requests": "登入嘗試次數過多，請稍後再試或洽系統管理者。",
    "auth/network-request-failed": "網路連線失敗，請確認網路後再試一次。",
  };
  return messages[code] || "登入失敗，請確認帳號密碼或 Firebase 設定。";
}

async function loadFirebaseAuth() {
  if (firebaseAuth && firebaseAuthApi) return firebaseAuthApi;
  const appModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`);
  const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`);
  const firebaseApp = appModule.initializeApp(FIREBASE_CONFIG);
  firebaseAuth = authModule.getAuth(firebaseApp);
  firebaseAuthApi = authModule;
  return firebaseAuthApi;
}

async function initAuthGate() {
  if (!hasFirebaseConfig()) {
    showLogin();
    setLoginBusy(false);
    setAuthStatus("尚未完成 Firebase 登入設定。請先依下方說明填寫 auth-config.js。", "error");
    $("authSetupGuide")?.setAttribute("open", "");
    return;
  }

  try {
    setLoginBusy(true);
    setAuthStatus("正在檢查登入狀態...");
    const authApi = await loadFirebaseAuth();
    authApi.onAuthStateChanged(firebaseAuth, (user) => {
      setLoginBusy(false);
      if (user) showAuthenticatedApp(user);
      else {
        showLogin();
        setAuthStatus("請使用授權帳號登入。");
      }
    });
  } catch {
    showLogin();
    setLoginBusy(false);
    setAuthStatus("Firebase 登入服務載入失敗，請確認網路與 auth-config.js 設定。", "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!hasFirebaseConfig()) {
    setAuthStatus("尚未完成 Firebase 登入設定，無法登入。", "error");
    $("authSetupGuide")?.setAttribute("open", "");
    return;
  }
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  if (!email || !password) {
    setAuthStatus("請輸入帳號與密碼。", "error");
    return;
  }

  try {
    setLoginBusy(true);
    setAuthStatus("正在登入...");
    const authApi = await loadFirebaseAuth();
    const persistence = $("rememberDevice")?.checked ? authApi.browserLocalPersistence : authApi.browserSessionPersistence;
    await authApi.setPersistence(firebaseAuth, persistence);
    await authApi.signInWithEmailAndPassword(firebaseAuth, email, password);
    $("loginPassword").value = "";
  } catch (error) {
    setLoginBusy(false);
    setAuthStatus(authErrorMessage(error), "error");
  }
}

async function logout() {
  if (!firebaseAuth) {
    showLogin();
    return;
  }
  const authApi = firebaseAuthApi || (await loadFirebaseAuth());
  await authApi.signOut(firebaseAuth);
  driveToken = "";
  updateDriveStatus();
  showLogin();
  setAuthStatus("已登出系統。");
}

function normalizeScenario(raw) {
  const base = defaultScenario();
  const courses = Array.isArray(raw.courses)
    ? courseTemplates.map((template) => {
        const found = raw.courses.find((course) => course.key === template.key) || {};
        return {
          key: template.key,
          label: template.label,
          teachers: Number(found.teachers ?? (template.key === "sectional" ? raw.sectionalTeachers : raw.conductorTeachers)) || 0,
          rate: Number(found.rate ?? raw.classRate) || 0,
        };
      })
    : [
        {
          key: "sectional",
          label: "分部課",
          teachers: Number(raw.sectionalTeachers) || 0,
          rate: Number(raw.classRate) || 0,
        },
        {
          key: "ensemble",
          label: "合奏課程",
          teachers: Number(raw.conductorTeachers) || 0,
          rate: Number(raw.classRate) || 0,
        },
      ];

  const periods = Array.isArray(raw.periods) && raw.periods.length
    ? raw.periods.map((period, index) => ({
        id: period.id || crypto.randomUUID(),
        name: period.name || `第${index + 1}階段`,
        startDate: period.startDate || raw.startDate || "",
        endDate: period.endDate || raw.endDate || "",
        sectionalSessions: Number(period.sectionalSessions ?? period.sessions ?? raw.sessions) || 0,
        ensembleSessions: Number(period.ensembleSessions ?? period.sessions ?? raw.sessions) || 0,
      }))
    : [
        {
          id: crypto.randomUUID(),
          name: "第一階段",
          startDate: raw.startDate || base.periods[0].startDate,
          endDate: raw.endDate || base.periods[0].endDate,
          sectionalSessions: Number(raw.sessions) || 0,
          ensembleSessions: Number(raw.sessions) || 0,
        },
      ];

  return {
    ...base,
    ...raw,
    courses,
    periods,
    studentCount: Math.max(1, Number(raw.studentCount ?? base.studentCount) || 1),
    publicSubsidy: Number(raw.publicSubsidy ?? base.publicSubsidy) || 0,
    schoolName: raw.schoolName || base.schoolName,
    ensembleName: raw.ensembleName || base.ensembleName,
    schoolYear: raw.schoolYear || base.schoolYear,
    organizerName: raw.organizerName || base.organizerName,
    noticeDate: raw.noticeDate || base.noticeDate,
    collectionMethod: raw.collectionMethod || base.collectionMethod,
    reminders: raw.reminders || base.reminders,
    sectionRoster: raw.sectionRoster || base.sectionRoster,
    sectionGroups: normalizeSectionGroups(raw.sectionGroups, raw.sectionRoster || base.sectionRoster),
    googleClientId: raw.googleClientId || localStorage.getItem("musicCampBudget.googleClientId") || "",
  };
}

function normalizeSectionGroups(groups, fallbackRoster) {
  if (Array.isArray(groups) && groups.length) {
    return groups.map((group) => ({
      id: group.id || crypto.randomUUID(),
      part: group.part || group.section || "",
      location: group.location || "",
      students: group.students || "",
    }));
  }
  const parsed = String(fallbackRoster || "")
    .split(/\n+/)
    .map((line) => line.split("|").map((item) => item.trim()))
    .filter((row) => row.some(Boolean))
    .map((row) => ({
      id: crypto.randomUUID(),
      part: row[0] || "",
      location: row[1] || "",
      students: row.slice(2).join("、") || "",
    }));
  return parsed.length ? parsed : structuredClone(defaultSectionGroups).map((group) => ({ ...group, id: crypto.randomUUID() }));
}

function serializeSectionGroups(groups) {
  return groups.map((group) => `${group.part || ""}|${group.location || ""}|${group.students || ""}`).join("\n");
}

function getActive() {
  return scenarios.find((scenario) => scenario.id === activeId) || scenarios[0];
}

function numberFrom(value, minimum = 0) {
  return Math.max(minimum, Number(value || 0));
}

function readForm() {
  const scenario = getActive();
  scenario.name = $("scenarioName").value.trim() || "未命名情境";
  scenario.schoolName = $("schoolName").value.trim() || "未設定學校";
  scenario.ensembleName = $("ensembleName").value.trim() || "未設定團隊";
  scenario.schoolYear = $("schoolYear").value.trim() || "";
  scenario.organizerName = $("organizerName").value.trim() || "";
  scenario.noticeDate = $("noticeDate").value;
  scenario.collectionMethod = $("collectionMethod").value.trim();
  scenario.reminders = $("reminders").value.trim();
  scenario.sectionGroups = readSectionGroupRows();
  scenario.sectionRoster = serializeSectionGroups(scenario.sectionGroups);
  scenario.courses = courseTemplates.map((template) => ({
    key: template.key,
    label: template.label,
    teachers: numberFrom($(`course-${template.key}-teachers`).value),
    rate: numberFrom($(`course-${template.key}-rate`).value),
  }));
  scenario.periods = [...document.querySelectorAll(".period-row")].map((row, index) => ({
    id: row.dataset.id || crypto.randomUUID(),
    name: row.querySelector("[data-field='name']").value.trim() || `第${index + 1}階段`,
    startDate: row.querySelector("[data-field='startDate']").value,
    endDate: row.querySelector("[data-field='endDate']").value,
    sectionalSessions: numberFrom(row.querySelector("[data-field='sectionalSessions']").value),
    ensembleSessions: numberFrom(row.querySelector("[data-field='ensembleSessions']").value),
  }));
  scenario.studentCount = numberFrom($("studentCount").value, 1);
  scenario.publicSubsidy = numberFrom($("publicSubsidy").value);
  scenario.paymentDue = $("paymentDue").value;
  scenario.paymentNote = $("paymentNote").value.trim();
  scenario.googleClientId = $("googleClientId").value.trim();
  scenario.updatedAt = new Date().toISOString();
  localStorage.setItem("musicCampBudget.googleClientId", scenario.googleClientId);
  return scenario;
}

function writeForm(scenario) {
  $("schoolName").value = scenario.schoolName;
  $("ensembleName").value = scenario.ensembleName;
  $("schoolYear").value = scenario.schoolYear;
  $("organizerName").value = scenario.organizerName;
  $("noticeDate").value = scenario.noticeDate;
  $("scenarioName").value = scenario.name;
  $("studentCount").value = scenario.studentCount;
  $("publicSubsidy").value = scenario.publicSubsidy;
  $("paymentDue").value = scenario.paymentDue;
  $("collectionMethod").value = scenario.collectionMethod;
  $("paymentNote").value = scenario.paymentNote;
  $("reminders").value = scenario.reminders;
  $("googleClientId").value = scenario.googleClientId || "";
  renderCourseRows(scenario);
  renderPeriodRows(scenario);
  renderSectionGroupRows(scenario);
  updateCampTabs();
  updateDriveStatus();
  updateCalculations();
}

function courseSessions(scenario, key) {
  const field = key === "sectional" ? "sectionalSessions" : "ensembleSessions";
  return scenario.periods.reduce((sum, period) => sum + Number(period[field] || 0), 0);
}

function calculate(scenario) {
  const courseDetails = scenario.courses.map((course) => {
    const sessions = courseSessions(scenario, course.key);
    const teacherClasses = Number(course.teachers) * sessions;
    const subtotal = teacherClasses * Number(course.rate);
    return { ...course, sessions, teacherClasses, subtotal };
  });
  const teacherTotal = scenario.courses.reduce((sum, course) => sum + Number(course.teachers || 0), 0);
  const classCount = courseDetails.reduce((sum, course) => sum + course.teacherClasses, 0);
  const totalFee = courseDetails.reduce((sum, course) => sum + course.subtotal, 0);
  const subsidy = Math.min(Number(scenario.publicSubsidy), totalFee);
  const selfPayTotal = Math.max(0, totalFee - subsidy);
  const perStudent = Math.ceil(selfPayTotal / Math.max(1, Number(scenario.studentCount)));
  return { courseDetails, teacherTotal, classCount, totalFee, subsidy, selfPayTotal, perStudent };
}

function campLabel(scenario) {
  return scenario.campType === "winter" ? "寒訓" : "暑訓";
}

function renderCourseRows(scenario) {
  const calc = calculate(scenario);
  $("courseRows").innerHTML = scenario.courses
    .map((course) => {
      const detail = calc.courseDetails.find((item) => item.key === course.key);
      return `
        <div class="course-row">
          <strong>${course.label}</strong>
          <input id="course-${course.key}-teachers" type="number" min="0" step="1" value="${course.teachers}" aria-label="${course.label}老師人數" />
          <input id="course-${course.key}-rate" type="number" min="0" step="100" value="${course.rate}" aria-label="${course.label}每堂單價" />
          <span id="course-${course.key}-sessions">${detail.sessions} 節</span>
          <span id="course-${course.key}-subtotal">${money(detail.subtotal)}</span>
        </div>`;
    })
    .join("");
}

function renderPeriodRows(scenario) {
  $("periodRows").innerHTML = scenario.periods
    .map(
      (period) => `
        <div class="period-row" data-id="${period.id}">
          <input data-field="name" type="text" value="${escapeHtml(period.name)}" aria-label="階段名稱" />
          <input data-field="startDate" type="date" value="${period.startDate}" aria-label="開始日期" />
          <input data-field="endDate" type="date" value="${period.endDate}" aria-label="結束日期" />
          <input data-field="sectionalSessions" type="number" min="0" step="1" value="${period.sectionalSessions}" aria-label="分部節數" />
          <input data-field="ensembleSessions" type="number" min="0" step="1" value="${period.ensembleSessions}" aria-label="合奏節數" />
          <button class="icon-action remove-period" type="button" aria-label="刪除此階段"><svg class="icon"><use href="#icon-trash"></use></svg></button>
        </div>`,
    )
    .join("");
}

function renderSectionGroupRows(scenario) {
  const groups = normalizeSectionGroups(scenario.sectionGroups, scenario.sectionRoster);
  $("sectionRosterRows").innerHTML = groups
    .map(
      (group) => `
        <div class="roster-row" data-id="${group.id || crypto.randomUUID()}">
          <input data-field="part" type="text" value="${escapeHtml(group.part)}" aria-label="分部" placeholder="例：第一小提琴" />
          <input data-field="location" type="text" value="${escapeHtml(group.location)}" aria-label="上課地點" placeholder="例：大合奏教室" />
          <input data-field="students" type="text" value="${escapeHtml(group.students)}" aria-label="學生" placeholder="例：學生姓名、學生姓名" />
          <button class="icon-action remove-section-row" type="button" aria-label="刪除此分部"><svg class="icon"><use href="#icon-trash"></use></svg></button>
        </div>`,
    )
    .join("");
}

function readSectionGroupRows() {
  const rows = [...document.querySelectorAll(".roster-row")].map((row) => ({
    id: row.dataset.id || crypto.randomUUID(),
    part: row.querySelector("[data-field='part']").value.trim(),
    location: row.querySelector("[data-field='location']").value.trim(),
    students: row.querySelector("[data-field='students']").value.trim(),
  }));
  return rows.filter((row) => row.part || row.location || row.students);
}

function updateCalculations() {
  const scenario = readForm();
  const calc = calculate(scenario);
  updateCourseSummaries(calc);
  $("totalFeeTop").textContent = money(calc.totalFee);
  $("subsidyTop").textContent = money(calc.subsidy);
  $("perStudentTop").textContent = money(calc.perStudent);
  $("summaryTitle").textContent = `${campLabel(scenario)}經費分攤`;
  $("teacherTotal").textContent = `${calc.teacherTotal} 人`;
  $("classCount").textContent = `${calc.classCount} 堂`;
  $("periodTotal").textContent = `${scenario.periods.length} 段`;
  $("totalFee").textContent = money(calc.totalFee);
  $("selfPayTotal").textContent = money(calc.selfPayTotal);
  $("perStudent").textContent = money(calc.perStudent);
  $("dateRangeText").textContent = periodRangeText(scenario);
  $("noticeTitle").textContent = `${scenario.ensembleName}${campLabel(scenario)}繳費通知單`;
  $("noticeBody").innerHTML = noticePreviewHtml(scenario, calc);
  $("scenarioBadge").textContent = dirty ? "未儲存" : "已儲存";
  renderScenarioList();
}

function updateCourseSummaries(calc) {
  calc.courseDetails.forEach((course) => {
    const sessions = $(`course-${course.key}-sessions`);
    const subtotal = $(`course-${course.key}-subtotal`);
    if (sessions) sessions.textContent = `${course.sessions} 節`;
    if (subtotal) subtotal.textContent = money(course.subtotal);
  });
}

function periodRangeText(scenario) {
  const starts = scenario.periods.map((p) => p.startDate).filter(Boolean).sort();
  const ends = scenario.periods.map((p) => p.endDate).filter(Boolean).sort();
  if (!starts.length && !ends.length) return "未設定";
  return `${dateText(starts[0])} 至 ${dateText(ends.at(-1) || starts[0])}`;
}

function updateCampTabs() {
  const scenario = getActive();
  $("winterTab").classList.toggle("active", scenario.campType === "winter");
  $("summerTab").classList.toggle("active", scenario.campType === "summer");
}

function renderScenarioList() {
  const list = $("scenarioList");
  list.innerHTML = "";
  scenarios.forEach((scenario) => {
    const calc = calculate(scenario);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `scenario-item${scenario.id === activeId ? " active" : ""}`;
    button.innerHTML = `${escapeHtml(scenario.name)}<span>${campLabel(scenario)}・${scenario.periods.length} 段・每生 ${money(
      calc.perStudent,
    )}</span>`;
    button.addEventListener("click", () => {
      activeId = scenario.id;
      dirty = false;
      writeForm(scenario);
    });
    list.append(button);
  });
}

function persist() {
  readForm();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
  dirty = false;
  $("saveStatus").textContent = `已儲存 ${new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  updateCalculations();
}

function markDirty() {
  dirty = true;
  updateCalculations();
}

$("loginForm").addEventListener("submit", handleLogin);
$("togglePasswordBtn").addEventListener("click", () => {
  const password = $("loginPassword");
  password.type = password.type === "password" ? "text" : "password";
  $("togglePasswordBtn").setAttribute("aria-label", password.type === "password" ? "顯示密碼" : "隱藏密碼");
});

document.addEventListener("input", (event) => {
  if (event.target.closest(".workspace") || event.target.closest(".sidebar")) markDirty();
});

document.querySelectorAll("[data-camp]").forEach((button) => {
  button.addEventListener("click", () => {
    getActive().campType = button.dataset.camp;
    dirty = true;
    updateCampTabs();
    updateCalculations();
  });
});

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.panel === tab);
    });
  });
});

$("addPeriodBtn").addEventListener("click", () => {
  const scenario = readForm();
  scenario.periods.push({
    id: crypto.randomUUID(),
    name: `第${scenario.periods.length + 1}階段`,
    startDate: "",
    endDate: "",
    sectionalSessions: 0,
    ensembleSessions: 0,
  });
  dirty = true;
  renderPeriodRows(scenario);
  updateCalculations();
});

$("periodRows").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-period");
  if (!button) return;
  const scenario = readForm();
  const id = button.closest(".period-row").dataset.id;
  scenario.periods = scenario.periods.filter((period) => period.id !== id);
  if (!scenario.periods.length) {
    scenario.periods.push({
      id: crypto.randomUUID(),
      name: "第一階段",
      startDate: "",
      endDate: "",
      sectionalSessions: 0,
      ensembleSessions: 0,
    });
  }
  dirty = true;
  renderPeriodRows(scenario);
  updateCalculations();
});

$("addSectionRowBtn").addEventListener("click", () => {
  const scenario = readForm();
  scenario.sectionGroups.push({
    id: crypto.randomUUID(),
    part: "",
    location: "",
    students: "",
  });
  dirty = true;
  renderSectionGroupRows(scenario);
  updateCalculations();
});

$("sectionRosterRows").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-section-row");
  if (!button) return;
  const scenario = readForm();
  const id = button.closest(".roster-row").dataset.id;
  scenario.sectionGroups = scenario.sectionGroups.filter((group) => group.id !== id);
  if (!scenario.sectionGroups.length) {
    scenario.sectionGroups.push({ id: crypto.randomUUID(), part: "", location: "", students: "" });
  }
  dirty = true;
  renderSectionGroupRows(scenario);
  updateCalculations();
});

$("newScenarioBtn").addEventListener("click", () => {
  const scenario = defaultScenario();
  scenario.name = `新${campLabel(scenario)}情境`;
  scenarios.unshift(scenario);
  activeId = scenario.id;
  dirty = true;
  writeForm(scenario);
});

$("duplicateScenarioBtn").addEventListener("click", () => {
  const copy = structuredClone(readForm());
  copy.id = crypto.randomUUID();
  copy.name = `${copy.name} 副本`;
  copy.updatedAt = new Date().toISOString();
  scenarios.unshift(copy);
  activeId = copy.id;
  dirty = true;
  writeForm(copy);
});

$("saveScenarioBtn").addEventListener("click", persist);
$("exportJsonBtn").addEventListener("click", () => {
  readForm();
  downloadBlob(
    new Blob([JSON.stringify(scenarios, null, 2)], { type: "application/json;charset=utf-8" }),
    `音樂班經費情境備份-${isoDate(new Date())}.json`,
  );
});

$("importJsonInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const imported = JSON.parse(await file.text());
  if (!Array.isArray(imported) || !imported.length) return;
  scenarios = imported.map(normalizeScenario);
  activeId = scenarios[0].id;
  persist();
  writeForm(scenarios[0]);
});

$("connectDriveBtn").addEventListener("click", connectDrive);
$("uploadDriveBtn").addEventListener("click", uploadDriveBackup);
$("loadDriveBtn").addEventListener("click", loadDriveBackup);
$("logoutBtn").addEventListener("click", logout);
$("downloadBudgetPdf").addEventListener("click", () => exportPdf("budget"));
$("downloadNoticePdf").addEventListener("click", () => exportPdf("notice"));
$("downloadBudgetXlsx").addEventListener("click", exportXlsx);
$("downloadNoticeDocx").addEventListener("click", exportNoticeDocx);

function reportRows(scenario = readForm()) {
  const calc = calculate(scenario);
  const courseRows = calc.courseDetails.flatMap((course) => [
    [`${course.label}老師人數`, `${course.teachers} 人`],
    [`${course.label}累計節數`, `${course.sessions} 節`],
    [`${course.label}每堂單價`, money(course.rate)],
    [`${course.label}小計`, money(course.subtotal)],
  ]);
  const periodRows = scenario.periods.flatMap((period, index) => [
    [`階段 ${index + 1}`, period.name],
    [`階段 ${index + 1} 日期`, `${dateText(period.startDate)} 至 ${dateText(period.endDate)}`],
    [`階段 ${index + 1} 節數`, `分部 ${period.sectionalSessions} 節、合奏 ${period.ensembleSessions} 節`],
  ]);
  return [
    ["情境名稱", scenario.name],
    ["訓練類型", campLabel(scenario)],
    ["總期程", periodRangeText(scenario)],
    ...periodRows,
    ...courseRows,
    ["教師鐘點堂數", `${calc.classCount} 堂`],
    ["鐘點費總額", money(calc.totalFee)],
    ["公費補助", money(calc.subsidy)],
    ["學生需分攤總額", money(calc.selfPayTotal)],
    ["弦樂 A 團學生人數", `${scenario.studentCount} 人`],
    ["每生應繳", money(calc.perStudent)],
  ];
}

function reminderLines(scenario) {
  return String(scenario.reminders || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function rosterRows(scenario) {
  const groups = normalizeSectionGroups(scenario.sectionGroups, scenario.sectionRoster);
  return groups
    .filter((group) => group.part || group.location || group.students)
    .map((group) => [group.part || "", group.location || "", group.students || ""]);
}

function noticeDateText(scenario) {
  if (!scenario.noticeDate) return "";
  const [year, month, day] = scenario.noticeDate.split("-").map(Number);
  if (!year) return dateText(scenario.noticeDate);
  const roc = year - 1911;
  return `${roc}.${pad2(month)}.${pad2(day)}`;
}

function periodSummaryText(scenario) {
  return scenario.periods
    .map((period) => `${period.name}：${dateText(period.startDate)} 至 ${dateText(period.endDate)}`)
    .join("\n");
}

function sessionDaysText(scenario) {
  const days = scenario.periods.reduce((sum, period) => sum + inclusiveDays(period.startDate, period.endDate), 0);
  return days ? `共 ${days} 日` : `${scenario.periods.length} 階段`;
}

function inclusiveDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function noticeSummaryRows(scenario, calc) {
  const camp = campLabel(scenario);
  return [
    ["訓練對象", `${scenario.ensembleName}團員`, `${scenario.studentCount} 人`],
    [`${camp}日期`, periodSummaryText(scenario), sessionDaysText(scenario)],
    ["費用計算", `${camp}團練費用 ${money(calc.totalFee)} - 公費補助 ${money(calc.subsidy)} = ${money(calc.selfPayTotal)}`, `每生 ${money(calc.perStudent)}`],
    ["繳費期限", dateText(scenario.paymentDue), scenario.paymentNote || "請交各班術導"],
    ["收款方式", scenario.collectionMethod || "", "逾期請先告知"],
  ];
}

function noticeScheduleRows(scenario) {
  return scenario.periods.map((period) => [
    period.name,
    `${dateText(period.startDate)} 至 ${dateText(period.endDate)}`,
    `分部 ${period.sectionalSessions} 節\n合奏 ${period.ensembleSessions} 節`,
  ]);
}

function noticeScheduleDetailRows(scenario) {
  return scenario.periods.flatMap((period) => [
    [period.name, `${dateText(period.startDate)} 至 ${dateText(period.endDate)}\n09:00-12:00`, "分部課程", "各分部教室", "各分部老師"],
    [period.name, `${dateText(period.startDate)} 至 ${dateText(period.endDate)}\n09:00-12:00`, "合奏課程", "二樓團輔教室", "指揮老師"],
  ]);
}

function budgetReportSections(scenario, calc) {
  return [
    {
      title: "一、經費摘要",
      headers: ["項目", "內容", "說明"],
      rows: [
        ["情境名稱", scenario.name, campLabel(scenario)],
        ["總期程", periodRangeText(scenario), `${scenario.periods.length} 個階段`],
        ["外聘老師合計", `${calc.teacherTotal} 人`, `教師鐘點堂數 ${calc.classCount} 堂`],
        ["鐘點費總額", money(calc.totalFee), "分部課與合奏課程合計"],
      ],
    },
    {
      title: "二、課程與師資明細",
      headers: ["課程類型", "老師人數", "累計節數", "每堂單價", "小計"],
      rows: calc.courseDetails.map((course) => [
        course.label,
        `${course.teachers} 人`,
        `${course.sessions} 節`,
        money(course.rate),
        money(course.subtotal),
      ]),
    },
    {
      title: "三、階段期程與節數",
      headers: ["階段", "日期", "分部節數", "合奏節數", "合計節數"],
      rows: scenario.periods.map((period) => [
        period.name,
        `${dateText(period.startDate)} 至 ${dateText(period.endDate)}`,
        `${period.sectionalSessions} 節`,
        `${period.ensembleSessions} 節`,
        `${Number(period.sectionalSessions || 0) + Number(period.ensembleSessions || 0)} 節`,
      ]),
    },
    {
      title: "四、公費與學生分攤",
      headers: ["項目", "金額 / 人數", "計算說明"],
      rows: [
        ["鐘點費總額", money(calc.totalFee), "課程明細小計加總"],
        ["公費補助", money(calc.subsidy), "以設定額度為上限，最高不超過總額"],
        ["學生需分攤總額", money(calc.selfPayTotal), "鐘點費總額 - 公費補助"],
        [`${scenario.ensembleName}學生人數`, `${scenario.studentCount} 人`, "作為平均分攤人數"],
        ["每生應繳", money(calc.perStudent), "學生需分攤總額 / 學生人數，採無條件進位"],
      ],
    },
  ];
}

function noticePreviewHtml(scenario, calc) {
  const reminders = reminderLines(scenario).slice(0, 3);
  const summaryRows = noticeSummaryRows(scenario, calc)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1]).replaceAll("\n", "<br>")}</td><td>${escapeHtml(row[2]).replaceAll("\n", "<br>")}</td></tr>`,
    )
    .join("");
  const scheduleRows = noticeScheduleRows(scenario)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2]).replaceAll("\n", "<br>")}</td></tr>`,
    )
    .join("");
  const rosterHtml = rosterRows(scenario)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2]).replaceAll("\n", "<br>")}</td></tr>`,
    )
    .join("");
  return `
    <div class="notice-doc">
      <div class="notice-doc-title">${escapeHtml(scenario.schoolName)}${escapeHtml(scenario.ensembleName)} ${escapeHtml(scenario.schoolYear)} 年${campLabel(scenario)}暨繳費通知單</div>
      <div class="notice-doc-subtitle">敬請家長協助學生預留${campLabel(scenario)}時間，並於期限前完成繳費。</div>
      <div class="notice-section-title">一、繳費與${campLabel(scenario)}重點</div>
      <table class="notice-mini-table">
        <tr><th>項目</th><th>內容</th><th>提醒</th></tr>
        ${summaryRows}
      </table>
      <div class="notice-section-title">二、重要提醒</div>
      <div>${reminders.map((line) => `• ${escapeHtml(line)}`).join("<br>")}</div>
      <div class="notice-section-title">三、上課日期與課程安排</div>
      <table class="notice-mini-table"><tr><th>階段</th><th>日期</th><th>節數</th></tr>${scheduleRows}</table>
      <div class="notice-section-title">四、分部課程地點與學生</div>
      <table class="notice-mini-table"><tr><th>分部</th><th>上課地點</th><th>學生</th></tr>${rosterHtml}</table>
      <div class="notice-page">第 1 / 1 頁</div>
    </div>`;
}

function exportPdf(type) {
  const scenario = readForm();
  const calc = calculate(scenario);
  const blob = type === "notice" ? createNoticePdf(scenario, calc) : createBudgetPdf(scenario, calc);
  downloadBlob(blob, `${scenario.name}-${type === "notice" ? "繳費通知單" : "經費分攤報表"}.pdf`);
}

function createNoticePdf(scenario, calc) {
  const width = 1240;
  const height = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  setupPdfCanvas(ctx, width, height);
  let y = 92;
  const camp = campLabel(scenario);
  y = drawPdfTitle(ctx, `${scenario.schoolName}${scenario.ensembleName} ${scenario.schoolYear} 年${camp}暨繳費通知單`, y);
  ctx.fillStyle = "#555555";
  ctx.font = '24px "Microsoft JhengHei", sans-serif';
  drawCenteredText(ctx, `敬請家長協助學生預留${camp}時間，並於期限前完成繳費。`, width / 2, y + 8);
  y += 72;
  y = drawPdfSection(ctx, `一、繳費與${camp}重點`, y);
  y = drawCanvasTable(ctx, ["項目", "內容", "提醒"], noticeSummaryRows(scenario, calc), [180, 700, 220], 90, y, {
    headerFill: "#fff5de",
    fontSize: 21,
  });
  y = drawPdfSection(ctx, "二、重要提醒", y + 24);
  reminderLines(scenario).forEach((line) => {
    wrapCanvasText(ctx, `• ${line}`, 1040).forEach((part) => {
      ctx.fillStyle = "#202332";
      ctx.font = '24px "Microsoft JhengHei", sans-serif';
      ctx.fillText(part, 98, y);
      y += 34;
    });
  });
  y = drawPdfSection(ctx, "三、上課日期與課程安排", y + 18);
  y = drawCanvasTable(ctx, ["階段", "日期與時間", "課程", "地點", "老師"], noticeScheduleDetailRows(scenario), [150, 330, 170, 260, 190], 90, y, {
    headerFill: "#f2f4f7",
    fontSize: 20,
  });
  y = drawPdfSection(ctx, "四、分部課程地點與學生", y + 14);
  y = drawCanvasTable(ctx, ["分部", "上課地點", "學生"], rosterRows(scenario), [260, 270, 570], 90, y, {
    headerFill: "#f2f4f7",
    fontSize: 20,
  });
  drawPdfFooter(ctx, "繳費通知單", height);
  return imageDataToPdf(canvas.toDataURL("image/jpeg", 0.92), width, height);
}

function createBudgetPdf(scenario, calc) {
  const width = 1240;
  const height = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  setupPdfCanvas(ctx, width, height);
  let y = 92;
  y = drawPdfTitle(ctx, `${scenario.name} 經費分攤報表`, y);
  const sections = budgetReportSections(scenario, calc);
  sections.forEach((section, index) => {
    y = drawPdfSection(ctx, section.title, y + (index ? 18 : 0));
    y = drawCanvasTable(ctx, section.headers, section.rows, tableWidths(section.headers.length), 90, y, {
      headerFill: index === 3 ? "#fff5de" : "#f2f4f7",
      fontSize: 22,
    });
  });
  drawPdfFooter(ctx, "經費分攤報表", height);
  return imageDataToPdf(canvas.toDataURL("image/jpeg", 0.92), width, height);
}

function setupPdfCanvas(ctx, width, height) {
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#202332";
}

function drawPdfTitle(ctx, title, y) {
  ctx.fillStyle = "#202332";
  ctx.font = '700 42px "Microsoft JhengHei", sans-serif';
  drawCenteredText(ctx, title, 620, y);
  ctx.strokeStyle = "#236f73";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(90, y + 32);
  ctx.lineTo(1150, y + 32);
  ctx.stroke();
  return y + 86;
}

function drawPdfSection(ctx, title, y) {
  ctx.fillStyle = "#236f73";
  ctx.font = '700 28px "Microsoft JhengHei", sans-serif';
  ctx.fillText(title, 90, y);
  return y + 24;
}

function drawCenteredText(ctx, text, x, y) {
  ctx.fillText(text, x - ctx.measureText(text).width / 2, y);
}

function drawCanvasTable(ctx, headers, rows, widths, x, y, options = {}) {
  const fontSize = options.fontSize || 22;
  const paddingX = 14;
  const paddingY = 12;
  const lineHeight = fontSize + 8;
  const allRows = [headers, ...rows];
  allRows.forEach((row, rowIndex) => {
    const linesByCell = row.map((cell, index) => {
      ctx.font = `${rowIndex === 0 ? "700" : "400"} ${fontSize}px "Microsoft JhengHei", sans-serif`;
      return String(cell || "")
        .split("\n")
        .flatMap((line) => wrapCanvasText(ctx, line, widths[index] - paddingX * 2));
    });
    const rowHeight = Math.max(48, Math.max(...linesByCell.map((lines) => lines.length)) * lineHeight + paddingY * 2);
    let cx = x;
    row.forEach((cell, index) => {
      ctx.fillStyle = rowIndex === 0 ? options.headerFill || "#f2f4f7" : "#fffdfa";
      ctx.fillRect(cx, y, widths[index], rowHeight);
      ctx.strokeStyle = "#d8d1c5";
      ctx.lineWidth = 1;
      ctx.strokeRect(cx, y, widths[index], rowHeight);
      ctx.fillStyle = "#202332";
      ctx.font = `${rowIndex === 0 ? "700" : "400"} ${fontSize}px "Microsoft JhengHei", sans-serif`;
      linesByCell[index].forEach((line, lineIndex) => {
        ctx.fillText(line, cx + paddingX, y + paddingY + fontSize + lineIndex * lineHeight);
      });
      cx += widths[index];
    });
    y += rowHeight;
  });
  return y + 10;
}

function tableWidths(count) {
  if (count === 5) return [210, 180, 190, 220, 300];
  return [210, 620, 270];
}

function drawPdfFooter(ctx, label, height) {
  ctx.fillStyle = "#69707d";
  ctx.font = '22px "Microsoft JhengHei", sans-serif';
  ctx.fillText(`${label}・第 1 / 1 頁・${new Date().toLocaleDateString("zh-TW")}`, 90, height - 70);
}

function wrapCanvasText(ctx, text, maxWidth) {
  if (!text) return [""];
  const lines = [];
  let current = "";
  [...text].forEach((char) => {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function imageDataToPdf(dataUrl, width, height) {
  const binary = atob(dataUrl.split(",")[1]);
  const image = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
  objects.push([
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    image,
    "\nendstream",
  ]);
  objects.push("<< /Length 40 >>\nstream\nq 595 0 0 842 0 0 cm /Im0 Do Q\nendstream");
  return pdfBlob(objects);
}

function pdfBlob(objects) {
  const encoder = new TextEncoder();
  const parts = [encoder.encode("%PDF-1.4\n")];
  const offsets = [];
  objects.forEach((obj, index) => {
    offsets.push(byteLength(parts));
    parts.push(encoder.encode(`${index + 1} 0 obj\n`));
    if (Array.isArray(obj)) {
      obj.forEach((part) => parts.push(typeof part === "string" ? encoder.encode(part) : part));
      parts.push(encoder.encode("\nendobj\n"));
    } else {
      parts.push(encoder.encode(`${obj}\nendobj\n`));
    }
  });
  const xref = byteLength(parts);
  parts.push(encoder.encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  offsets.forEach((offset) => parts.push(encoder.encode(`${String(offset).padStart(10, "0")} 00000 n \n`)));
  parts.push(encoder.encode(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob(parts, { type: "application/pdf" });
}

function byteLength(parts) {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function exportXlsx() {
  const scenario = readForm();
  const calc = calculate(scenario);
  const rows = [[`${scenario.name} 經費分攤報表`], []];
  budgetReportSections(scenario, calc).forEach((section) => {
    rows.push([section.title]);
    rows.push(section.headers);
    section.rows.forEach((row) => rows.push(row));
    rows.push([]);
  });
  const sheetRows = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((cell, col) => {
            const ref = `${columnName(col)}${index + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const cols = [24, 24, 24, 18, 22]
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  downloadBlob(
    zipFiles({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="經費分攤" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
    }),
    `${scenario.name}-經費分攤.xlsx`,
  );
}

function columnName(index) {
  let name = "";
  index += 1;
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function exportNoticeDocx() {
  const scenario = readForm();
  const calc = calculate(scenario);
  const camp = campLabel(scenario);
  const body = [
    wParagraph(`${scenario.schoolName}${scenario.ensembleName} ${scenario.schoolYear} 年${camp}暨繳費通知單`, {
      size: 38,
      bold: true,
      align: "center",
      after: 40,
    }),
    wParagraph(`敬請家長協助學生預留${camp}時間，並於期限前完成繳費。`, {
      size: 22,
      align: "center",
      color: "555555",
      after: 100,
    }),
    wHeading(`一、繳費與${camp}重點`),
    wTable(["項目", "內容", "提醒"], noticeSummaryRows(scenario, calc), [1871, 5726, 2721], "FFF5DE"),
    wHeading("二、重要提醒"),
    ...reminderLines(scenario).map((line) => wParagraph(`• ${line}`, { size: 22, after: 30 })),
    wHeading("三、上課日期與課程安排"),
    wTable(["階段", "日期與時間", "課程", "地點", "老師"], noticeScheduleDetailRows(scenario), [1389, 3090, 1559, 2353, 1928], "F2F4F7"),
    wHeading("四、分部課程地點與學生"),
    wTable(["分部", "上課地點", "學生"], rosterRows(scenario), [2409, 2580, 5329], "F2F4F7"),
    wParagraph("敬祝  闔家平安", { size: 21, before: 80 }),
    wParagraph(`${scenario.organizerName || scenario.schoolName}  ${noticeDateText(scenario)}`, {
      size: 21,
      bold: true,
      align: "right",
    }),
  ].join("");
  downloadBlob(
    zipFiles({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
      "word/footer1.xml": `<?xml version="1.0" encoding="UTF-8"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${wFooterParagraph()}</w:ftr>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:footer="360"/></w:sectPr></w:body></w:document>`,
    }),
    `${scenario.name}-繳費通知單.docx`,
  );
}

function wParagraph(text, options = {}) {
  const align = options.align ? `<w:jc w:val="${options.align}"/>` : "";
  const spacing = `<w:spacing w:before="${options.before || 0}" w:after="${options.after ?? 60}"/>`;
  const runProps = `<w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei" w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei"/>${
    options.bold ? "<w:b/>" : ""
  }<w:color w:val="${options.color || "202332"}"/><w:sz w:val="${options.size || 22}"/></w:rPr>`;
  return `<w:p><w:pPr>${spacing}${align}</w:pPr>${wRuns(text, runProps)}</w:p>`;
}

function wHeading(text) {
  return wParagraph(text, { size: 28, bold: true, color: "236F73", before: 110, after: 45 });
}

function wFooterParagraph() {
  const props =
    '<w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei" w:ascii="Microsoft JhengHei" w:hAnsi="Microsoft JhengHei"/><w:color w:val="555555"/><w:sz w:val="19"/></w:rPr>';
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${props}<w:t>第 </w:t></w:r>${wField(
    "PAGE",
    "1",
    props,
  )}<w:r>${props}<w:t> / </w:t></w:r>${wField("NUMPAGES", "1", props)}<w:r>${props}<w:t> 頁</w:t></w:r></w:p>`;
}

function wField(instruction, fallback, props) {
  return `<w:r>${props}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${props}<w:instrText xml:space="preserve">${instruction}</w:instrText></w:r><w:r>${props}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${props}<w:t>${fallback}</w:t></w:r><w:r>${props}<w:fldChar w:fldCharType="end"/></w:r>`;
}

function wRuns(text, runProps) {
  return String(text)
    .split("\n")
    .map((part, index) => `${index ? "<w:r><w:br/></w:r>" : ""}<w:r>${runProps}<w:t>${xml(part)}</w:t></w:r>`)
    .join("");
}

function wTable(headers, rows, widths, fill) {
  const grid = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const header = wRow(headers, widths, true, fill);
  const body = rows.map((row) => wRow(row, widths, false)).join("");
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  return `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="70" w:type="dxa"/><w:start w:w="135" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:end w:w="135" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="6" w:color="DADCE0"/><w:left w:val="single" w:sz="6" w:color="DADCE0"/><w:bottom w:val="single" w:sz="6" w:color="DADCE0"/><w:right w:val="single" w:sz="6" w:color="DADCE0"/><w:insideH w:val="single" w:sz="6" w:color="DADCE0"/><w:insideV w:val="single" w:sz="6" w:color="DADCE0"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${header}${body}</w:tbl>`;
}

function wRow(cells, widths, header = false, fill = "") {
  const tcs = cells
    .map((cell, index) => {
      const shade = header && fill ? `<w:shd w:fill="${fill}"/>` : "";
      const align = index < 3 ? "center" : "left";
      return `<w:tc><w:tcPr><w:tcW w:w="${widths[index]}" w:type="dxa"/>${shade}</w:tcPr>${wParagraph(cell, {
        size: header ? 23 : 22,
        bold: header,
        align,
        after: 0,
      })}</w:tc>`;
    })
    .join("");
  return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${tcs}</w:tr>`;
}

async function connectDrive() {
  const scenario = readForm();
  if (!scenario.googleClientId) {
    updateDriveStatus("請先輸入 OAuth Client ID");
    return;
  }
  await loadGoogleIdentityScript();
  await new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: scenario.googleClientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) reject(new Error(response.error));
        driveToken = response.access_token;
        updateDriveStatus("已連接 Google Drive");
        resolve();
      },
    });
    tokenClient.requestAccessToken({ prompt: driveToken ? "" : "consent" });
  }).catch((error) => updateDriveStatus(`連線失敗：${error.message}`));
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("無法載入 Google Identity Services"));
    document.head.append(script);
  });
}

async function uploadDriveBackup() {
  if (!driveToken) await connectDrive();
  if (!driveToken) return;
  readForm();
  const metadata = {
    name: DRIVE_FILE_NAME,
    mimeType: "application/json",
  };
  const content = new Blob([JSON.stringify(scenarios, null, 2)], { type: "application/json" });
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", content);
  const url = driveFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await fetch(url, {
    method: driveFileId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${driveToken}` },
    body: form,
  });
  if (!response.ok) {
    updateDriveStatus("雲端備份失敗");
    return;
  }
  const result = await response.json();
  driveFileId = result.id;
  localStorage.setItem("musicCampBudget.driveFileId", driveFileId);
  updateDriveStatus("已備份到 Google Drive");
}

async function loadDriveBackup() {
  if (!driveToken) await connectDrive();
  if (!driveToken) return;
  if (!driveFileId) {
    const query = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
    const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`, {
      headers: { Authorization: `Bearer ${driveToken}` },
    });
    const result = await list.json();
    driveFileId = result.files?.[0]?.id || "";
  }
  if (!driveFileId) {
    updateDriveStatus("找不到雲端備份");
    return;
  }
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${driveToken}` },
  });
  if (!response.ok) {
    updateDriveStatus("讀取雲端備份失敗");
    return;
  }
  scenarios = (await response.json()).map(normalizeScenario);
  activeId = scenarios[0].id;
  persist();
  writeForm(scenarios[0]);
  updateDriveStatus("已讀取 Google Drive 備份");
}

function updateDriveStatus(message) {
  if (message) $("driveStatus").textContent = message;
  else $("driveStatus").textContent = driveToken ? "已連接 Google Drive" : driveFileId ? "已有雲端備份紀錄" : "尚未連接";
}

function zipFiles(files) {
  const encoder = new TextEncoder();
  const fileEntries = Object.entries(files).map(([name, content]) => ({
    name,
    data: encoder.encode(content),
  }));
  const chunks = [];
  const central = [];
  let offset = 0;
  fileEntries.forEach((file) => {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    chunks.push(local);
    central.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  });
  const centralDir = concatBytes(central);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(fileEntries.length),
    u16(fileEntries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return new Blob([...chunks, centralDir, end], { type: "application/zip" });
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function u16(value) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtml(text) {
  return xml(text);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

writeForm(getActive());
persist();
initAuthGate();
