// -------------------------------------------------------------
// STATE VARIABLES & DOM ELEMENTS
// -------------------------------------------------------------

let state = {
  employees: [],
  accrualBalances: [],
  departments: [],
  workflows: [],
  notifications: [],
  logs: []
};

let currentEmployeeId = 'emp_101'; // Default: Alice Vance
let activeDbTab = 'sql'; // default inspector tab

// DOM Cache
const selectEmployee = document.getElementById('select-employee');
const profileAvatar = document.getElementById('profile-avatar');
const profileName = document.getElementById('profile-name');
const profileRole = document.getElementById('profile-role');
const profileBadges = document.getElementById('profile-badges');

const balAccrued = document.getElementById('bal-accrued');
const balRollover = document.getElementById('bal-rollover');
const balUsed = document.getElementById('bal-used');
const balNet = document.getElementById('bal-net');

const formRequest = document.getElementById('form-request');
const inputStart = document.getElementById('input-start');
const inputEnd = document.getElementById('input-end');
const inputReason = document.getElementById('input-reason');
const ruleWarnPane = document.getElementById('rule-warn-pane');

const tabSimulate = document.getElementById('tab-simulate');
const tabDatabase = document.getElementById('tab-database');
const tabLabs = document.getElementById('tab-labs');

const panelSimulate = document.getElementById('panel-simulate');
const panelDatabase = document.getElementById('panel-database');
const panelLabs = document.getElementById('panel-labs');

const tableWorkflowsBody = document.getElementById('table-workflows-body');
const terminalStream = document.getElementById('terminal-stream');
const logCounter = document.getElementById('log-counter');

const dbTabSql = document.getElementById('db-tab-sql');
const dbSqlPane = document.getElementById('db-sql-pane');
const sqlConsoleView = document.getElementById('sql-console-view');

const notifCenter = document.getElementById('notif-center');
const notifBadge = document.getElementById('notif-badge');
const btnReset = document.getElementById('btn-reset');
const toastContainer = document.getElementById('toast-container');

// -------------------------------------------------------------
// INITIALIZATION & TAB CONTROLS
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  fetchState(true); // Initial load, populate selectors
});

function setupEventListeners() {
  // Tab Routing
  tabSimulate.addEventListener('click', () => switchTab('simulate'));
  tabDatabase.addEventListener('click', () => switchTab('database'));
  tabLabs.addEventListener('click', () => switchTab('labs'));

  // Database Inspector Tabs
  dbTabSql.addEventListener('click', () => switchDbTab('sql'));

  // Role Swap Listener
  selectEmployee.addEventListener('change', (e) => {
    currentEmployeeId = e.target.value;
    updateActiveProfile();
    renderWorkflows();
    showToast('info', `Swapped active student role to ${state.employees.find(emp => emp.id === currentEmployeeId).name}`);
  });

  // Request Form Submit
  formRequest.addEventListener('submit', handleRequestSubmit);

  // Reset Button
  btnReset.addEventListener('click', handleReset);

  // Interactive Live Rule Checking
  inputStart.addEventListener('change', checkLiveRules);
  inputEnd.addEventListener('change', checkLiveRules);

  // Notification center click clear
  notifCenter.addEventListener('click', () => {
    clearNotifications();
  });
}

function switchTab(target) {
  [tabSimulate, tabDatabase, tabLabs].forEach(b => b.classList.remove('active'));
  [panelSimulate, panelDatabase, panelLabs].forEach(p => p.classList.remove('active'));

  if (target === 'simulate') {
    tabSimulate.classList.add('active');
    panelSimulate.classList.add('active');
  } else if (target === 'database') {
    tabDatabase.classList.add('active');
    panelDatabase.classList.add('active');
    renderDBInspectors();
  } else if (target === 'labs') {
    tabLabs.classList.add('active');
    panelLabs.classList.add('active');
  }
}

function switchDbTab(target) {
  activeDbTab = 'sql';
  dbTabSql.classList.add('active');
  dbSqlPane.style.display = 'block';
  renderDBInspectors();
}

// -------------------------------------------------------------
// RECOVERY & DATA FETCHING
// -------------------------------------------------------------

async function fetchState(initSelector = false) {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('API server returned error code');
    state = await res.json();
    
    if (initSelector) {
      populateEmployeeSelector();
    }
    
    updateActiveProfile();
    renderWorkflows();
    renderLogs();
    renderNotificationsBadge();
    
    if (panelDatabase.classList.contains('active')) {
      renderDBInspectors();
    }
  } catch (err) {
    console.error('Failed to sync system state:', err);
    showToast('error', 'Connectivity issue: Failed to sync with backend server.');
  }
}

function populateEmployeeSelector() {
  selectEmployee.innerHTML = '';
  state.employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = `${emp.name} (${emp.sector} - ${emp.role})`;
    selectEmployee.appendChild(opt);
  });
  selectEmployee.value = currentEmployeeId;
}

// -------------------------------------------------------------
// UI RENDERING
// -------------------------------------------------------------

function updateActiveProfile() {
  const employee = state.employees.find(e => e.id === currentEmployeeId);
  if (!employee) return;

  profileAvatar.textContent = employee.name.split(' ').map(n => n[0]).join('');
  profileName.textContent = employee.name;
  profileRole.textContent = employee.role;

  // Badges
  profileBadges.innerHTML = `
    <span class="badge badge-sector">${employee.sector}</span>
    <span class="badge badge-country">ISO-${employee.country}</span>
  `;

  // Balances
  const balance = state.accrualBalances.find(b => b.employee_id === currentEmployeeId);
  if (balance) {
    balAccrued.textContent = balance.accrued_days;
    balRollover.textContent = balance.rollover_days;
    balUsed.textContent = balance.used_days;
    
    const net = (balance.accrued_days + balance.rollover_days) - balance.used_days;
    balNet.textContent = net;
  }
  
  checkLiveRules();
}

function renderWorkflows() {
  tableWorkflowsBody.innerHTML = '';
  
  if (state.workflows.length === 0) {
    tableWorkflowsBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted);">No time-off requests are active in the AlloyDB database.</td></tr>`;
    return;
  }

  state.workflows.forEach(w => {
    const tr = document.createElement('tr');
    
    // Check if the current user has authority to act on this request
    const employee = state.employees.find(e => e.id === currentEmployeeId);
    const isPending = w.status === 'pending';
    const canAction = isPending && (
      // Manager chain check
      (employee && employee.id === 'emp_102' && w.employee_id === 'emp_101') || // Bob approves Alice
      (employee && employee.id === 'emp_202' && w.employee_id === 'emp_201') || // David approves Clara
      (employee && employee.id === 'emp_302' && w.employee_id === 'emp_301') || // Fiona approves Edward
      // Override or fallback for classroom demo to allow managers to approve anything if escalated
      (employee && ['emp_102', 'emp_202', 'emp_302'].includes(employee.id) && w.current_step === 'vp_review')
    );

    let statusLabel = `<span class="status-chip status-pending">Pending</span>`;
    if (w.status === 'approved') statusLabel = `<span class="status-chip status-approved">Approved</span>`;
    if (w.status === 'rejected') statusLabel = `<span class="status-chip status-rejected">Rejected</span>`;

    let stepLabel = `<code style="font-size: 0.75rem;">completed</code>`;
    if (w.current_step === 'manager_review') stepLabel = `<code style="color: var(--warning); font-size: 0.75rem;">manager_review</code>`;
    if (w.current_step === 'vp_review') stepLabel = `<code style="color: var(--danger); font-size: 0.75rem;">escalated_vp_review</code>`;

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 0.8rem; font-weight:600;">${w.id}</td>
      <td>
        <div style="font-weight:600;">${w.employee_name}</div>
        <div style="font-size:0.75rem; color:var(--text-secondary);">${w.employee_id}</div>
      </td>
      <td><span class="badge badge-sector" style="font-size:0.65rem;">${w.sector}</span></td>
      <td>
        <div style="font-size: 0.85rem;">${w.start_date} to ${w.end_date}</div>
        <div style="font-size: 0.75rem; color:var(--text-muted); font-style:italic;">"${w.reason}"</div>
      </td>
      <td style="font-weight: 700; text-align: center;">${w.days_requested}</td>
      <td>${statusLabel}</td>
      <td>${stepLabel}</td>
      <td style="text-align: right; white-space: nowrap;">
        ${canAction ? `
          <button class="btn btn-approve" data-id="${w.id}" style="display:inline-flex; width:auto; padding: 0.35rem 0.75rem; font-size: 0.75rem; background: var(--success); box-shadow: none; border-radius:4px; margin-right:0.3rem;">Approve</button>
          <button class="btn btn-reject" data-id="${w.id}" style="display:inline-flex; width:auto; padding: 0.35rem 0.75rem; font-size: 0.75rem; background: var(--danger); box-shadow: none; border-radius:4px;">Reject</button>
        ` : `
          <span style="font-size: 0.75rem; color: var(--text-muted);">${w.status === 'pending' ? 'Manager review' : 'Archive locked'}</span>
        `}
      </td>
    `;

    tableWorkflowsBody.appendChild(tr);
  });

  // Attach Action Button Listeners
  document.querySelectorAll('.btn-approve').forEach(btn => {
    btn.addEventListener('click', () => handleWorkflowAction(btn.dataset.id, 'approve'));
  });
  document.querySelectorAll('.btn-reject').forEach(btn => {
    btn.addEventListener('click', () => handleWorkflowAction(btn.dataset.id, 'reject'));
  });
}

function renderLogs() {
  terminalStream.innerHTML = '';
  logCounter.textContent = `${state.logs.length} operations logged`;

  state.logs.forEach(log => {
    const div = document.createElement('div');
    div.className = `log-entry log-${log.type}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = log.timestamp.split('T')[1].substring(0, 8); // hh:mm:ss

    const msgSpan = document.createElement('span');
    // Simple query formatting if it is SQL / Firestore logs
    msgSpan.textContent = log.message;

    div.appendChild(timeSpan);
    div.appendChild(msgSpan);
    terminalStream.appendChild(div);
  });
}

function renderNotificationsBadge() {
  // Count unread notifications for currently active employee
  const count = state.notifications.filter(n => n.user_id === currentEmployeeId && !n.read).length;
  if (count > 0) {
    notifBadge.textContent = count;
    notifBadge.style.display = 'flex';
  } else {
    notifBadge.style.display = 'none';
  }
}

// -------------------------------------------------------------
// EVENT HANDLERS & ACTIONS
// -------------------------------------------------------------

async function handleRequestSubmit(e) {
  e.preventDefault();

  const body = {
    employee_id: currentEmployeeId,
    start_date: inputStart.value,
    end_date: inputEnd.value,
    reason: inputReason.value
  };

  try {
    // 1. Trigger SVG Packet Animation through security gateway: Browser -> GCLB -> Frontend -> Backend
    await animatePacket('browser', 'gclb');
    await animatePacket('gclb', 'fe');
    await animatePacket('fe', 'be');

    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      showToast('error', `Rejected: ${data.error}`);
      return;
    }

    // 2. Trigger downstream DB pipeline animation
    await animatePacket('be', 'db');

    // Success actions
    showToast('success', `Success: Vacation request ${data.requestId} has been submitted!`);
    formRequest.reset();
    ruleWarnPane.innerHTML = '';
    
    // Sync state
    await fetchState();
  } catch (err) {
    console.error('Submit API connection failed:', err);
    showToast('error', 'Backend Core is unreachable.');
  }
}

async function handleWorkflowAction(requestId, action) {
  try {
    // FE -> BE security gateway animation
    await animatePacket('browser', 'gclb');
    await animatePacket('gclb', 'fe');
    await animatePacket('fe', 'be');

    const res = await fetch(`/api/requests/${requestId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        actor_id: currentEmployeeId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast('error', `Workflow error: ${data.error}`);
      return;
    }

    // DB updates trigger
    await animatePacket('be', 'db');

    showToast('success', `Workflow committed: ${requestId} status updated to ${action.toUpperCase()}.`);
    await fetchState();
  } catch (err) {
    console.error('Workflow update failed:', err);
    showToast('error', 'Failed to submit workflow resolution.');
  }
}

async function handleReset() {
  try {
    const res = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('info', 'System reset: Clean DB structures deployed.');
      currentEmployeeId = 'emp_101'; // restore alice
      await fetchState(true);
    }
  } catch (err) {
    showToast('error', 'Reset trigger failed.');
  }
}

// -------------------------------------------------------------
// LIVE RULES PANE & ANALYSIS
// -------------------------------------------------------------

function checkLiveRules() {
  const startVal = inputStart.value;
  const endVal = inputEnd.value;
  
  if (!startVal || !endVal) {
    ruleWarnPane.innerHTML = '';
    return;
  }

  const sDate = new Date(startVal);
  const eDate = new Date(endVal);
  const employee = state.employees.find(e => e.id === currentEmployeeId);
  const balance = state.accrualBalances.find(b => b.employee_id === currentEmployeeId);

  if (!employee || !balance) return;

  if (sDate > eDate) {
    renderRuleNotice('error', 'Logic Violation: Start date cannot exceed the End date.');
    return;
  }

  const reqDays = calculateBusinessDays(sDate, eDate);
  if (reqDays <= 0) {
    renderRuleNotice('error', 'Calendar Out of Bounds: Range contains no business days (Mon-Fri).');
    return;
  }

  const netAvailable = (balance.accrued_days + balance.rollover_days) - balance.used_days;
  if (reqDays > netAvailable) {
    renderRuleNotice('error', `Insufficient Balance: Requesting ${reqDays} days but only ${netAvailable} available.`);
    return;
  }

  // 1. Retail Blackouts (Nov 15 - Jan 5)
  if (employee.sector === 'Retail') {
    const isBlackout = datesOverlap(startVal, endVal, `${sDate.getFullYear()}-11-15`, `${sDate.getFullYear()}-12-31`) ||
                      datesOverlap(startVal, endVal, `${sDate.getFullYear()}-01-01`, `${sDate.getFullYear()}-01-05`);
    if (isBlackout) {
      renderRuleNotice('warning', 'Holiday Blackout Threshold: High retail volume range. Submission requires VP escalation overrides.');
      return;
    }
  }

  // 2. Financial Blackouts (fiscal quarter final 5 business days)
  if (employee.sector === 'Financial Services') {
    const endDatesOfQuarters = [
      new Date(sDate.getFullYear(), 2, 31),
      new Date(sDate.getFullYear(), 5, 30),
      new Date(sDate.getFullYear(), 8, 30),
      new Date(sDate.getFullYear(), 11, 31)
    ];

    for (const qEnd of endDatesOfQuarters) {
      let count = 0;
      let cur = new Date(qEnd);
      const blackoutDays = [];
      while (count < 5) {
        if (cur.getDay() !== 0 && cur.getDay() !== 6) {
          blackoutDays.push(new Date(cur));
          count++;
        }
        cur.setDate(cur.getDate() - 1);
      }
      
      const isBlackout = blackoutDays.some(bDay => {
        const checkDay = new Date(bDay);
        return datesOverlap(startVal, endVal, checkDay, checkDay);
      });

      if (isBlackout) {
        renderRuleNotice('error', 'SOX Compliance Conflict: Audits block scheduling requests during financial closing periods.');
        return;
      }
    }

    if (reqDays < 10) {
      renderRuleNotice('warning', 'Regulatory Warning: Standard financial rules require taking a continuous 10-day block leave.');
      return;
    }
  }

  // If we made it here, everything is clear!
  renderRuleNotice('info', `Valid Request: Evaluated ${reqDays} business days. No severe blackout flags detected.`);
}

function renderRuleNotice(type, text) {
  const icon = type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : '✅');
  ruleWarnPane.innerHTML = `
    <div class="rule-alert ${type === 'error' ? 'warning' : (type === 'warning' ? 'warning' : 'info')}">
      <span class="rule-alert-icon">${icon}</span>
      <div class="rule-alert-content">${text}</div>
    </div>
  `;
}

// -------------------------------------------------------------
// HELPER ARITHMETIC
// -------------------------------------------------------------

function calculateBusinessDays(start, end) {
  let count = 0;
  let cur = new Date(start.getTime());
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function datesOverlap(start1, end1, start2, end2) {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  return s1 <= e2 && s2 <= e1;
}

// -------------------------------------------------------------
// DATABASE INSPECTOR SYNTAX HIGHLIGHTING
// -------------------------------------------------------------

function renderDBInspectors() {
  let html = `<b style="color:var(--text-secondary)">-- AlloyDB Relational Console Output</b>\n\n`;
  
  // TABLE: employees
  html += `<span style="color:var(--text-muted)">SELECT * FROM employees;</span>\n`;
  html += `+---------+-------------------+------------+---------+--------------------+-----------------------+\n`;
  html += `| ID      | Name              | Sector     | Country | Dept ID            | Email                 |\n`;
  html += `+---------+-------------------+------------+---------+--------------------+-----------------------+\n`;
  state.employees.forEach(e => {
    html += `| ${e.id.padEnd(7)} | ${e.name.padEnd(17)} | ${e.sector.padEnd(10)} | ${e.country.padEnd(7)} | ${e.department_id.padEnd(18)} | ${e.email.padEnd(21)} |\n`;
  });
  html += `+---------+-------------------+------------+---------+--------------------+-----------------------+\n\n`;

  // TABLE: accrual_balances
  html += `<span style="color:var(--text-muted)">SELECT * FROM accrual_balances;</span>\n`;
  html += `+-------------+------+-----------+--------------+-----------+----------------+\n`;
  html += `| Employee ID | Year | Base Days | Accrued Days | Used Days | Rollover Days  |\n`;
  html += `+-------------+------+-----------+--------------+-----------+----------------+\n`;
  state.accrualBalances.forEach(b => {
    html += `| ${b.employee_id.padEnd(11)} | ${b.year} | ${b.base_days.toString().padEnd(9)} | ${b.accrued_days.toString().padEnd(12)} | ${b.used_days.toString().padEnd(9)} | ${b.rollover_days.toString().padEnd(14)} |\n`;
  });
  html += `+-------------+------+-----------+--------------+-----------+----------------+\n\n`;

  // TABLE: workflows
  html += `<span style="color:var(--text-muted)">SELECT * FROM workflows;</span>\n`;
  html += `+-------------+--------------------+----------------+--------------+------------------+-----------------+\n`;
  html += `| Request ID  | Employee Name      | Sector         | Date Range   | Days Requested   | Status          |\n`;
  html += `+-------------+--------------------+----------------+--------------+------------------+-----------------+\n`;
  state.workflows.forEach(w => {
    html += `| ${w.id.padEnd(11)} | ${w.employee_name.padEnd(18)} | ${w.sector.padEnd(14)} | ${w.start_date.padEnd(12)} | ${w.days_requested.toString().padEnd(16)} | ${w.status.padEnd(15)} |\n`;
  });
  html += `+-------------+--------------------+----------------+--------------+------------------+-----------------+\n\n`;

  // TABLE: notifications
  html += `<span style="color:var(--text-muted)">SELECT * FROM notifications;</span>\n`;
  html += `+-------------+-------------+-------------------------------------------------------------+-------+\n`;
  html += `| Notif ID    | User ID     | Message                                                     | Read  |\n`;
  html += `+-------------+-------------+-------------------------------------------------------------+-------+\n`;
  state.notifications.forEach(n => {
    html += `| ${n.id.padEnd(11)} | ${n.user_id.padEnd(11)} | ${n.message.substring(0, 58).padEnd(59)} | ${n.read.toString().padEnd(5)} |\n`;
  });
  html += `+-------------+-------------+-------------------------------------------------------------+-------+\n`;

  sqlConsoleView.innerHTML = html;
}

// -------------------------------------------------------------
// NOTIFICATIONS & TOASTS
// -------------------------------------------------------------

function showToast(type, text) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';

  toast.innerHTML = `<span>${icon}</span> <span>${text}</span>`;
  toastContainer.appendChild(toast);

  // auto clear in 4 seconds
  setTimeout(() => {
    toast.style.animation = 'slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 4000);
}

function clearNotifications() {
  state.notifications.forEach(n => {
    if (n.user_id === currentEmployeeId) n.read = true;
  });
  renderNotificationsBadge();
  showToast('info', 'Active notifications marked as read.');
}

// -------------------------------------------------------------
// ANIMATION LOGIC FOR SVG NETWORK DIAGRAM
// -------------------------------------------------------------

function animatePacket(fromNode, toNode) {
  return new Promise((resolve) => {
    const packet = document.getElementById(`packet-${fromNode}-${toNode}-c`);
    const path = document.getElementById(`path-${fromNode}-${toNode}`);

    if (!packet || !path) {
      resolve();
      return;
    }

    // Set style and restart animation
    packet.style.opacity = '1';
    
    const pathLen = path.getTotalLength();
    let duration = 800; // ms
    let startTime = null;

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / duration, 1);

      // Get point along the path
      const currentPoint = path.getPointAtLength(percentage * pathLen);
      packet.setAttribute('cx', currentPoint.x);
      packet.setAttribute('cy', currentPoint.y);

      if (percentage < 1) {
        requestAnimationFrame(step);
      } else {
        packet.style.opacity = '0';
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}
