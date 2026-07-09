const express = require('express');
const path = require('path');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 8080;

let activeRegion = 'us-central1';

function fetchServerRegion() {
  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const options = {
      hostname: 'metadata.google.internal',
      path: '/computeMetadata/v1/instance/region',
      method: 'GET',
      headers: {
        'Metadata-Flavor': 'Google'
      },
      timeout: 1000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          const trimmed = data.trim();
          const parts = trimmed.split('/');
          const region = parts[parts.length - 1];
          if (region) {
            activeRegion = region;
            console.log(`GCP Metadata Server resolved region: ${activeRegion}`);
          }
        } else {
          console.log(`Local Dev Mode: Metadata Server returned status ${res.statusCode}. Falling back to default region: ${activeRegion}`);
        }
        safeResolve();
      });
    });

    req.on('error', (err) => {
      console.log(`Local Dev Mode: Socket error or metadata server unreachable. Falling back to default region: ${activeRegion}`);
      safeResolve();
    });

    req.on('timeout', () => {
      req.destroy();
      console.log(`Local Dev Mode: Metadata Server request timed out. Falling back to default region: ${activeRegion}`);
      safeResolve();
    });

    req.end();
  });
}

// Trigger region fetch at boot-time
fetchServerRegion();


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// IN-MEMORY DATA STORAGE (Mocking AlloyDB Cluster Relational Tables)
// -------------------------------------------------------------

let employees = [];
let accrualBalances = [];
let departments = [];
let workflows = []; // AlloyDB table `workflows`
let notifications = []; // AlloyDB table `notifications`
let dbLogs = []; // Relational SQL transaction logs for students to inspect

// Reset/Initialize Database State
function resetDatabase() {
  dbLogs = [
    { timestamp: new Date().toISOString(), type: 'system', message: 'Database initialization sequence started.' }
  ];

  // 1. AlloyDB Mock Data
  departments = [
    { id: 'dept_retail_cs', name: 'Store Customer Service', sector: 'Retail', head_id: 'emp_102', total_staff: 5 },
    { id: 'dept_health_uc', name: 'Urgent Care Unit', sector: 'Healthcare', head_id: 'emp_202', total_staff: 4 },
    { id: 'dept_finance_rm', name: 'Risk Management & Audit', sector: 'Financial Services', head_id: 'emp_302', total_staff: 3 }
  ];
  dbLogs.push({ timestamp: new Date().toISOString(), type: 'sql', message: 'INSERT INTO departments (id, name, sector, head_id, total_staff) VALUES (3 rows...)' });

  employees = [
    // Retail
    { id: 'emp_101', name: 'Alice Vance', sector: 'Retail', country: 'US', department_id: 'dept_retail_cs', role: 'Sales Associate', manager_id: 'emp_102', email: 'alice.vance@retail.corp' },
    { id: 'emp_102', name: 'Bob Smith', sector: 'Retail', country: 'US', department_id: 'dept_retail_cs', role: 'Store Manager', manager_id: null, email: 'bob.smith@retail.corp' },
    // Healthcare
    { id: 'emp_201', name: 'Dr. Clara Mendez', sector: 'Healthcare', country: 'UK', department_id: 'dept_health_uc', role: 'Attending Physician', manager_id: 'emp_202', email: 'c.mendez@health.corp' },
    { id: 'emp_202', name: 'David Jones', sector: 'Healthcare', country: 'UK', department_id: 'dept_health_uc', role: 'Clinical Director', manager_id: null, email: 'david.jones@health.corp' },
    // Financial Services
    { id: 'emp_301', name: 'Edward Chen', sector: 'Financial Services', country: 'Japan', department_id: 'dept_finance_rm', role: 'Risk Analyst', manager_id: 'emp_302', email: 'e.chen@finance.corp' },
    { id: 'emp_302', name: 'Fiona Sato', sector: 'Financial Services', country: 'Japan', department_id: 'dept_finance_rm', role: 'VP of Compliance', manager_id: null, email: 'fiona.sato@finance.corp' }
  ];
  dbLogs.push({ timestamp: new Date().toISOString(), type: 'sql', message: 'INSERT INTO employees (id, name, sector, country, department_id, role, manager_id, email) VALUES (6 rows...)' });

  accrualBalances = [
    // Retail US (15 base)
    { employee_id: 'emp_101', year: 2026, base_days: 15, accrued_days: 15, used_days: 3, rollover_days: 2 },
    { employee_id: 'emp_102', year: 2026, base_days: 15, accrued_days: 15, used_days: 5, rollover_days: 0 },
    // Healthcare UK (20 base)
    { employee_id: 'emp_201', year: 2026, base_days: 20, accrued_days: 20, used_days: 8, rollover_days: 5 },
    { employee_id: 'emp_202', year: 2026, base_days: 20, accrued_days: 20, used_days: 10, rollover_days: 4 },
    // Financial Services Japan (25 base)
    { employee_id: 'emp_301', year: 2026, base_days: 25, accrued_days: 25, used_days: 12, rollover_days: 0 }, // Strict use-it-or-lose-it
    { employee_id: 'emp_302', year: 2026, base_days: 25, accrued_days: 25, used_days: 15, rollover_days: 0 }
  ];
  dbLogs.push({ timestamp: new Date().toISOString(), type: 'sql', message: 'INSERT INTO accrual_balances (employee_id, year, base_days, accrued_days, used_days, rollover_days) VALUES (6 rows...)' });

  // 2. AlloyDB Mock Data (Table: workflows)
  workflows = [
    {
      id: 'req_901',
      employee_id: 'emp_101',
      employee_name: 'Alice Vance',
      sector: 'Retail',
      country: 'US',
      start_date: '2026-08-10',
      end_date: '2026-08-14',
      days_requested: 5,
      status: 'approved',
      current_step: 'completed',
      approval_chain: ['emp_102'],
      reason: 'Summer family trip',
      created_at: '2026-06-01T10:00:00Z',
      updated_at: '2026-06-02T14:30:00Z'
    },
    {
      id: 'req_902',
      employee_id: 'emp_201',
      employee_name: 'Dr. Clara Mendez',
      sector: 'Healthcare',
      country: 'UK',
      start_date: '2026-10-12',
      end_date: '2026-10-16',
      days_requested: 5,
      status: 'pending',
      current_step: 'manager_review',
      approval_chain: ['emp_202'],
      reason: 'Medical conference rollover vacation',
      created_at: '2026-06-25T08:15:00Z',
      updated_at: '2026-06-25T08:15:00Z'
    }
  ];
  dbLogs.push({ 
    timestamp: new Date().toISOString(), 
    type: 'sql', 
    message: `-- Workflows Seeding Queries\nINSERT INTO workflows (id, employee_id, employee_name, sector, country, start_date, end_date, days_requested, status, current_step, approval_chain, reason, created_at, updated_at) VALUES\n('req_901', 'emp_101', 'Alice Vance', 'Retail', 'US', '2026-08-10', '2026-08-14', 5, 'approved', 'completed', ARRAY['emp_102'], 'Summer family trip', '2026-06-01T10:00:00Z', '2026-06-02T14:30:00Z'),\n('req_902', 'emp_201', 'Dr. Clara Mendez', 'Healthcare', 'UK', '2026-10-12', '2026-10-16', 5, 'pending', 'manager_review', ARRAY['emp_202'], 'Medical conference rollover vacation', '2026-06-25T08:15:00Z', '2026-06-25T08:15:00Z');` 
  });

  // AlloyDB Mock Data (Table: notifications)
  notifications = [
    { id: 'notif_001', user_id: 'emp_101', message: 'Your vacation request req_901 has been APPROVED by Bob Smith.', read: true, created_at: '2026-06-02T14:30:00Z' },
    { id: 'notif_002', user_id: 'emp_202', message: 'New pending vacation request req_902 received from Dr. Clara Mendez.', read: false, created_at: '2026-06-25T08:15:00Z' }
  ];
  dbLogs.push({ 
    timestamp: new Date().toISOString(), 
    type: 'sql', 
    message: `-- Notifications Seeding Queries\nINSERT INTO notifications (id, user_id, message, read, created_at) VALUES\n('notif_001', 'emp_101', 'Your vacation request req_901 has been APPROVED by Bob Smith.', true, '2026-06-02T14:30:00Z'),\n('notif_002', 'emp_202', 'New pending vacation request req_902 received from Dr. Clara Mendez.', false, '2026-06-25T08:15:00Z');` 
  });
  dbLogs.push({ timestamp: new Date().toISOString(), type: 'system', message: 'AlloyDB Resilient Cluster Subsystem fully loaded and bound.' });
}

// Perform initial boot DB reset
resetDatabase();

// Helper to extract true client IP
function getClientIP(req) {
  let ip = req.headers['x-forwarded-for'];
  if (ip) {
    ip = ip.split(',')[0].trim();
  } else {
    ip = req.socket.remoteAddress;
  }
  if (ip === '::1' || ip === '::ffff:127.0.0.1') {
    ip = '127.0.0.1';
  }
  return ip;
}

// Helper to log GCLB verification on incoming API requests
function logGCLBRequest(req, email) {
  const clientIP = getClientIP(req);
  logDBAction('gclb', `GCLB: Intercepted ${req.method} request to ${req.path}. Client IP: ${clientIP}. Region: ${activeRegion}.`);
  logDBAction('gclb', `GCLB: Forwarded authenticated session for user: ${email}.`);
}

app.use((req, res, next) => {
  if (req.url.startsWith('/api/') && !req.url.startsWith('/api/state') && req.url !== '/api/reset') {
    let email = 'anonymous@untrusted.net';
    if (req.body && req.body.employee_id) {
      const emp = employees.find(e => e.id === req.body.employee_id);
      if (emp) email = emp.email;
    } else if (req.body && req.body.actor_id) {
      const emp = employees.find(e => e.id === req.body.actor_id);
      if (emp) email = emp.email;
    } else {
      email = 'student@gcp-lab.internal';
    }
    logGCLBRequest(req, email);
  }
  next();
});

// Helper to log DB events
function logDBAction(type, message) {
  dbLogs.unshift({
    timestamp: new Date().toISOString(),
    type,
    message
  });
  if (dbLogs.length > 100) dbLogs.pop(); // Cap logs
}

// Helper to determine if dates overlap
function datesOverlap(start1, end1, start2, end2) {
  const s1 = new Date(start1);
  const e1 = new Date(end1);
  const s2 = new Date(start2);
  const e2 = new Date(end2);
  return s1 <= e2 && s2 <= e1;
}

// Helper to count business days between two dates
function calculateBusinessDays(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let count = 0;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) { // Skip Sat (6) and Sun (0)
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// -------------------------------------------------------------
// BUSINESS RULES ENGINE (Sector-Specific Logic)
// -------------------------------------------------------------

function validateRules(employee, startDate, endDate, daysRequested) {
  const sDate = new Date(startDate);
  const eDate = new Date(endDate);
  
  if (sDate > eDate) {
    return { valid: false, message: 'Start date must be on or before end date.' };
  }

  // 1. Get Accrual Balance
  const balance = accrualBalances.find(b => b.employee_id === employee.id);
  if (!balance) {
    return { valid: false, message: 'No accrual profile found for employee.' };
  }
  
  const netAvailable = (balance.accrued_days + balance.rollover_days) - balance.used_days;
  if (daysRequested > netAvailable) {
    return { 
      valid: false, 
      message: `Insufficient accrued vacation balance. Requested: ${daysRequested} days, Available: ${netAvailable} days (Accrued: ${balance.accrued_days}, Rollover: ${balance.rollover_days}, Used: ${balance.used_days}).` 
    };
  }

  // 2. Sector Specific Business Policies
  if (employee.sector === 'Retail') {
    // Retail Rule: Blackout periods during holiday shopping (Nov 15 - Jan 5)
    // If vacation overlaps this range, it requires VP Escalation rather than simple manager approval
    const isBlackout = datesOverlap(startDate, endDate, `${sDate.getFullYear()}-11-15`, `${sDate.getFullYear()}-12-31`) ||
                      datesOverlap(startDate, endDate, `${sDate.getFullYear()}-01-01`, `${sDate.getFullYear()}-01-05`);
    
    if (isBlackout) {
      return { 
        valid: true, 
        warning: true,
        escalate: true,
        message: 'Holiday Blackout Window (Nov 15 - Jan 5): This request requires Clinical/Store VP double-authorization due to retail shopping volumes.' 
      };
    }
  }

  if (employee.sector === 'Healthcare') {
    // Healthcare Rule: On-call coverage constraints.
    // At most 30% of staff in the same department can be off simultaneously (minimum 70% coverage)
    const dept = departments.find(d => d.id === employee.department_id);
    const totalStaff = dept ? dept.total_staff : 4;
    const maxOffAllowed = Math.floor(totalStaff * 0.3); // 30% rule

    // Check overlapping approved or pending workflows for same department
    const overlappingRequests = workflows.filter(w => {
      if (w.status !== 'approved' && w.status !== 'pending') return false;
      // Get the employee profile for this workflow
      const we = employees.find(e => e.id === w.employee_id);
      return we && we.department_id === employee.department_id && we.id !== employee.id && datesOverlap(startDate, endDate, w.start_date, w.end_date);
    });

    if (overlappingRequests.length >= maxOffAllowed) {
      return {
        valid: false,
        message: `On-Call Coverage Alert: The department ${dept ? dept.name : 'Urgent Care'} cannot support additional concurrent time off. At most ${maxOffAllowed} team members can be off at once. Current overlap matches or exceeds limit (${overlappingRequests.length} off).`
      };
    }
  }

  if (employee.sector === 'Financial Services') {
    // Financial Services Rules:
    // A. Blackout on fiscal quarter ends (last 5 business days of Q1-Q4)
    // Q1 ends Mar 31, Q2 ends Jun 30, Q3 ends Sep 30, Q4 ends Dec 31
    const endDatesOfQuarters = [
      new Date(sDate.getFullYear(), 2, 31), // Mar 31
      new Date(sDate.getFullYear(), 5, 30), // Jun 30
      new Date(sDate.getFullYear(), 8, 30), // Sep 30
      new Date(sDate.getFullYear(), 11, 31) // Dec 31
    ];

    for (const qEnd of endDatesOfQuarters) {
      // Find the last 5 business days preceding qEnd
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
        return datesOverlap(startDate, endDate, checkDay, checkDay);
      });

      if (isBlackout) {
        return {
          valid: false,
          message: 'Compliance Blackout window: Financial regulations strictly prohibit scheduling time off during the final 5 business days of any fiscal quarter.'
        };
      }
    }

    // B. Encourage audit compliance block-leave (10 days consecutive is standard audit rule, highlight warnings)
    if (daysRequested < 10) {
      return {
        valid: true,
        warning: true,
        message: 'Compliance Advisory: FINRA/SOX policy recommends taking at least 10 consecutive business days of block-leave annually. Your request is less than 10 days.'
      };
    }
  }

  return { valid: true };
}

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// Get full system state (diagnostics dashboard)
app.get('/api/state', (req, res) => {
  res.json({
    employees,
    accrualBalances,
    departments,
    workflows,
    notifications,
    logs: dbLogs
  });
});

// Reset simulation
app.post('/api/reset', (req, res) => {
  resetDatabase();
  logDBAction('system', 'Database was manually reset to classroom default baseline.');
  res.json({ success: true, message: 'Simulation database reset successfully.' });
});

// Submit a new request
app.post('/api/requests', (req, res) => {
  const { employee_id, start_date, end_date, reason } = req.body;
  
  if (!employee_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'Missing required parameters: employee_id, start_date, end_date.' });
  }

  const employee = employees.find(e => e.id === employee_id);
  if (!employee) {
    return res.status(404).json({ error: 'Employee not found.' });
  }

  const daysRequested = calculateBusinessDays(start_date, end_date);
  if (daysRequested <= 0) {
    return res.status(400).json({ error: 'Selected time range does not contain any business days (Mon-Fri).' });
  }

  // Run regulatory and HR rules
  const validation = validateRules(employee, start_date, end_date, daysRequested);
  
  if (!validation.valid) {
    logDBAction('system', `Rejected submission for ${employee.name}: Rule validation failed. Reason: ${validation.message}`);
    return res.status(422).json({ error: validation.message });
  }

  // Create document in Firestore `/workflows`
  const requestId = 'req_' + Math.floor(100 + Math.random() * 900);
  const isEscalated = validation.escalate || false;
  const initialStatus = 'pending';
  const initialStep = isEscalated ? 'vp_review' : 'manager_review';
  
  const newRequest = {
    id: requestId,
    employee_id: employee.id,
    employee_name: employee.name,
    sector: employee.sector,
    country: employee.country,
    start_date,
    end_date,
    days_requested: daysRequested,
    status: initialStatus,
    current_step: initialStep,
    approval_chain: employee.manager_id ? [employee.manager_id] : [],
    reason: reason || 'N/A',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  workflows.unshift(newRequest);
  
  // SQL Relational Queries for logs
  logDBAction('sql', `SELECT * FROM accrual_balances WHERE employee_id = '${employee.id}' AND year = 2026;`);
  logDBAction('sql', `SELECT COUNT(*) FROM employees WHERE department_id = '${employee.department_id}';`);

  // Create manager notification
  const managerId = employee.manager_id || 'emp_302'; // fallback to Compliance head if no direct manager
  const notifId = 'notif_' + Math.floor(1000 + Math.random() * 9000);
  const notifMsg = `New vacation request ${requestId} (${daysRequested} days) submitted by ${employee.name} (${employee.sector}).`;
  
  const notification = {
    id: notifId,
    user_id: managerId,
    message: notifMsg,
    read: false,
    created_at: new Date().toISOString()
  };
  notifications.unshift(notification);

  const approvalChainStr = newRequest.approval_chain.length > 0 
    ? `ARRAY[${newRequest.approval_chain.map(id => `'${id}'`).join(', ')}]` 
    : 'ARRAY[]::TEXT[]';

  logDBAction('sql', `BEGIN TRANSACTION;
INSERT INTO workflows (id, employee_id, employee_name, sector, country, start_date, end_date, days_requested, status, current_step, approval_chain, reason, created_at, updated_at)
VALUES ('${requestId}', '${employee.id}', '${employee.name}', '${employee.sector}', '${employee.country}', '${start_date}', '${end_date}', ${daysRequested}, '${initialStatus}', '${initialStep}', ${approvalChainStr}, '${reason || 'N/A'}', '${newRequest.created_at}', '${newRequest.updated_at}');

INSERT INTO notifications (id, user_id, message, read, created_at)
VALUES ('${notifId}', '${managerId}', '${notifMsg}', FALSE, '${notification.created_at}');
COMMIT;`);

  res.status(201).json({
    success: true,
    requestId,
    daysRequested,
    escalated: isEscalated,
    warning: validation.warning ? validation.message : null,
    request: newRequest
  });
});

// Take action on a request (Approve / Reject)
app.post('/api/requests/:id/action', (req, res) => {
  const requestId = req.params.id;
  const { action, actor_id } = req.body; // action: 'approve' or 'reject', actor_id: who is clicking

  if (!action || !actor_id) {
    return res.status(400).json({ error: 'Missing action or actor_id.' });
  }

  const requestIdx = workflows.findIndex(w => w.id === requestId);
  if (requestIdx === -1) {
    return res.status(404).json({ error: 'Vacation request workflow not found.' });
  }

  const workflow = workflows[requestIdx];
  const employee = employees.find(e => e.id === workflow.employee_id);
  const actor = employees.find(e => e.id === actor_id);

  if (!actor) {
    return res.status(404).json({ error: 'Actor employee profile not found.' });
  }

  if (workflow.status !== 'pending') {
    return res.status(400).json({ error: 'Action can only be performed on pending workflows.' });
  }

  // relational lookup logs
  logDBAction('sql', `SELECT * FROM employees WHERE id = '${actor_id}';`);

  if (action === 'approve') {
    // If request was escalated and approved, or doesn't need escalation, complete it
    workflow.status = 'approved';
    workflow.current_step = 'completed';
    workflow.updated_at = new Date().toISOString();

    const balance = accrualBalances.find(b => b.employee_id === workflow.employee_id);
    let oldUsed = 0;
    let newUsed = 0;
    if (balance) {
      oldUsed = balance.used_days;
      balance.used_days += workflow.days_requested;
      newUsed = balance.used_days;
    }

    // Create Employee Notification
    const notifId = 'notif_' + Math.floor(1000 + Math.random() * 9000);
    const notifMsg = `Your vacation request ${requestId} (${workflow.days_requested} days) has been APPROVED by ${actor.name}.`;
    const notification = {
      id: notifId,
      user_id: workflow.employee_id,
      message: notifMsg,
      read: false,
      created_at: new Date().toISOString()
    };
    notifications.unshift(notification);

    logDBAction('sql', `BEGIN TRANSACTION;
UPDATE workflows 
SET status = 'approved', current_step = 'completed', updated_at = '${workflow.updated_at}' 
WHERE id = '${requestId}';

UPDATE accrual_balances 
SET used_days = used_days + ${workflow.days_requested} 
WHERE employee_id = '${workflow.employee_id}' AND year = 2026;

INSERT INTO audit_vacation_logs (request_id, actor_id, prev_used, new_used) 
VALUES ('${requestId}', '${actor_id}', ${oldUsed}, ${newUsed});

INSERT INTO notifications (id, user_id, message, read, created_at)
VALUES ('${notifId}', '${workflow.employee_id}', '${notifMsg}', FALSE, '${notification.created_at}');
COMMIT;`);

  } else if (action === 'reject') {
    workflow.status = 'rejected';
    workflow.current_step = 'completed';
    workflow.updated_at = new Date().toISOString();

    // Create Employee Notification
    const notifId = 'notif_' + Math.floor(1000 + Math.random() * 9000);
    const notifMsg = `Your vacation request ${requestId} (${workflow.days_requested} days) was REJECTED by ${actor.name}.`;
    const notification = {
      id: notifId,
      user_id: workflow.employee_id,
      message: notifMsg,
      read: false,
      created_at: new Date().toISOString()
    };
    notifications.unshift(notification);

    logDBAction('sql', `BEGIN TRANSACTION;
UPDATE workflows 
SET status = 'rejected', current_step = 'completed', updated_at = '${workflow.updated_at}' 
WHERE id = '${requestId}';

INSERT INTO notifications (id, user_id, message, read, created_at)
VALUES ('${notifId}', '${workflow.employee_id}', '${notifMsg}', FALSE, '${notification.created_at}');
COMMIT;`);
  }

  res.json({
    success: true,
    workflow
  });
});

// Serve Frontend Home page explicitly if needed
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`HR Vacation Request Subsystem Server listening on port ${PORT}`);
  });
}

module.exports = app;
