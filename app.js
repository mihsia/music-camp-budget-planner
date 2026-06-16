const STORAGE_KEY = "musicCampBudgetScenarios.v2";
const LEGACY_STORAGE_KEY = "musicCampBudgetScenarios.v1";
const DRIVE_FILE_NAME = "音樂班寒暑訓經費規劃備份.json";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

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

let scenarios = loadScenarios();
let activeId = scenarios[0].id;
let dirty = false;
let driveToken = "";
let driveFileId = localStorage.getItem("musicCampBudget.driveFileId") || "";

function defaultScenario() {
  return {
    id: crypto.randomUUID(),
    name: "115年弦樂 A 團暑訓",
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
    paymentNote: "請交予音樂班辦公室，或依學校公告方式完成繳費。",
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
    googleClientId: raw.googleClientId || localStorage.getItem("musicCampBudget.googleClientId") || "",
  };
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
  $("scenarioName").value = scenario.name;
  $("studentCount").value = scenario.studentCount;
  $("publicSubsidy").value = scenario.publicSubsidy;
  $("paymentDue").value = scenario.paymentDue;
  $("paymentNote").value = scenario.paymentNote;
  $("googleClientId").value = scenario.googleClientId || "";
  renderCourseRows(scenario);
  renderPeriodRows(scenario);
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
          <button class="icon-action remove-period" type="button" aria-label="刪除此階段">×</button>
        </div>`,
    )
    .join("");
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
  $("noticeTitle").textContent = `弦樂 A 團${campLabel(scenario)}繳費通知單`;
  $("noticeBody").textContent = `每生應繳 ${money(calc.perStudent)}，請於 ${dateText(
    scenario.paymentDue,
  )} 前完成繳費。${scenario.paymentNote}`;
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
  if (!event.target.classList.contains("remove-period")) return;
  const scenario = readForm();
  const id = event.target.closest(".period-row").dataset.id;
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

function exportPdf(type) {
  const scenario = readForm();
  const calc = calculate(scenario);
  const lines =
    type === "notice"
      ? [
          `弦樂 A 團${campLabel(scenario)}繳費通知單`,
          "",
          "親愛的家長您好：",
          `本次${campLabel(scenario)}分為 ${scenario.periods.length} 個上課階段，總期程為 ${periodRangeText(
            scenario,
          )}。外聘師資鐘點費扣除公費補助後，由弦樂 A 團學生平均分攤。`,
          "",
          `每生應繳：${money(calc.perStudent)}`,
          `繳費期限：${dateText(scenario.paymentDue)}`,
          `備註：${scenario.paymentNote || "無"}`,
        ]
      : [`${scenario.name} 經費分攤報表`, "", ...reportRows(scenario).map((r) => `${r[0]}：${r[1]}`)];
  const blob = createCanvasPdf(lines, type === "notice" ? "繳費通知單" : "經費分攤報表");
  downloadBlob(blob, `${scenario.name}-${type === "notice" ? "繳費通知單" : "經費分攤報表"}.pdf`);
}

function createCanvasPdf(lines, footer) {
  const width = 1240;
  const height = 1754;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#202332";
  ctx.font = '700 48px "Microsoft JhengHei", sans-serif';
  ctx.fillText(lines[0], 90, 125);
  ctx.strokeStyle = "#b8872f";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(90, 154);
  ctx.lineTo(1150, 154);
  ctx.stroke();
  ctx.font = '30px "Microsoft JhengHei", sans-serif';
  let y = 225;
  lines.slice(1).forEach((line) => {
    wrapCanvasText(ctx, line, 1060).forEach((part) => {
      if (y < height - 130) ctx.fillText(part, 90, y);
      y += 48;
    });
    if (!line) y += 14;
  });
  ctx.fillStyle = "#69707d";
  ctx.font = '24px "Microsoft JhengHei", sans-serif';
  ctx.fillText(`${footer}・${new Date().toLocaleDateString("zh-TW")}`, 90, height - 80);
  return imageDataToPdf(canvas.toDataURL("image/jpeg", 0.92), width, height);
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
  const rows = [["項目", "內容"], ...reportRows(scenario)];
  const sheetRows = rows
    .map(
      (row, index) =>
        `<row r="${index + 1}">${row
          .map((cell, col) => {
            const ref = `${col === 0 ? "A" : "B"}${index + 1}`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  downloadBlob(
    zipFiles({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="經費分攤" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    }),
    `${scenario.name}-經費分攤.xlsx`,
  );
}

function exportNoticeDocx() {
  const scenario = readForm();
  const calc = calculate(scenario);
  const paragraphs = [
    `弦樂 A 團${campLabel(scenario)}繳費通知單`,
    "親愛的家長您好：",
    `本次${campLabel(scenario)}分為 ${scenario.periods.length} 個上課階段，總期程為 ${periodRangeText(
      scenario,
    )}。外聘師資鐘點費扣除公費補助後，由弦樂 A 團學生平均分攤。`,
    `每生應繳：${money(calc.perStudent)}`,
    `繳費期限：${dateText(scenario.paymentDue)}`,
    `備註：${scenario.paymentNote || "無"}`,
  ];
  const body = paragraphs
    .map(
      (p) =>
        `<w:p><w:r><w:rPr><w:rFonts w:eastAsia="Microsoft JhengHei"/></w:rPr><w:t>${xml(p)}</w:t></w:r></w:p>`,
    )
    .join("");
  downloadBlob(
    zipFiles({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
    }),
    `${scenario.name}-繳費通知單.docx`,
  );
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
