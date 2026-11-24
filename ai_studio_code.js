(function () {
  "use strict";

  const STORAGE_KEY = "student_payment_tracker_v1";
  const GATEWAYS = ["InstaPay", "Vodafone Cash", "Cash", "Bank Transfer"];

  const GATEWAY_ICONS = {
    "InstaPay": "📱",
    "Vodafone Cash": "🔴",
    "Cash": "💵",
    "Bank Transfer": "🏦"
  };

  let selectedMonth = getCurrentMonth();
  let state = loadState();

  // ---------- Utility Helpers ----------
  function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatMonthLabel(ym) {
    if (!ym || !ym.includes("-")) return ym || "—";
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(d);
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(amount, currency) {
    const cur = currency || state.settings.defaultCurrency || "EGP";
    const num = round2(amount || 0);
    const formatted = num.toLocaleString("en-US", {
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2
    });
    return `${formatted} ${cur}`;
  }

  function formatCurrencyTotals(totalsObj) {
    const entries = Object.entries(totalsObj).filter(([, val]) => val > 0);
    if (entries.length === 0) return formatMoney(0, state.settings.defaultCurrency);
    return entries.map(([cur, val]) => formatMoney(val, cur)).join(" + ");
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function generateReceiptNo(billingMonth) {
    const ymCompact = (billingMonth || getCurrentMonth()).replace("-", "");
    const seq = String(state.payments.length + 1).padStart(4, "0");
    const rand = Math.floor(10 + Math.random() * 90);
    return `RCP-${ymCompact}-${seq}${rand}`;
  }

  // ---------- Storage ----------
  function defaultState() {
    return {
      settings: {
        tutorName: "Student Payment Tracker",
        tutorSubtitle: "Private Tutoring & Dues Ledger",
        tutorPhone: "",
        defaultCurrency: "EGP"
      },
      groups: [],
      students: [],
      payments: []
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const def = defaultState();
      return {
        settings: { ...def.settings, ...(parsed.settings || {}) },
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        students: Array.isArray(parsed.students) ? parsed.students : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : []
      };
    } catch (err) {
      console.error("Failed to read localStorage:", err);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      showToast("Warning: Browser storage quota reached or disabled.");
    }
  }

  // ---------- Domain Logic ----------
  function getGroupById(id) {
    return state.groups.find(g => g.id === id) || null;
  }

  function getStudentById(id) {
    return state.students.find(s => s.id === id) || null;
  }

  function getEffectiveFee(student, group) {
    if (student && student.customFee !== null && student.customFee !== undefined && student.customFee !== "") {
      return round2(Number(student.customFee));
    }
    return group ? round2(Number(group.standardFee)) : 0;
  }

  function getStudentCurrency(student, group) {
    return group ? group.currency : (state.settings.defaultCurrency || "EGP");
  }

  function getStudentMonthSummary(student, month) {
    const group = getGroupById(student.groupId);
    const expectedFee = getEffectiveFee(student, group);
    const currency = getStudentCurrency(student, group);
    const monthPayments = state.payments.filter(
      p => p.studentId === student.id && p.billingMonth === month
    );
    const paidAmount = round2(monthPayments.reduce((sum, p) => sum + Number(p.amountPaid || 0), 0));
    const remaining = round2(Math.max(0, expectedFee - paidAmount));

    let status = "Unpaid";
    if (paidAmount >= expectedFee) {
      status = "Paid";
    } else if (paidAmount > 0) {
      status = "Partial";
    }

    return {
      group,
      expectedFee,
      paidAmount,
      remaining,
      status,
      currency,
      payments: monthPayments
    };
  }

  // ---------- Toast Notification ----------
  function showToast(message, actionLabel, actionHandler) {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = "toast";

    const textSpan = document.createElement("span");
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (actionLabel && actionHandler) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-melon btn-sm";
      btn.textContent = actionLabel;
      btn.addEventListener("click", () => {
        actionHandler();
        toast.remove();
      });
      toast.appendChild(btn);
    }

    container.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 5500);
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderHeader();
    renderFastPayOptions();
    renderDashboardKPIs();
    renderDuesTable();
    renderPaymentsTab();
    renderStudentsTab();
    renderGroupsTab();
    renderSettingsTab();
  }

  function renderHeader() {
    document.getElementById("headerTutorName").textContent =
      state.settings.tutorName || "Student Payment Tracker";
    document.getElementById("headerTutorSub").textContent =
      state.settings.tutorSubtitle || "Private Tutoring & Dues Ledger";
    document.getElementById("billingMonthInput").value = selectedMonth;
    document.getElementById("defaultCurrencySelect").value = state.settings.defaultCurrency || "EGP";
    document.getElementById("fastPayMonthBadge").textContent = `Billing: ${formatMonthLabel(selectedMonth)}`;
    document.getElementById("duesMonthPill").textContent = formatMonthLabel(selectedMonth);
  }

  function renderDashboardKPIs() {
    const activeStudents = state.students.filter(s => s.status !== "paused");
    const expectedByCur = {};
    const collectedByCur = {};
    const outstandingByCur = {};
    let paidCount = 0;

    activeStudents.forEach(student => {
      const summary = getStudentMonthSummary(student, selectedMonth);
      expectedByCur[summary.currency] = round2((expectedByCur[summary.currency] || 0) + summary.expectedFee);
      outstandingByCur[summary.currency] = round2((outstandingByCur[summary.currency] || 0) + summary.remaining);
      if (summary.status === "Paid") paidCount++;
    });

    const monthPayments = state.payments.filter(p => p.billingMonth === selectedMonth);
    const gatewayByCur = {};
    GATEWAYS.forEach(gw => (gatewayByCur[gw] = {}));

    monthPayments.forEach(p => {
      const cur = p.currency || state.settings.defaultCurrency;
      collectedByCur[cur] = round2((collectedByCur[cur] || 0) + Number(p.amountPaid));
      if (!gatewayByCur[p.gateway]) gatewayByCur[p.gateway] = {};
      gatewayByCur[p.gateway][cur] = round2((gatewayByCur[p.gateway][cur] || 0) + Number(p.amountPaid));
    });

    const completionPct = activeStudents.length
      ? Math.round((paidCount / activeStudents.length) * 100)
      : 0;

    document.getElementById("kpiGrid").innerHTML = `
      <div class="kpi-card accent">
        <div class="kpi-label">Collected (${escapeHtml(formatMonthLabel(selectedMonth))})</div>
        <div class="kpi-value tabular">${escapeHtml(formatCurrencyTotals(collectedByCur))}</div>
        <div class="kpi-sub">${monthPayments.length} payment${monthPayments.length === 1 ? "" : "s"} logged</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Expected Monthly Dues</div>
        <div class="kpi-value tabular">${escapeHtml(formatCurrencyTotals(expectedByCur))}</div>
        <div class="kpi-sub">${activeStudents.length} active student${activeStudents.length === 1 ? "" : "s"}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding Balance</div>
        <div class="kpi-value tabular" style="color:var(--danger-text);">${escapeHtml(formatCurrencyTotals(outstandingByCur))}</div>
        <div class="kpi-sub">${activeStudents.length - paidCount} student${activeStudents.length - paidCount === 1 ? "" : "s"} remaining</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Monthly Collection Rate</div>
        <div class="kpi-value tabular">${completionPct}%</div>
        <div class="kpi-sub">${paidCount} of ${activeStudents.length} settled in full</div>
      </div>
    `;

    const strip = document.getElementById("gatewayBreakdown");
    strip.innerHTML = `<span class="gateway-strip-label">By Gateway (${escapeHtml(formatMonthLabel(selectedMonth))}):</span>` +
      GATEWAYS.map(gw => `
        <span class="gw-chip tabular">
          <span>${GATEWAY_ICONS[gw]} ${escapeHtml(gw)}:</span>
          <strong>${escapeHtml(formatCurrencyTotals(gatewayByCur[gw]))}</strong>
        </span>
      `).join("");
  }

  // ---------- Fast Payment Entry ----------
  function renderFastPayOptions(preserveSelection = true) {
    const activeStudents = state.students.filter(s => s.status !== "paused");
    const emptyBanner = document.getElementById("fastPayEmptyBanner");
    const formEl = document.getElementById("fastPayForm");

    if (state.groups.length === 0 || activeStudents.length === 0) {
      emptyBanner.style.display = "block";
      formEl.style.display = "none";
      return;
    } else {
      emptyBanner.style.display = "none";
      formEl.style.display = "grid";
    }

    const groupSelect = document.getElementById("fastPayGroup");
    const prevGroup = preserveSelection ? groupSelect.value : "";

    groupSelect.innerHTML = `<option value="all">All Groups (${state.groups.length})</option>` +
      state.groups.map(g =>
        `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${escapeHtml(formatMoney(g.standardFee, g.currency))})</option>`
      ).join("");

    if (prevGroup && (prevGroup === "all" || getGroupById(prevGroup))) {
      groupSelect.value = prevGroup;
    }

    populateFastPayStudents(preserveSelection);

    const monthInput = document.getElementById("fastPayMonth");
    if (!monthInput.value) monthInput.value = selectedMonth;
    const dateInput = document.getElementById("fastPayDate");
    if (!dateInput.value) dateInput.value = getTodayDate();
  }

  function populateFastPayStudents(preserveSelection = true) {
    const selectedGroupId = document.getElementById("fastPayGroup").value;
    const studentSelect = document.getElementById("fastPayStudent");
    const prevStudentId = preserveSelection ? studentSelect.value : "";
    const targetMonth = document.getElementById("fastPayMonth").value || selectedMonth;

    let list = state.students.filter(s => s.status !== "paused");
    if (selectedGroupId && selectedGroupId !== "all") {
      list = list.filter(s => s.groupId === selectedGroupId);
    }

    if (list.length === 0) {
      studentSelect.innerHTML = `<option value="">No active students in this group</option>`;
      updateFastPayStudentDetails();
      return;
    }

    studentSelect.innerHTML = `<option value="">— Select Student —</option>` +
      list.map(s => {
        const sum = getStudentMonthSummary(s, targetMonth);
        const gName = sum.group ? sum.group.name : "Unassigned";
        const statusHint = sum.remaining > 0
          ? `Due: ${formatMoney(sum.remaining, sum.currency)}`
          : "Settled";
        return `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} • ${escapeHtml(gName)} (${escapeHtml(statusHint)})</option>`;
      }).join("");

    if (prevStudentId && list.some(s => s.id === prevStudentId)) {
      studentSelect.value = prevStudentId;
    }
    updateFastPayStudentDetails();
  }

  function updateFastPayStudentDetails() {
    const studentId = document.getElementById("fastPayStudent").value;
    const targetMonth = document.getElementById("fastPayMonth").value || selectedMonth;
    const infoWrap = document.getElementById("fastPayStudentInfoWrap");
    const infoEl = document.getElementById("fastPayStudentInfo");
    const amountInput = document.getElementById("fastPayAmount");
    const curBadge = document.getElementById("fastPayCurrencyBadge");

    const student = getStudentById(studentId);
    if (!student) {
      infoWrap.style.display = "none";
      curBadge.textContent = state.settings.defaultCurrency || "EGP";
      return;
    }

    const sum = getStudentMonthSummary(student, targetMonth);
    curBadge.textContent = sum.currency;

    const suggestedAmount = sum.remaining > 0 ? sum.remaining : sum.expectedFee;
    amountInput.value = suggestedAmount;

    const rateBadge = student.customFee !== null && student.customFee !== undefined && student.customFee !== ""
      ? `<span class="badge badge-melon">Custom Rate</span>`
      : `<span class="badge badge-neutral">Group Fee</span>`;

    const statusClass = sum.status === "Paid" ? "badge-paid" : sum.status === "Partial" ? "badge-partial" : "badge-unpaid";

    infoWrap.style.display = "block";
    infoEl.innerHTML = `
      <span><strong>${escapeHtml(student.name)}</strong> ${rateBadge}</span>
      <span>• Subject: <strong>${escapeHtml(sum.group ? sum.group.subject : "—")}</strong></span>
      <span>• Agreed Fee: <strong class="tabular">${escapeHtml(formatMoney(sum.expectedFee, sum.currency))}</strong></span>
      <span>• Paid (${escapeHtml(formatMonthLabel(targetMonth))}): <strong class="tabular">${escapeHtml(formatMoney(sum.paidAmount, sum.currency))}</strong></span>
      <span>• Remaining: <strong class="tabular">${escapeHtml(formatMoney(sum.remaining, sum.currency))}</strong></span>
      <span class="badge ${statusClass}">${escapeHtml(sum.status)}</span>
    `;
  }

  function jumpToFastPay(studentId) {
    const student = getStudentById(studentId);
    if (!student) return;

    switchTab("dashboard");
    document.getElementById("fastPayGroup").value = student.groupId || "all";
    document.getElementById("fastPayMonth").value = selectedMonth;
    populateFastPayStudents(false);
    document.getElementById("fastPayStudent").value = student.id;
    updateFastPayStudentDetails();

    const card = document.getElementById("fastPayCard");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById("fastPayAmount").focus();
  }

  // ---------- Monthly Dues Table ----------
  function renderDuesTable() {
    const groupFilterEl = document.getElementById("duesGroupFilter");
    const prevGroupFilter = groupFilterEl.value || "all";
    groupFilterEl.innerHTML = `<option value="all">All Groups</option>` +
      state.groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
    if (prevGroupFilter === "all" || getGroupById(prevGroupFilter)) {
      groupFilterEl.value = prevGroupFilter;
    }

    const statusFilter = document.getElementById("duesStatusFilter").value;
    const searchQuery = document.getElementById("duesSearchInput").value.trim().toLowerCase();

    const rows = state.students
      .filter(s => s.status !== "paused")
      .map(s => ({ student: s, summary: getStudentMonthSummary(s, selectedMonth) }))
      .filter(({ student, summary }) => {
        if (groupFilterEl.value !== "all" && student.groupId !== groupFilterEl.value) return false;
        if (statusFilter !== "all" && summary.status !== statusFilter) return false;
        if (searchQuery) {
          const hay = `${student.name} ${student.phone || ""} ${summary.group ? summary.group.name : ""}`.toLowerCase();
          if (!hay.includes(searchQuery)) return false;
        }
        return true;
      });

    const tbody = document.getElementById("duesTableBody");
    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-state-icon">📋</div>
              <div class="empty-state-title">No matching students for ${escapeHtml(formatMonthLabel(selectedMonth))}</div>
              <div class="text-muted">Adjust filters or add active students in the Student Roster tab.</div>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = rows.map(({ student, summary }) => {
      const badgeClass = summary.status === "Paid"
        ? "badge-paid"
        : summary.status === "Partial"
          ? "badge-partial"
          : "badge-unpaid";
      const latestPayment = summary.payments.length ? summary.payments[summary.payments.length - 1] : null;
      const isCustom = student.customFee !== null && student.customFee !== undefined && student.customFee !== "";

      return `
        <tr>
          <td>
            <div class="font-bold">${escapeHtml(student.name)}</div>
            <div class="text-muted">${escapeHtml(student.phone || "No phone")}</div>
          </td>
          <td>
            <div class="font-bold">${escapeHtml(summary.group ? summary.group.name : "Unassigned")}</div>
            <div class="text-muted">${escapeHtml(summary.group ? summary.group.subject : "—")}</div>
          </td>
          <td class="text-right tabular">
            ${escapeHtml(formatMoney(summary.expectedFee, summary.currency))}
            ${isCustom ? `<div><span class="badge badge-melon" style="font-size:0.65rem;">Custom</span></div>` : ""}
          </td>
          <td class="text-right tabular font-bold">${escapeHtml(formatMoney(summary.paidAmount, summary.currency))}</td>
          <td class="text-right tabular" style="color:${summary.remaining > 0 ? "var(--danger-text)" : "var(--success-text)"}; font-weight:700;">
            ${escapeHtml(formatMoney(summary.remaining, summary.currency))}
          </td>
          <td><span class="badge ${badgeClass}">${escapeHtml(summary.status)}</span></td>
          <td class="text-right" style="white-space:nowrap;">
            ${latestPayment
              ? `<button type="button" class="btn btn-outline btn-sm" data-action="receipt" data-id="${escapeHtml(latestPayment.id)}" title="Print Latest Receipt">🖨️ Receipt</button>`
              : ""}
            <button type="button" class="btn ${summary.remaining > 0 ? "btn-primary" : "btn-outline"} btn-sm" data-action="pay" data-id="${escapeHtml(student.id)}">
              ${summary.remaining > 0 ? "💳 Log Pay" : "+ Add Pay"}
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ---------- Payments Log Tab ----------
  function renderPaymentsTab() {
    const monthFilterEl = document.getElementById("payMonthFilter");
    const prevMonth = monthFilterEl.value || "all";
    const monthsSet = new Set([selectedMonth, ...state.payments.map(p => p.billingMonth)]);
    const sortedMonths = Array.from(monthsSet).filter(Boolean).sort().reverse();

    monthFilterEl.innerHTML = `<option value="all">All Billing Months</option>` +
      sortedMonths.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(formatMonthLabel(m))}</option>`).join("");
    if (prevMonth === "all" || sortedMonths.includes(prevMonth)) {
      monthFilterEl.value = prevMonth;
    }

    const groupFilterEl = document.getElementById("payGroupFilter");
    const prevGroup = groupFilterEl.value || "all";
    groupFilterEl.innerHTML = `<option value="all">All Groups</option>` +
      state.groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
    if (prevGroup === "all" || getGroupById(prevGroup)) {
      groupFilterEl.value = prevGroup;
    }

    const gwFilter = document.getElementById("payGatewayFilter").value;
    const search = document.getElementById("paySearchInput").value.trim().toLowerCase();

    const filtered = state.payments
      .filter(p => {
        if (monthFilterEl.value !== "all" && p.billingMonth !== monthFilterEl.value) return false;
        if (groupFilterEl.value !== "all" && p.groupId !== groupFilterEl.value) return false;
        if (gwFilter !== "all" && p.gateway !== gwFilter) return false;
        if (search) {
          const hay = `${p.receiptNo} ${p.studentName} ${p.groupName} ${p.reference || ""}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    const tbody = document.getElementById("paymentsTableBody");
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-state-icon">🧾</div>
              <div class="empty-state-title">No payment transactions found</div>
              <div class="text-muted">Use Fast Payment Entry on the Dashboard to log payments.</div>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(p => `
      <tr>
        <td class="tabular font-bold">${escapeHtml(p.receiptNo)}</td>
        <td class="tabular">${escapeHtml(p.paymentDate)}</td>
        <td>
          <div class="font-bold">${escapeHtml(p.studentName)}</div>
          <div class="text-muted">${escapeHtml(p.groupName)}${p.reference ? ` • Ref: ${escapeHtml(p.reference)}` : ""}</div>
        </td>
        <td>${escapeHtml(formatMonthLabel(p.billingMonth))}</td>
        <td><span class="badge badge-neutral">${GATEWAY_ICONS[p.gateway] || ""} ${escapeHtml(p.gateway)}</span></td>
        <td class="text-right tabular font-bold">${escapeHtml(formatMoney(p.amountPaid, p.currency))}</td>
        <td class="text-right" style="white-space:nowrap;">
          <button type="button" class="btn btn-melon btn-sm" data-action="receipt" data-id="${escapeHtml(p.id)}">🖨️ Receipt</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="delete-payment" data-id="${escapeHtml(p.id)}">🗑</button>
        </td>
      </tr>
    `).join("");
  }

  // ---------- Students Tab ----------
  function renderStudentsTab() {
    const groupFilterEl = document.getElementById("studentGroupFilter");
    const prevGroup = groupFilterEl.value || "all";
    groupFilterEl.innerHTML = `<option value="all">All Groups</option>` +
      state.groups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join("");
    if (prevGroup === "all" || getGroupById(prevGroup)) {
      groupFilterEl.value = prevGroup;
    }

    const search = document.getElementById("studentSearchInput").value.trim().toLowerCase();
    const filtered = state.students.filter(s => {
      if (groupFilterEl.value !== "all" && s.groupId !== groupFilterEl.value) return false;
      if (search) {
        const g = getGroupById(s.groupId);
        const hay = `${s.name} ${s.phone || ""} ${s.notes || ""} ${g ? g.name : ""}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const tbody = document.getElementById("studentsTableBody");
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <div class="empty-state-icon">👩‍🎓</div>
              <div class="empty-state-title">No students in roster yet</div>
              <div class="text-muted">Click "+ Add Student" to enroll students into groups.</div>
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(s => {
      const group = getGroupById(s.groupId);
      const fee = getEffectiveFee(s, group);
      const cur = getStudentCurrency(s, group);
      const isCustom = s.customFee !== null && s.customFee !== undefined && s.customFee !== "";

      return `
        <tr>
          <td>
            <div class="font-bold">${escapeHtml(s.name)}</div>
            ${s.notes ? `<div class="text-muted">${escapeHtml(s.notes)}</div>` : ""}
          </td>
          <td class="tabular">${escapeHtml(s.phone || "—")}</td>
          <td>
            <div class="font-bold">${escapeHtml(group ? group.name : "Unassigned")}</div>
            <div class="text-muted">${escapeHtml(group ? group.subject : "")}</div>
          </td>
          <td class="text-right tabular font-bold">
            ${escapeHtml(formatMoney(fee, cur))}
            <div>
              ${isCustom
                ? `<span class="badge badge-melon" style="font-size:0.65rem;">Custom Rate</span>`
                : `<span class="text-muted" style="font-size:0.72rem;">Group Standard</span>`}
            </div>
          </td>
          <td>
            <span class="badge ${s.status === "paused" ? "badge-partial" : "badge-paid"}">
              ${s.status === "paused" ? "Paused" : "Active"}
            </span>
          </td>
          <td class="text-right" style="white-space:nowrap;">
            <button type="button" class="btn btn-primary btn-sm" data-action="pay" data-id="${escapeHtml(s.id)}">💳 Pay</button>
            <button type="button" class="btn btn-outline btn-sm" data-action="edit-student" data-id="${escapeHtml(s.id)}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-student" data-id="${escapeHtml(s.id)}">🗑</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ---------- Groups Tab ----------
  function renderGroupsTab() {
    const grid = document.getElementById("groupsGrid");
    if (state.groups.length === 0) {
      grid.innerHTML = `
        <div class="card" style="grid-column: 1 / -1;">
          <div class="empty-state">
            <div class="empty-state-icon">📚</div>
            <div class="empty-state-title">No groups created yet</div>
            <div class="text-muted" style="margin-bottom:14px;">Start by creating your subject groups and assigning standard monthly fees.</div>
            <button type="button" class="btn btn-primary" data-action="create-group">+ Create First Group</button>
          </div>
        </div>`;
      return;
    }

    grid.innerHTML = state.groups.map(g => {
      const groupStudents = state.students.filter(s => s.groupId === g.id && s.status !== "paused");
      const expectedTotal = round2(groupStudents.reduce((sum, s) => sum + getEffectiveFee(s, g), 0));

      return `
        <div class="group-card">
          <div>
            <div class="group-card-top">
              <div>
                <div class="group-name">${escapeHtml(g.name)}</div>
                <div class="text-muted">${escapeHtml(g.subject)}</div>
              </div>
              <span class="badge badge-cosmic">${escapeHtml(g.currency)}</span>
            </div>
            ${g.schedule ? `<div class="text-muted" style="margin-top:8px;">🕒 ${escapeHtml(g.schedule)}</div>` : ""}
          </div>

          <div class="group-meta">
            <div>
              <div class="text-muted">Standard Fee</div>
              <div class="font-bold tabular">${escapeHtml(formatMoney(g.standardFee, g.currency))}</div>
            </div>
            <div>
              <div class="text-muted">Active Students</div>
              <div class="font-bold tabular">${groupStudents.length} student${groupStudents.length === 1 ? "" : "s"}</div>
            </div>
            <div style="grid-column: span 2;">
              <div class="text-muted">Expected Monthly Revenue</div>
              <div class="font-bold tabular">${escapeHtml(formatMoney(expectedTotal, g.currency))}</div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" class="btn btn-outline btn-sm" data-action="edit-group" data-id="${escapeHtml(g.id)}">Edit Group</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-group" data-id="${escapeHtml(g.id)}">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  }

  // ---------- Settings Tab ----------
  function renderSettingsTab() {
    document.getElementById("setTutorName").value = state.settings.tutorName || "";
    document.getElementById("setTutorSub").value = state.settings.tutorSubtitle || "";
    document.getElementById("setTutorPhone").value = state.settings.tutorPhone || "";
    document.getElementById("setDefaultCurrency").value = state.settings.defaultCurrency || "EGP";
  }

  // ---------- Modals ----------
  function openModal(id) {
    document.getElementById(id).classList.add("open");
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove("open");
  }

  function openGroupModal(groupId = null) {
    const group = groupId ? getGroupById(groupId) : null;
    document.getElementById("groupModalTitle").textContent = group ? "Edit Group" : "Add Group";
    document.getElementById("groupId").value = group ? group.id : "";
    document.getElementById("groupName").value = group ? group.name : "";
    document.getElementById("groupSubject").value = group ? group.subject : "";
    document.getElementById("groupFee").value = group ? group.standardFee : "";
    document.getElementById("groupCurrency").value = group ? group.currency : (state.settings.defaultCurrency || "EGP");
    document.getElementById("groupSchedule").value = group ? (group.schedule || "") : "";
    openModal("groupModal");
    setTimeout(() => document.getElementById("groupName").focus(), 50);
  }

  function openStudentModal(studentId = null) {
    if (state.groups.length === 0) {
      showToast("Create a group first before adding students.", "+ Add Group", () => openGroupModal());
      return;
    }

    const student = studentId ? getStudentById(studentId) : null;
    document.getElementById("studentModalTitle").textContent = student ? "Edit Student" : "Add Student";
    document.getElementById("studentId").value = student ? student.id : "";
    document.getElementById("studentName").value = student ? student.name : "";
    document.getElementById("studentPhone").value = student ? (student.phone || "") : "";
    document.getElementById("studentStatus").value = student ? (student.status || "active") : "active";
    document.getElementById("studentNotes").value = student ? (student.notes || "") : "";

    const groupSel = document.getElementById("studentGroup");
    groupSel.innerHTML = state.groups.map(g =>
      `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)} (${escapeHtml(formatMoney(g.standardFee, g.currency))})</option>`
    ).join("");
    groupSel.value = student && getGroupById(student.groupId) ? student.groupId : state.groups[0].id;
    updateStudentGroupHint();

    const hasCustom = student && student.customFee !== null && student.customFee !== undefined && student.customFee !== "";
    document.getElementById("studentCustomFeeToggle").checked = Boolean(hasCustom);
    document.getElementById("studentCustomFeeWrap").style.display = hasCustom ? "flex" : "none";
    document.getElementById("studentCustomFee").value = hasCustom ? student.customFee : "";

    openModal("studentModal");
    setTimeout(() => document.getElementById("studentName").focus(), 50);
  }

  function updateStudentGroupHint() {
    const g = getGroupById(document.getElementById("studentGroup").value);
    document.getElementById("studentGroupStandardHint").textContent = g
      ? `Standard group fee: ${formatMoney(g.standardFee, g.currency)}`
      : "";
  }

  function openReceiptModal(paymentId) {
    const payment = state.payments.find(p => p.id === paymentId);
    if (!payment) return;

    const student = getStudentById(payment.studentId);
    const totalPaidForMonth = round2(
      state.payments
        .filter(p => p.studentId === payment.studentId && p.billingMonth === payment.billingMonth)
        .reduce((sum, p) => sum + Number(p.amountPaid), 0)
    );
    const agreedFee = Number(payment.expectedFee || 0);
    const remainingForMonth = round2(Math.max(0, agreedFee - totalPaidForMonth));

    document.getElementById("receiptPrintableArea").innerHTML = `
      <div class="receipt-box">
        <div class="receipt-top">
          <div>
            <div class="receipt-brand-name">${escapeHtml(state.settings.tutorName || "Student Payment Tracker")}</div>
            <div class="receipt-brand-sub">${escapeHtml(state.settings.tutorSubtitle || "Private Tutoring Receipt")}</div>
            ${state.settings.tutorPhone ? `<div class="receipt-brand-sub">Tel: ${escapeHtml(state.settings.tutorPhone)}</div>` : ""}
          </div>
          <div style="text-align:right;">
            <span class="receipt-tag">Official Receipt</span>
            <div class="tabular" style="font-size:0.84rem; margin-top:8px; color:#FFFFFF; font-weight:700;">
              ${escapeHtml(payment.receiptNo)}
            </div>
          </div>
        </div>

        <div class="receipt-content">
          <div class="receipt-meta-grid">
            <div>
              <div class="receipt-field-label">Student Name</div>
              <div class="receipt-field-val">${escapeHtml(payment.studentName)}</div>
              ${student && student.phone ? `<div class="text-muted tabular">${escapeHtml(student.phone)}</div>` : ""}
            </div>
            <div>
              <div class="receipt-field-label">Payment Date</div>
              <div class="receipt-field-val tabular">${escapeHtml(payment.paymentDate)}</div>
            </div>
            <div>
              <div class="receipt-field-label">Group &amp; Subject Track</div>
              <div class="receipt-field-val">${escapeHtml(payment.groupName)}</div>
              <div class="text-muted">${escapeHtml(payment.subject || "")}</div>
            </div>
            <div>
              <div class="receipt-field-label">Billing Month</div>
              <div class="receipt-field-val">${escapeHtml(formatMonthLabel(payment.billingMonth))}</div>
            </div>
            <div>
              <div class="receipt-field-label">Payment Gateway</div>
              <div class="receipt-field-val">${GATEWAY_ICONS[payment.gateway] || ""} ${escapeHtml(payment.gateway)}</div>
            </div>
            <div>
              <div class="receipt-field-label">Reference / Note</div>
              <div class="receipt-field-val">${escapeHtml(payment.reference || "—")}</div>
            </div>
          </div>

          <table class="receipt-summary-table">
            <tr>
              <td>Agreed Monthly Fee (${escapeHtml(formatMonthLabel(payment.billingMonth))})</td>
              <td class="text-right tabular font-bold">${escapeHtml(formatMoney(agreedFee, payment.currency))}</td>
            </tr>
            <tr>
              <td>Total Paid for Month (to date)</td>
              <td class="text-right tabular">${escapeHtml(formatMoney(totalPaidForMonth, payment.currency))}</td>
            </tr>
            <tr>
              <td>Remaining Balance for Month</td>
              <td class="text-right tabular" style="color:${remainingForMonth > 0 ? "var(--danger-text)" : "var(--success-text)"}; font-weight:700;">
                ${escapeHtml(formatMoney(remainingForMonth, payment.currency))}${remainingForMonth === 0 ? " (Settled)" : ""}
              </td>
            </tr>
            <tr class="receipt-total-row">
              <td>Amount Received (This Receipt)</td>
              <td class="text-right tabular">${escapeHtml(formatMoney(payment.amountPaid, payment.currency))}</td>
            </tr>
          </table>

          <div class="receipt-footer-sign">
            <div>
              <div>Issued electronically via Student Payment Tracker</div>
              <div class="tabular">Receipt ID: ${escapeHtml(payment.receiptNo)}</div>
            </div>
            <div class="signature-line">Authorized Signature</div>
          </div>
        </div>
      </div>
    `;

    openModal("receiptModal");
  }

  // ---------- CSV & JSON Exports ----------
  function csvEscape(val) {
    const s = String(val ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportPaymentsCSV() {
    const headers = [
      "Receipt No",
      "Payment Date",
      "Billing Month",
      "Student Name",
      "Group Name",
      "Subject Track",
      "Agreed Monthly Fee",
      "Amount Paid",
      "Currency",
      "Gateway",
      "Reference"
    ];

    const rows = state.payments
      .slice()
      .sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""))
      .map(p => [
        p.receiptNo,
        p.paymentDate,
        p.billingMonth,
        p.studentName,
        p.groupName,
        p.subject,
        p.expectedFee,
        p.amountPaid,
        p.currency,
        p.gateway,
        p.reference || ""
      ].map(csvEscape).join(","));

    const csv = "\uFEFF" + [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    downloadFile(csv, `payments-ledger-${getTodayDate()}.csv`, "text/csv;charset=utf-8;");
    showToast("Payments CSV downloaded.");
  }

  function exportMonthlyDuesCSV() {
    const headers = [
      "Billing Month",
      "Student Name",
      "Contact Number",
      "Group Name",
      "Subject Track",
      "Currency",
      "Agreed Fee",
      "Paid Amount",
      "Remaining Balance",
      "Status"
    ];

    const rows = state.students
      .filter(s => s.status !== "paused")
      .map(s => {
        const sum = getStudentMonthSummary(s, selectedMonth);
        return [
          selectedMonth,
          s.name,
          s.phone || "",
          sum.group ? sum.group.name : "Unassigned",
          sum.group ? sum.group.subject : "",
          sum.currency,
          sum.expectedFee,
          sum.paidAmount,
          sum.remaining,
          sum.status
        ].map(csvEscape).join(",");
      });

    const csv = "\uFEFF" + [headers.map(csvEscape).join(","), ...rows].join("\r\n");
    downloadFile(csv, `monthly-dues-${selectedMonth}.csv`, "text/csv;charset=utf-8;");
    showToast(`Dues CSV for ${formatMonthLabel(selectedMonth)} downloaded.`);
  }

  function exportJSONBackup() {
    const payload = JSON.stringify(state, null, 2);
    downloadFile(payload, `student-payment-tracker-backup-${getTodayDate()}.json`, "application/json;charset=utf-8;");
    showToast("Full JSON backup downloaded.");
  }

  function loadSampleData() {
    if (
      (state.groups.length || state.students.length || state.payments.length) &&
      !confirm("Loading sample data will replace your current workspace. Continue?")
    ) {
      return;
    }

    const m = selectedMonth;
    const today = getTodayDate();
    const g1 = { id: uid("grp"), name: "Grade 12 Physics — Sat/Tue", subject: "Physics (Thanawiya Amma)", standardFee: 600, currency: "EGP", schedule: "Sat & Tue 5:00 PM" };
    const g2 = { id: uid("grp"), name: "IGCSE Math Core — Sun/Wed", subject: "Mathematics (Cambridge)", standardFee: 850, currency: "EGP", schedule: "Sun & Wed 6:30 PM" };
    const g3 = { id: uid("grp"), name: "Online Arabic Track (KSA)", subject: "Arabic Grammar & Rhetoric", standardFee: 250, currency: "SAR", schedule: "Mon & Thu 7:00 PM" };

    const s1 = { id: uid("stu"), name: "Youssef Mahmoud", phone: "01012345678", groupId: g1.id, customFee: null, status: "active", notes: "" };
    const s2 = { id: uid("stu"), name: "Salma El-Sayed", phone: "01198765432", groupId: g1.id, customFee: 500, status: "active", notes: "Sibling agreed rate" };
    const s3 = { id: uid("stu"), name: "Omar Tarek", phone: "01233445566", groupId: g1.id, customFee: null, status: "active", notes: "" };
    const s4 = { id: uid("stu"), name: "Nourhan Adel", phone: "01544556677", groupId: g2.id, customFee: null, status: "active", notes: "" };
    const s5 = { id: uid("stu"), name: "Adam Mostafa", phone: "01055667788", groupId: g2.id, customFee: 700, status: "active", notes: "Early registration discount" };
    const s6 = { id: uid("stu"), name: "Laila Khaled", phone: "+966 50 123 4567", groupId: g3.id, customFee: null, status: "active", notes: "Riyadh online" };

    const p1 = {
      id: uid("pay"), receiptNo: `RCP-${m.replace("-", "")}-0001`,
      studentId: s1.id, groupId: g1.id, studentName: s1.name, groupName: g1.name, subject: g1.subject,
      billingMonth: m, expectedFee: 600, amountPaid: 600, currency: "EGP",
      gateway: "InstaPay", paymentDate: today, reference: "IP-94821", createdAt: new Date().toISOString()
    };
    const p2 = {
      id: uid("pay"), receiptNo: `RCP-${m.replace("-", "")}-0002`,
      studentId: s2.id, groupId: g1.id, studentName: s2.name, groupName: g1.name, subject: g1.subject,
      billingMonth: m, expectedFee: 500, amountPaid: 300, currency: "EGP",
      gateway: "Vodafone Cash", paymentDate: today, reference: "VF-3310", createdAt: new Date().toISOString()
    };
    const p3 = {
      id: uid("pay"), receiptNo: `RCP-${m.replace("-", "")}-0003`,
      studentId: s4.id, groupId: g2.id, studentName: s4.name, groupName: g2.name, subject: g2.subject,
      billingMonth: m, expectedFee: 850, amountPaid: 850, currency: "EGP",
      gateway: "Cash", paymentDate: today, reference: "In-class receipt", createdAt: new Date().toISOString()
    };
    const p4 = {
      id: uid("pay"), receiptNo: `RCP-${m.replace("-", "")}-0004`,
      studentId: s6.id, groupId: g3.id, studentName: s6.name, groupName: g3.name, subject: g3.subject,
      billingMonth: m, expectedFee: 250, amountPaid: 250, currency: "SAR",
      gateway: "Bank Transfer", paymentDate: today, reference: "AlRajhi #442", createdAt: new Date().toISOString()
    };

    state.groups = [g1, g2, g3];
    state.students = [s1, s2, s3, s4, s5, s6];
    state.payments = [p1, p2, p3, p4];
    saveState();
    renderAll();
    showToast("Sample groups, students & payments loaded!");
  }

  // ---------- Tab Navigation ----------
  function switchTab(tabName) {
    document.querySelectorAll(".nav-tab").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-panel").forEach(panel => {
      panel.classList.toggle("active", panel.id === `tab-${tabName}`);
    });
  }

  // ---------- Event Listeners ----------
  document.querySelectorAll(".nav-tab").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    selectedMonth = shiftMonth(selectedMonth, -1);
    document.getElementById("fastPayMonth").value = selectedMonth;
    renderAll();
  });

  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    selectedMonth = shiftMonth(selectedMonth, 1);
    document.getElementById("fastPayMonth").value = selectedMonth;
    renderAll();
  });

  document.getElementById("billingMonthInput").addEventListener("change", (e) => {
    if (e.target.value) {
      selectedMonth = e.target.value;
      document.getElementById("fastPayMonth").value = selectedMonth;
      renderAll();
    }
  });

  document.getElementById("defaultCurrencySelect").addEventListener("change", (e) => {
    state.settings.defaultCurrency = e.target.value;
    saveState();
    renderAll();
    showToast(`Default currency set to ${e.target.value}.`);
  });

  document.getElementById("headerQuickPayBtn").addEventListener("click", () => {
    switchTab("dashboard");
    const card = document.getElementById("fastPayCard");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    const grp = document.getElementById("fastPayGroup");
    if (grp && grp.offsetParent !== null) grp.focus();
  });

  // Fast Payment Listeners
  document.getElementById("fastPayGroup").addEventListener("change", () => {
    populateFastPayStudents(false);
  });

  document.getElementById("fastPayStudent").addEventListener("change", () => {
    updateFastPayStudentDetails();
  });

  document.getElementById("fastPayMonth").addEventListener("change", () => {
    populateFastPayStudents(true);
  });

  document.getElementById("gatewaySelector").addEventListener("click", (e) => {
    const pill = e.target.closest(".gateway-pill");
    if (!pill) return;
    document.querySelectorAll(".gateway-pill").forEach(p => p.classList.remove("selected"));
    pill.classList.add("selected");
    document.getElementById("fastPayGateway").value = pill.dataset.gw;
  });

  document.getElementById("fastPayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const studentId = document.getElementById("fastPayStudent").value;
    const student = getStudentById(studentId);
    if (!student) {
      showToast("Please select a student first.");
      return;
    }

    const billingMonth = document.getElementById("fastPayMonth").value || selectedMonth;
    const paymentDate = document.getElementById("fastPayDate").value || getTodayDate();
    const amountPaid = round2(Number(document.getElementById("fastPayAmount").value));
    const gateway = document.getElementById("fastPayGateway").value || "InstaPay";
    const reference = document.getElementById("fastPayRef").value.trim();

    if (!(amountPaid > 0)) {
      showToast("Amount paid must be greater than zero.");
      return;
    }

    const group = getGroupById(student.groupId);
    const expectedFee = getEffectiveFee(student, group);
    const currency = getStudentCurrency(student, group);

    const newPayment = {
      id: uid("pay"),
      receiptNo: generateReceiptNo(billingMonth),
      studentId: student.id,
      groupId: group ? group.id : "",
      studentName: student.name,
      groupName: group ? group.name : "Unassigned",
      subject: group ? group.subject : "",
      billingMonth,
      expectedFee,
      amountPaid,
      currency,
      gateway,
      paymentDate,
      reference,
      createdAt: new Date().toISOString()
    };

    state.payments.push(newPayment);
    saveState();

    document.getElementById("fastPayRef").value = "";
    renderAll();

    showToast(
      `Logged ${formatMoney(amountPaid, currency)} for ${student.name}.`,
      "🖨️ Print Receipt",
      () => openReceiptModal(newPayment.id)
    );
  });

  document.getElementById("quickCreateGroupBtn").addEventListener("click", () => openGroupModal());
  document.getElementById("quickLoadDemoBtn").addEventListener("click", loadSampleData);

  // Dues Table Filters & Actions
  document.getElementById("duesGroupFilter").addEventListener("change", renderDuesTable);
  document.getElementById("duesStatusFilter").addEventListener("change", renderDuesTable);
  document.getElementById("duesSearchInput").addEventListener("input", renderDuesTable);
  document.getElementById("exportDuesCsvBtn").addEventListener("click", exportMonthlyDuesCSV);

  document.getElementById("duesTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "pay") jumpToFastPay(id);
    if (action === "receipt") openReceiptModal(id);
  });

  // Payments Tab Filters & Actions
  document.getElementById("payMonthFilter").addEventListener("change", renderPaymentsTab);
  document.getElementById("payGroupFilter").addEventListener("change", renderPaymentsTab);
  document.getElementById("payGatewayFilter").addEventListener("change", renderPaymentsTab);
  document.getElementById("paySearchInput").addEventListener("input", renderPaymentsTab);
  document.getElementById("exportPaymentsCsvBtn").addEventListener("click", exportPaymentsCSV);

  document.getElementById("paymentsTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "receipt") openReceiptModal(id);
    if (action === "delete-payment") {
      const pay = state.payments.find(p => p.id === id);
      if (!pay) return;
      if (confirm(`Delete receipt ${pay.receiptNo} (${formatMoney(pay.amountPaid, pay.currency)}) for ${pay.studentName}?`)) {
        state.payments = state.payments.filter(p => p.id !== id);
        saveState();
        renderAll();
        showToast("Payment transaction deleted.");
      }
    }
  });

  // Students Tab Actions
  document.getElementById("addStudentBtn").addEventListener("click", () => openStudentModal());
  document.getElementById("studentGroupFilter").addEventListener("change", renderStudentsTab);
  document.getElementById("studentSearchInput").addEventListener("input", renderStudentsTab);

  document.getElementById("studentsTableBody").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "pay") jumpToFastPay(id);
    if (action === "edit-student") openStudentModal(id);
    if (action === "delete-student") {
      const s = getStudentById(id);
      if (!s) return;
      if (confirm(`Remove "${s.name}" from the student roster? Past payment receipts will remain preserved.`)) {
        state.students = state.students.filter(st => st.id !== id);
        saveState();
        renderAll();
        showToast("Student removed.");
      }
    }
  });

  // Groups Tab Actions
  document.getElementById("addGroupBtn").addEventListener("click", () => openGroupModal());

  document.getElementById("groupsGrid").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "create-group") openGroupModal();
    if (action === "edit-group") openGroupModal(id);
    if (action === "delete-group") {
      const g = getGroupById(id);
      if (!g) return;
      const assignedCount = state.students.filter(s => s.groupId === id).length;
      if (assignedCount > 0) {
        alert(`Cannot delete "${g.name}" while ${assignedCount} student(s) are assigned to it. Reassign or remove those students first.`);
        return;
      }
      if (confirm(`Delete group "${g.name}"?`)) {
        state.groups = state.groups.filter(gr => gr.id !== id);
        saveState();
        renderAll();
        showToast("Group deleted.");
      }
    }
  });

  // Group Modal Form
  document.getElementById("closeGroupModal").addEventListener("click", () => closeModal("groupModal"));
  document.getElementById("cancelGroupModal").addEventListener("click", () => closeModal("groupModal"));

  document.getElementById("groupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("groupId").value;
    const name = document.getElementById("groupName").value.trim();
    const subject = document.getElementById("groupSubject").value.trim();
    const standardFee = round2(Number(document.getElementById("groupFee").value));
    const currency = document.getElementById("groupCurrency").value;
    const schedule = document.getElementById("groupSchedule").value.trim();

    if (!name || !subject) return;

    if (id) {
      const existing = getGroupById(id);
      if (existing) {
        existing.name = name;
        existing.subject = subject;
        existing.standardFee = standardFee;
        existing.currency = currency;
        existing.schedule = schedule;
      }
      showToast(`Group "${name}" updated.`);
    } else {
      state.groups.push({
        id: uid("grp"),
        name,
        subject,
        standardFee,
        currency,
        schedule,
        createdAt: new Date().toISOString()
      });
      showToast(`Group "${name}" created.`);
    }

    saveState();
    closeModal("groupModal");
    renderAll();
  });

  // Student Modal Form
  document.getElementById("closeStudentModal").addEventListener("click", () => closeModal("studentModal"));
  document.getElementById("cancelStudentModal").addEventListener("click", () => closeModal("studentModal"));
  document.getElementById("studentGroup").addEventListener("change", updateStudentGroupHint);

  document.getElementById("studentCustomFeeToggle").addEventListener("change", (e) => {
    document.getElementById("studentCustomFeeWrap").style.display = e.target.checked ? "flex" : "none";
  });

  document.getElementById("studentForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = document.getElementById("studentId").value;
    const name = document.getElementById("studentName").value.trim();
    const phone = document.getElementById("studentPhone").value.trim();
    const status = document.getElementById("studentStatus").value;
    const groupId = document.getElementById("studentGroup").value;
    const notes = document.getElementById("studentNotes").value.trim();
    const useCustom = document.getElementById("studentCustomFeeToggle").checked;
    const customRaw = document.getElementById("studentCustomFee").value;

    let customFee = null;
    if (useCustom) {
      if (customRaw === "" || isNaN(Number(customRaw)) || Number(customRaw) < 0) {
        showToast("Please enter a valid custom rate (0 or higher).");
        return;
      }
      customFee = round2(Number(customRaw));
    }

    if (id) {
      const existing = getStudentById(id);
      if (existing) {
        existing.name = name;
        existing.phone = phone;
        existing.status = status;
        existing.groupId = groupId;
        existing.customFee = customFee;
        existing.notes = notes;
      }
      showToast(`Student "${name}" updated.`);
    } else {
      state.students.push({
        id: uid("stu"),
        name,
        phone,
        status,
        groupId,
        customFee,
        notes,
        createdAt: new Date().toISOString()
      });
      showToast(`Student "${name}" added.`);
    }

    saveState();
    closeModal("studentModal");
    renderAll();
  });

  // Receipt Modal
  document.getElementById("closeReceiptModal").addEventListener("click", () => closeModal("receiptModal"));
  document.getElementById("closeReceiptFooterBtn").addEventListener("click", () => closeModal("receiptModal"));
  document.getElementById("printReceiptBtn").addEventListener("click", () => window.print());

  // Settings & Backup Tab
  document.getElementById("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.settings.tutorName = document.getElementById("setTutorName").value.trim() || "Student Payment Tracker";
    state.settings.tutorSubtitle = document.getElementById("setTutorSub").value.trim();
    state.settings.tutorPhone = document.getElementById("setTutorPhone").value.trim();
    state.settings.defaultCurrency = document.getElementById("setDefaultCurrency").value;
    saveState();
    renderAll();
    showToast("Settings saved locally.");
  });

  document.getElementById("btnExportPaymentsCsv").addEventListener("click", exportPaymentsCSV);
  document.getElementById("btnExportDuesCsv").addEventListener("click", exportMonthlyDuesCSV);
  document.getElementById("btnExportJson").addEventListener("click", exportJSONBackup);
  document.getElementById("btnLoadDemo").addEventListener("click", loadSampleData);

  document.getElementById("importJsonInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.groups) || !Array.isArray(data.students) || !Array.isArray(data.payments)) {
          throw new Error("Invalid backup structure");
        }
        if (!confirm(`Restore backup containing ${data.groups.length} groups, ${data.students.length} students, and ${data.payments.length} payments? This replaces current data.`)) {
          return;
        }
        state = {
          settings: { ...defaultState().settings, ...(data.settings || {}) },
          groups: data.groups,
          students: data.students,
          payments: data.payments
        };
        saveState();
        renderAll();
        showToast("Backup restored successfully.");
      } catch (err) {
        alert("Invalid JSON backup file.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("btnClearAll").addEventListener("click", () => {
    if (!confirm("Are you sure you want to permanently erase ALL groups, students, and payment records?")) return;
    if (!confirm("Final confirmation: export a JSON backup first if needed. Clear everything now?")) return;
    state = defaultState();
    saveState();
    renderAll();
    showToast("All browser data cleared.");
  });

  // Global Escape & Backdrop Click Close
  document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.classList.remove("open");
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach(m => m.classList.remove("open"));
    }
  });

  // Initialize App
  document.getElementById("fastPayMonth").value = selectedMonth;
  document.getElementById("fastPayDate").value = getTodayDate();
  renderAll();
})();