const request = require('supertest');
const app = require('./server');

describe('HR Vacation Request Subsystem API Tests', () => {
  beforeEach(async () => {
    // Reset database to ensure a clean slate before each test
    await request(app).post('/api/reset').expect(200);
  });

  describe('Database Reset & State Retrieval', () => {
    test('POST /api/reset successfully resets database and returns success', async () => {
      const response = await request(app)
        .post('/api/reset')
        .expect(200);
      
      expect(response.body).toEqual({
        success: true,
        message: 'Simulation database reset successfully.'
      });
    });

    test('GET /api/state returns the initial baseline configuration', async () => {
      const response = await request(app)
        .get('/api/state')
        .expect(200);
      
      const { employees, accrualBalances, departments, workflows, notifications, logs } = response.body;
      
      // Verify employees list and structure
      expect(employees).toHaveLength(6);
      expect(employees[0]).toHaveProperty('id');
      expect(employees[0]).toHaveProperty('name');
      expect(employees[0]).toHaveProperty('sector');
      expect(employees[0]).toHaveProperty('department_id');

      // Verify accrual balances structure
      expect(accrualBalances).toHaveLength(6);
      expect(accrualBalances[0]).toHaveProperty('employee_id');
      expect(accrualBalances[0]).toHaveProperty('base_days');
      expect(accrualBalances[0]).toHaveProperty('used_days');

      // Verify departments structure
      expect(departments).toHaveLength(3);
      expect(departments[0]).toHaveProperty('id');
      expect(departments[0]).toHaveProperty('name');
      expect(departments[0]).toHaveProperty('sector');

      // Verify workflows structure
      expect(workflows).toHaveLength(2);
      expect(workflows[0]).toHaveProperty('id');
      expect(workflows[0]).toHaveProperty('status');

      // Verify notifications structure
      expect(notifications).toHaveLength(2);
      expect(notifications[0]).toHaveProperty('id');
      expect(notifications[0]).toHaveProperty('message');

      // Verify log structures
      expect(logs.length).toBeGreaterThan(0);
    });
  });

  describe('Submit Time-Off Request (POST /api/requests)', () => {
    test('Submitting a valid request successfully creates a workflow and notification', async () => {
      const payload = {
        employee_id: 'emp_101', // Alice Vance (Retail, US, manager_id: emp_102)
        start_date: '2026-08-10', // Monday
        end_date: '2026-08-14',   // Friday
        reason: 'Summer family trip'
      };

      const response = await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.requestId).toBeDefined();
      expect(response.body.daysRequested).toBe(5);
      expect(response.body.escalated).toBe(false);
      expect(response.body.request).toBeDefined();

      const createdRequest = response.body.request;
      expect(createdRequest.employee_id).toBe('emp_101');
      expect(createdRequest.status).toBe('pending');
      expect(createdRequest.current_step).toBe('manager_review');
      expect(createdRequest.days_requested).toBe(5);

      // Verify state was updated
      const stateResponse = await request(app).get('/api/state').expect(200);
      const { workflows, notifications, logs } = stateResponse.body;

      // New request should be at the top of workflows
      expect(workflows[0].id).toBe(response.body.requestId);
      
      // New notification should be created for manager (emp_102)
      const managerNotif = notifications.find(n => n.user_id === 'emp_102');
      expect(managerNotif).toBeDefined();
      expect(managerNotif.message).toContain(response.body.requestId);

      // SQL statement logs should be inserted
      const sqlLogs = logs.filter(l => l.type === 'sql');
      expect(sqlLogs.length).toBeGreaterThan(0);
      const transactionLog = sqlLogs.find(l => l.message.includes('BEGIN TRANSACTION') && l.message.includes('INSERT INTO workflows'));
      expect(transactionLog).toBeDefined();
    });

    test('Over-requesting days beyond the employee\'s net available balance returns a 422 error', async () => {
      // emp_101 (Alice Vance): base 15, accrued 15, used 3, rollover 2.
      // Net available: (15 + 2) - 3 = 14 days.
      // Let's request 15 business days (3 weeks)
      const payload = {
        employee_id: 'emp_101',
        start_date: '2026-08-10', // Monday
        end_date: '2026-08-28',   // Friday (15 business days)
        reason: 'Extra long trip'
      };

      const response = await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(422);

      expect(response.body.error).toContain('Insufficient accrued vacation balance');

      // Verify no new workflow was created
      const stateResponse = await request(app).get('/api/state').expect(200);
      expect(stateResponse.body.workflows).toHaveLength(2); // Still default 2
    });

    test('Requesting invalid dates where start date > end date returns 400 error', async () => {
      const payload = {
        employee_id: 'emp_101',
        start_date: '2026-08-14',
        end_date: '2026-08-10',
        reason: 'Backward dates'
      };

      const response = await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('Selected time range does not contain any business days');
    });

    test('Requesting range with no business days (weekend only) returns 400 error', async () => {
      const payload = {
        employee_id: 'emp_101',
        start_date: '2026-08-08', // Saturday
        end_date: '2026-08-09',   // Sunday
        reason: 'Weekend trip'
      };

      const response = await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(400);

      expect(response.body.error).toContain('Selected time range does not contain any business days');
    });

    test('Requesting with missing required parameters returns 400 error', async () => {
      await request(app)
        .post('/api/requests')
        .send({ employee_id: 'emp_101' })
        .expect(400);
    });

    test('Requesting for an unrecognized employee returns 404 error', async () => {
      const payload = {
        employee_id: 'emp_invalid',
        start_date: '2026-08-10',
        end_date: '2026-08-14'
      };

      const response = await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(404);

      expect(response.body.error).toBe('Employee not found.');
    });
  });

  describe('Sector-Specific Business Rules', () => {
    describe('Retail', () => {
      test('Holiday Blackout window (Nov 15 - Jan 5) forces warning and escalates to vp_review', async () => {
        const payload = {
          employee_id: 'emp_101', // Retail
          start_date: '2026-11-23', // Monday inside blackout
          end_date: '2026-11-27',   // Friday inside blackout (5 business days)
          reason: 'Holiday shopping getaway'
        };

        const response = await request(app)
          .post('/api/requests')
          .send(payload)
          .expect(201);

        expect(response.body.escalated).toBe(true);
        expect(response.body.warning).toContain('Holiday Blackout Window');
        expect(response.body.request.current_step).toBe('vp_review');
      });
    });

    describe('Healthcare', () => {
      test('On-call constraint (min 70% coverage, max 30% off concurrently) returns 422 if exceeded', async () => {
        // Urgent Care Unit (dept_health_uc) has 4 total staff. Max off concurrently is Math.floor(4 * 0.3) = 1.
        // req_902 (for Dr. Clara Mendez, emp_201) is already pending for 2026-10-12 to 2026-10-16.
        // If we request overlapping dates for David Jones (emp_202, same department dept_health_uc), it should fail.
        const payload = {
          employee_id: 'emp_202', // Clinical Director, Healthcare
          start_date: '2026-10-13', // Overlaps req_902
          end_date: '2026-10-15',
          reason: 'Overlapping healthcare vacation'
        };

        const response = await request(app)
          .post('/api/requests')
          .send(payload)
          .expect(422);

        expect(response.body.error).toContain('On-Call Coverage Alert');
      });
    });

    describe('Financial Services', () => {
      test('Compliance blackout (last 5 business days of any quarter) returns 422 error', async () => {
        // Q1 2026 ends Tuesday, March 31.
        // Last 5 business days are March 25 (Wed), 26 (Thu), 27 (Fri), 30 (Mon), 31 (Tue).
        // Let's request March 30 to March 31.
        const payload = {
          employee_id: 'emp_301', // Risk Analyst, Financial Services
          start_date: '2026-03-30',
          end_date: '2026-03-31',
          reason: 'Quarter-end getaway'
        };

        const response = await request(app)
          .post('/api/requests')
          .send(payload)
          .expect(422);

        expect(response.body.error).toContain('Compliance Blackout window');
      });

      test('SOX 10-day block-leave recommendation triggers warning if request is < 10 days', async () => {
        const payload = {
          employee_id: 'emp_301', // Financial Services
          start_date: '2026-08-10', // Monday
          end_date: '2026-08-14',   // Friday (5 business days)
          reason: 'Short compliance vacation'
        };

        const response = await request(app)
          .post('/api/requests')
          .send(payload)
          .expect(201);

        expect(response.body.warning).toContain('Compliance Advisory: FINRA/SOX policy recommends taking at least 10 consecutive business days');
      });

      test('SOX 10-day block-leave does not trigger warning if request is >= 10 days', async () => {
        const payload = {
          employee_id: 'emp_301', // Financial Services
          start_date: '2026-08-10', // Monday
          end_date: '2026-08-21',   // Friday (10 business days)
          reason: 'Full 2-week block-leave audit compliance'
        };

        const response = await request(app)
          .post('/api/requests')
          .send(payload)
          .expect(201);

        expect(response.body.warning).toBeNull();
      });
    });
  });

  describe('Workflow Actions (POST /api/requests/:id/action)', () => {
    describe('Approval', () => {
      test('Approving a pending request updates status, adds notification, increments used_days, and records SQL log', async () => {
        // req_902 is pending for emp_201 (days_requested: 5, initial used_days: 8)
        // Actor is emp_202
        const payload = {
          action: 'approve',
          actor_id: 'emp_202'
        };

        const response = await request(app)
          .post('/api/requests/req_902/action')
          .send(payload)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.workflow.status).toBe('approved');
        expect(response.body.workflow.current_step).toBe('completed');

        // Fetch state to verify updates
        const stateResponse = await request(app).get('/api/state').expect(200);
        const { accrualBalances, notifications, logs } = stateResponse.body;

        // Verify used_days was incremented (8 + 5 = 13)
        const balance = accrualBalances.find(b => b.employee_id === 'emp_201');
        expect(balance.used_days).toBe(13);

        // Verify notification was sent to employee (emp_201)
        const empNotif = notifications.find(n => n.user_id === 'emp_201');
        expect(empNotif).toBeDefined();
        expect(empNotif.message).toContain('APPROVED by David Jones');

        // Verify SQL log created
        const sqlLogs = logs.filter(l => l.type === 'sql');
        const updateWorkflowLog = sqlLogs.find(l => l.message.includes("UPDATE workflows") && l.message.includes("SET status = 'approved'"));
        const updateBalanceLog = sqlLogs.find(l => l.message.includes("UPDATE accrual_balances") && l.message.includes("SET used_days = used_days + 5"));
        const insertAuditLog = sqlLogs.find(l => l.message.includes("INSERT INTO audit_vacation_logs"));

        expect(updateWorkflowLog).toBeDefined();
        expect(updateBalanceLog).toBeDefined();
        expect(insertAuditLog).toBeDefined();
      });
    });

    describe('Rejection', () => {
      test('Rejecting a pending request updates status, adds notification, but does NOT increment used_days', async () => {
        // req_902 is pending for emp_201 (days_requested: 5, initial used_days: 8)
        const payload = {
          action: 'reject',
          actor_id: 'emp_202'
        };

        const response = await request(app)
          .post('/api/requests/req_902/action')
          .send(payload)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.workflow.status).toBe('rejected');
        expect(response.body.workflow.current_step).toBe('completed');

        // Fetch state to verify updates
        const stateResponse = await request(app).get('/api/state').expect(200);
        const { accrualBalances, notifications, logs } = stateResponse.body;

        // Verify used_days was NOT incremented (remains 8)
        const balance = accrualBalances.find(b => b.employee_id === 'emp_201');
        expect(balance.used_days).toBe(8);

        // Verify notification was sent to employee (emp_201)
        const empNotif = notifications.find(n => n.user_id === 'emp_201');
        expect(empNotif).toBeDefined();
        expect(empNotif.message).toContain('REJECTED by David Jones');

        // Verify SQL log created
        const sqlLogs = logs.filter(l => l.type === 'sql');
        const updateWorkflowLog = sqlLogs.find(l => l.message.includes("UPDATE workflows") && l.message.includes("SET status = 'rejected'"));
        expect(updateWorkflowLog).toBeDefined();
      });
    });

    describe('Validation & Authorization', () => {
      test('Performing action on already non-pending request returns 400 error', async () => {
        // req_901 is already approved
        const payload = {
          action: 'approve',
          actor_id: 'emp_102'
        };

        const response = await request(app)
          .post('/api/requests/req_901/action')
          .send(payload)
          .expect(400);

        expect(response.body.error).toContain('Action can only be performed on pending workflows');
      });

      test('Performing action with missing fields returns 400 error', async () => {
        await request(app)
          .post('/api/requests/req_902/action')
          .send({ action: 'approve' })
          .expect(400);

        await request(app)
          .post('/api/requests/req_902/action')
          .send({ actor_id: 'emp_202' })
          .expect(400);
      });

      test('Performing action on unrecognized request ID returns 404 error', async () => {
        const payload = {
          action: 'approve',
          actor_id: 'emp_202'
        };

        const response = await request(app)
          .post('/api/requests/req_invalid/action')
          .send(payload)
          .expect(404);

        expect(response.body.error).toContain('Vacation request workflow not found');
      });

      test('Performing action with unrecognized actor ID returns 404 error', async () => {
        const payload = {
          action: 'approve',
          actor_id: 'emp_invalid'
        };

        const response = await request(app)
          .post('/api/requests/req_902/action')
          .send(payload)
          .expect(404);

        expect(response.body.error).toContain('Actor employee profile not found');
      });
    });
  });

  describe('Multi-Regional logging & IAP purge tests', () => {
    test('Logs correctly intercept GCLB requests and extract client IPs, and do not produce IAP logs', async () => {
      const payload = {
        employee_id: 'emp_101',
        start_date: '2026-08-10',
        end_date: '2026-08-14',
        reason: 'Logging verification test'
      };

      // 1. Test x-forwarded-for header with a list of IPs
      await request(app)
        .post('/api/requests')
        .set('x-forwarded-for', '203.0.113.195, 198.51.100.1')
        .send(payload)
        .expect(201);

      let state = await request(app).get('/api/state').expect(200);
      let gclbLogs = state.body.logs.filter(l => l.type === 'gclb');
      let iapLogs = state.body.logs.filter(l => l.type === 'iap');

      // Verify no IAP logs exist
      expect(iapLogs).toHaveLength(0);

      // Verify GCLB logs exist and parse first IP in x-forwarded-for list
      expect(gclbLogs.length).toBeGreaterThanOrEqual(2);
      expect(gclbLogs[0].message).toContain('GCLB: Forwarded authenticated session for user: alice.vance@retail.corp');
      expect(gclbLogs[1].message).toContain('GCLB: Intercepted POST request to /api/requests. Client IP: 203.0.113.195. Region: us-central1.');

      // 2. Test fallback to req.socket.remoteAddress and loopback cleaning (Supertest default local IP)
      await request(app)
        .post('/api/requests')
        .send(payload)
        .expect(201);

      state = await request(app).get('/api/state').expect(200);
      gclbLogs = state.body.logs.filter(l => l.type === 'gclb');
      
      // Loopback IP like ::ffff:127.0.0.1 or ::1 from local supertest should be mapped to 127.0.0.1
      const logWithIP = gclbLogs.find(l => l.message.includes('Client IP:'));
      expect(logWithIP.message).toContain('Client IP: 127.0.0.1');
    });
  });
});
