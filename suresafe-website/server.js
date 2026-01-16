import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import BoxSDK from 'box-node-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sequelize } from 'sequelize';
import { sequelize, User, Claim, initDatabase } from './models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const BOX_CONFIG_PATH = process.env.BOX_CONFIG_PATH || path.join(__dirname, 'box-config.json');
const BOX_CONFIG_JSON = process.env.BOX_CONFIG_JSON; // For Cloud Run - pass config as JSON string
const BOX_CONFIG_JSON_BASE64 = process.env.BOX_CONFIG_JSON_BASE64; // For Cloud Run - pass config as base64
const CLOUD_RUN_API = process.env.CLOUD_RUN_API || 'https://suresafe-box-ai-579767694933.us-central1.run.app';
const CLAIMS_FOLDER_ID = process.env.CLAIMS_FOLDER_ID || '360172830890';

// Camunda 8 Configuration
const CAMUNDA_REST_URL = process.env.CAMUNDA_REST_URL || 'http://34.174.224.170:8088';
const CAMUNDA_OPERATE_URL = process.env.CAMUNDA_OPERATE_URL || 'http://34.174.224.170:8081';
const CAMUNDA_TASKLIST_URL = process.env.CAMUNDA_TASKLIST_URL || 'http://34.174.224.170:8082';
const CAMUNDA_CLIENT_ID = process.env.CAMUNDA_CLIENT_ID || '';
const CAMUNDA_CLIENT_SECRET = process.env.CAMUNDA_CLIENT_SECRET || '';
const CAMUNDA_AUTH_URL = process.env.CAMUNDA_AUTH_URL || '';
const PROCESS_DEFINITION_KEY = 'Process_ClaimsProcessing';

// Camunda access token cache
let camundaAccessToken = null;
let camundaTokenExpiry = null;

// Initialize Box SDK
let boxClient;
try {
  let boxConfig;

  if (BOX_CONFIG_JSON_BASE64) {
    // Use base64 encoded config from environment variable (Cloud Run)
    boxConfig = JSON.parse(Buffer.from(BOX_CONFIG_JSON_BASE64, 'base64').toString('utf8'));
    console.log('Using Box config from base64 environment variable');
  } else if (BOX_CONFIG_JSON) {
    // Use config from environment variable (Cloud Run)
    boxConfig = JSON.parse(BOX_CONFIG_JSON);
    console.log('Using Box config from environment variable');
  } else if (fs.existsSync(BOX_CONFIG_PATH)) {
    // Use config from file (local development)
    boxConfig = JSON.parse(fs.readFileSync(BOX_CONFIG_PATH, 'utf8'));
    console.log('Using Box config from file:', BOX_CONFIG_PATH);
  } else {
    throw new Error('No Box configuration found');
  }

  const sdk = BoxSDK.getPreconfiguredInstance(boxConfig);
  boxClient = sdk.getAppAuthClient('enterprise');
  console.log('Box SDK initialized successfully');
} catch (error) {
  console.error('Failed to initialize Box SDK:', error.message);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: 'suresafe-secret-key-2024',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, JPEG, PNG, GIF, DOC, DOCX'));
    }
  }
});

// Database connection status
let dbConnected = false;

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  next();
};

// Admin authentication middleware
const requireAdminAuth = (req, res, next) => {
  if (!req.session.adminUser) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    return res.redirect('/admin');
  }
  next();
};

// API Routes

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email } });

    if (user && user.password === password) {
      const userData = {
        id: user.id,
        name: user.name,
        email: user.email,
        policyNumber: user.policyNumber,
        memberSince: user.memberSince
      };
      req.session.user = userData;
      res.json({ success: true, user: userData });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user
app.get('/api/user', (req, res) => {
  if (req.session.user) {
    res.json({ success: true, user: req.session.user });
  } else {
    res.status(401).json({ success: false, message: 'Not authenticated' });
  }
});

// Submit a new claim
app.post('/api/claims', upload.array('documents', 10), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const { claimType, description, incidentDate, estimatedAmount } = req.body;
    const claimId = `CLM-${Date.now()}-${uuidv4().substring(0, 4).toUpperCase()}`;

    // Create claim folder in Box
    let claimFolderId;
    const folderName = `${claimId}_${req.session.user.name.replace(/\s+/g, '_')}`;

    if (boxClient) {
      try {
        const folder = await boxClient.folders.create(CLAIMS_FOLDER_ID, folderName);
        claimFolderId = folder.id;
        console.log(`Created claim folder: ${folder.id}`);

        // Trigger Box Relay workflow for the new claim folder
        const RELAY_WORKFLOW_ID = '1568430561';
        try {
          const workflowResponse = await boxClient.post(`/workflows/${RELAY_WORKFLOW_ID}/start`, {
            body: {
              type: 'workflow_parameters',
              flow: {
                id: RELAY_WORKFLOW_ID,
                type: 'flow'
              },
              folder: {
                id: claimFolderId,
                type: 'folder'
              }
            }
          });
          console.log(`Box Relay workflow triggered for folder: ${claimFolderId}`, workflowResponse);
        } catch (relayError) {
          console.log('Box Relay workflow trigger skipped:', relayError.message);
          // Non-blocking - continue even if Relay trigger fails
        }
      } catch (error) {
        console.error('Failed to create claim folder:', error.message);
      }
    }

    // Upload documents to Box
    const uploadedDocs = [];
    if (req.files && req.files.length > 0 && boxClient && claimFolderId) {
      for (const file of req.files) {
        try {
          const uploadedFile = await boxClient.files.uploadFile(
            claimFolderId,
            file.originalname,
            file.buffer
          );
          uploadedDocs.push({
            id: uploadedFile.entries[0].id,
            name: file.originalname,
            size: file.size,
            type: file.mimetype
          });
          console.log(`Uploaded file: ${uploadedFile.entries[0].id}`);
        } catch (error) {
          console.error(`Failed to upload ${file.originalname}:`, error.message);
        }
      }
    }

    // Create claim record in database
    const statusHistory = [
      { status: 'Submitted', date: new Date().toISOString(), note: 'Claim submitted by member' }
    ];

    let aiExtraction = null;

    // Trigger AI extraction via Cloud Run API
    if (uploadedDocs.length > 0 && claimFolderId) {
      try {
        const extractResponse = await fetch(`${CLOUD_RUN_API}/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file_id: uploadedDocs[0].id,
            extraction_type: 'insurance_claim'
          })
        });
        aiExtraction = await extractResponse.json();
        console.log('AI extraction completed:', aiExtraction);
      } catch (error) {
        console.error('AI extraction failed:', error.message);
      }
    }

    // Save to database
    const claim = await Claim.create({
      id: claimId,
      userId: req.session.user.id,
      userName: req.session.user.name,
      policyNumber: req.session.user.policyNumber,
      claimType,
      description,
      incidentDate,
      estimatedAmount: parseFloat(estimatedAmount) || 0,
      status: 'Submitted',
      statusHistory,
      boxFolderId: claimFolderId,
      documents: uploadedDocs,
      aiExtraction,
      workflowStatus: 'NOT_STARTED'
    });

    // Start Camunda process for the claim
    let processInstanceKey = null;
    try {
      const processResponse = await camundaRequest('/v2/process-instances', {
        method: 'POST',
        body: JSON.stringify({
          processDefinitionKey: PROCESS_DEFINITION_KEY,
          variables: {
            claimId: { value: claimId, type: 'String' },
            userName: { value: req.session.user.name, type: 'String' },
            userId: { value: req.session.user.id, type: 'String' },
            claimType: { value: claimType, type: 'String' },
            estimatedAmount: { value: parseFloat(estimatedAmount) || 0, type: 'Double' },
            boxFolderId: { value: claimFolderId || '', type: 'String' }
          }
        })
      });
      processInstanceKey = processResponse.key || processResponse.processInstanceKey;
      console.log('Camunda process started:', processInstanceKey);

      // Update claim with process instance key
      await claim.update({
        processInstanceKey,
        workflowStatus: 'STARTED'
      });
    } catch (camundaError) {
      console.log('Camunda process start skipped (demo mode):', camundaError.message);
      // Demo mode - assign a demo process key
      processInstanceKey = `demo-process-${Date.now()}`;
      await claim.update({
        processInstanceKey,
        workflowStatus: 'DEMO'
      });
    }

    res.json({
      success: true,
      claim: {
        id: claim.id,
        userId: claim.userId,
        userName: claim.userName,
        policyNumber: claim.policyNumber,
        claimType: claim.claimType,
        description: claim.description,
        incidentDate: claim.incidentDate,
        estimatedAmount: parseFloat(claim.estimatedAmount),
        status: claim.status,
        statusHistory: claim.statusHistory,
        boxFolderId: claim.boxFolderId,
        documents: claim.documents,
        aiExtraction: claim.aiExtraction,
        processInstanceKey: processInstanceKey,
        workflowStatus: claim.workflowStatus,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt
      }
    });
  } catch (error) {
    console.error('Claim submission error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get user's claims
app.get('/api/claims', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const userClaims = await Claim.findAll({
      where: { userId: req.session.user.id },
      order: [['createdAt', 'DESC']]
    });

    const formattedClaims = userClaims.map(claim => ({
      id: claim.id,
      userId: claim.userId,
      userName: claim.userName,
      policyNumber: claim.policyNumber,
      claimType: claim.claimType,
      description: claim.description,
      incidentDate: claim.incidentDate,
      estimatedAmount: parseFloat(claim.estimatedAmount),
      status: claim.status,
      statusHistory: claim.statusHistory,
      boxFolderId: claim.boxFolderId,
      documents: claim.documents,
      aiExtraction: claim.aiExtraction,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt
    }));

    res.json({ success: true, claims: formattedClaims });
  } catch (error) {
    console.error('Error fetching claims:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch claims' });
  }
});

// Get single claim
app.get('/api/claims/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const claim = await Claim.findOne({
      where: { id: req.params.id, userId: req.session.user.id }
    });

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found' });
    }

    res.json({
      success: true,
      claim: {
        id: claim.id,
        userId: claim.userId,
        userName: claim.userName,
        policyNumber: claim.policyNumber,
        claimType: claim.claimType,
        description: claim.description,
        incidentDate: claim.incidentDate,
        estimatedAmount: parseFloat(claim.estimatedAmount),
        status: claim.status,
        statusHistory: claim.statusHistory,
        boxFolderId: claim.boxFolderId,
        documents: claim.documents,
        aiExtraction: claim.aiExtraction,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching claim:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch claim' });
  }
});

// Get Box access token for UI Elements
app.get('/api/box/token', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  if (!boxClient) {
    return res.status(500).json({ success: false, message: 'Box client not initialized' });
  }

  try {
    // Get access token using the SDK's token exchange
    const tokenInfo = await boxClient.exchangeToken(['base_explorer', 'base_preview', 'item_download', 'item_preview']);

    res.json({
      success: true,
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.accessTokenTTLMS ? Math.floor(tokenInfo.accessTokenTTLMS / 1000) : 3600
    });
  } catch (error) {
    console.error('Failed to get Box token:', error.message);
    // Fallback: try to get token directly from the session
    try {
      const token = await boxClient._session.getAccessToken();
      res.json({
        success: true,
        accessToken: token,
        expiresIn: 3600
      });
    } catch (fallbackError) {
      console.error('Fallback token fetch also failed:', fallbackError.message);
      res.status(500).json({ success: false, message: 'Failed to get access token' });
    }
  }
});

// Get folder contents
app.get('/api/box/folder/:id', async (req, res) => {
  if (!req.session.user || !boxClient) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  try {
    const items = await boxClient.folders.getItems(req.params.id, { limit: 100 });
    res.json({ success: true, items: items.entries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    boxConnected: !!boxClient,
    dbConnected: dbConnected,
    cloudRunApi: CLOUD_RUN_API
  });
});

// ============================================
// CAMUNDA 8 API INTEGRATION
// ============================================

// Get Camunda access token (for OAuth authentication)
async function getCamundaAccessToken() {
  if (camundaAccessToken && camundaTokenExpiry && Date.now() < camundaTokenExpiry) {
    return camundaAccessToken;
  }

  // If OAuth is configured
  if (CAMUNDA_AUTH_URL && CAMUNDA_CLIENT_ID && CAMUNDA_CLIENT_SECRET) {
    try {
      const response = await fetch(CAMUNDA_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: CAMUNDA_CLIENT_ID,
          client_secret: CAMUNDA_CLIENT_SECRET,
          audience: 'zeebe.camunda.io'
        })
      });
      const data = await response.json();
      camundaAccessToken = data.access_token;
      camundaTokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 min early
      return camundaAccessToken;
    } catch (error) {
      console.error('Failed to get Camunda access token:', error.message);
      return null;
    }
  }
  return null;
}

// Camunda API request helper
async function camundaRequest(endpoint, options = {}) {
  const token = await getCamundaAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = endpoint.startsWith('http') ? endpoint : `${CAMUNDA_REST_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Camunda API error: ${response.status} - ${errorText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    console.error('Camunda request error:', error.message);
    throw error;
  }
}

// Deploy BPMN process
app.post('/api/admin/camunda/deploy', requireAdminAuth, async (req, res) => {
  try {
    const bpmnPath = path.join(__dirname, 'public', 'claims-processing-c8.bpmn');
    const bpmnContent = fs.readFileSync(bpmnPath, 'utf8');

    const response = await camundaRequest('/v2/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data' },
      body: JSON.stringify({
        resources: [{
          name: 'claims-processing-c8.bpmn',
          content: Buffer.from(bpmnContent).toString('base64')
        }]
      })
    });

    res.json({ success: true, deployment: response });
  } catch (error) {
    // Provide demo data if Camunda is not available
    res.json({
      success: true,
      deployment: {
        key: 'demo-deployment-123',
        processDefinitionKey: PROCESS_DEFINITION_KEY,
        message: 'Demo mode - Camunda server not connected'
      },
      demo: true
    });
  }
});

// Start a process instance for a claim
app.post('/api/admin/camunda/start-process', requireAdminAuth, async (req, res) => {
  try {
    const { claimId, variables } = req.body;

    const response = await camundaRequest('/v2/process-instances', {
      method: 'POST',
      body: JSON.stringify({
        processDefinitionKey: PROCESS_DEFINITION_KEY,
        variables: {
          claimId: { value: claimId, type: 'String' },
          ...variables
        }
      })
    });

    // Update claim with process instance ID
    const claim = await Claim.findByPk(claimId);
    if (claim) {
      await claim.update({
        processInstanceKey: response.key || response.processInstanceKey,
        workflowStatus: 'STARTED'
      });
    }

    res.json({ success: true, processInstance: response });
  } catch (error) {
    // Demo mode response
    const demoProcessKey = `demo-process-${Date.now()}`;
    const claim = await Claim.findByPk(req.body.claimId);
    if (claim) {
      await claim.update({
        processInstanceKey: demoProcessKey,
        workflowStatus: 'STARTED'
      });
    }

    res.json({
      success: true,
      processInstance: {
        key: demoProcessKey,
        processDefinitionKey: PROCESS_DEFINITION_KEY,
        status: 'ACTIVE'
      },
      demo: true
    });
  }
});

// Get process instance details
app.get('/api/admin/camunda/process/:processKey', requireAdminAuth, async (req, res) => {
  try {
    const { processKey } = req.params;

    const response = await camundaRequest(`/v2/process-instances/${processKey}`);
    res.json({ success: true, processInstance: response });
  } catch (error) {
    // Demo mode - return simulated process state
    res.json({
      success: true,
      processInstance: {
        key: req.params.processKey,
        processDefinitionKey: PROCESS_DEFINITION_KEY,
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 3600000).toISOString(),
        currentActivity: 'Task_AdjusterReview'
      },
      demo: true
    });
  }
});

// Get active element positions for a claim
app.get('/api/admin/camunda/claim/:claimId/flow-nodes', requireAdminAuth, async (req, res) => {
  try {
    const { claimId } = req.params;
    const claim = await Claim.findByPk(claimId);

    if (!claim || !claim.processInstanceKey) {
      return res.status(404).json({ success: false, message: 'No process instance found for this claim' });
    }

    const response = await camundaRequest(`/v2/process-instances/${claim.processInstanceKey}/flow-node-instances`);
    res.json({ success: true, flowNodes: response });
  } catch (error) {
    // Demo mode - return simulated flow nodes based on claim status
    const claim = await Claim.findByPk(req.params.claimId);
    let currentNode = 'Task_AdjusterReview';

    if (claim) {
      switch (claim.status) {
        case 'Submitted': currentNode = 'Task_CalculateRiskScore'; break;
        case 'Under Review': currentNode = 'Task_AdjusterReview'; break;
        case 'Pending Documents': currentNode = 'Event_WaitForDocuments'; break;
        case 'Approved': currentNode = 'Task_GenerateSettlement'; break;
        case 'Investigation': currentNode = 'Task_InvestigatorReview'; break;
        case 'Denied': currentNode = 'End_ClaimDenied'; break;
        case 'Paid': currentNode = 'End_ClaimPaid'; break;
        default: currentNode = 'Task_AdjusterReview';
      }
    }

    res.json({
      success: true,
      flowNodes: [{
        flowNodeId: currentNode,
        state: 'ACTIVE',
        startDate: new Date().toISOString()
      }],
      demo: true
    });
  }
});

// Get tasks for a claim
app.get('/api/admin/camunda/claim/:claimId/tasks', requireAdminAuth, async (req, res) => {
  try {
    const { claimId } = req.params;

    // Query Tasklist API
    const response = await camundaRequest(`${CAMUNDA_TASKLIST_URL}/v1/tasks/search`, {
      method: 'POST',
      body: JSON.stringify({
        state: 'CREATED',
        processInstanceKey: claimId,
        pageSize: 50
      })
    });

    res.json({ success: true, tasks: response });
  } catch (error) {
    // Demo mode - return simulated tasks
    const claim = await Claim.findByPk(req.params.claimId);
    let demoTasks = [];

    if (claim && ['Under Review', 'Submitted'].includes(claim.status)) {
      demoTasks = [{
        id: `task-${claim.id}-1`,
        name: 'Adjuster Claim Review',
        taskDefinitionId: 'Task_AdjusterReview',
        assignee: null,
        candidateGroups: ['Claims_Adjusters'],
        creationDate: claim.createdAt,
        processInstanceKey: claim.processInstanceKey || `demo-${claim.id}`,
        variables: {
          claimId: claim.id,
          estimatedAmount: claim.estimatedAmount
        }
      }];
    } else if (claim && claim.status === 'Investigation') {
      demoTasks = [{
        id: `task-${claim.id}-inv`,
        name: 'SIU Investigation',
        taskDefinitionId: 'Task_InvestigatorReview',
        assignee: null,
        candidateGroups: ['SIU_Investigators'],
        creationDate: claim.updatedAt,
        processInstanceKey: claim.processInstanceKey || `demo-${claim.id}`,
        variables: {
          claimId: claim.id,
          riskScore: 85
        }
      }];
    }

    res.json({
      success: true,
      tasks: demoTasks,
      demo: true
    });
  }
});

// Complete a task (approve/reject/escalate)
app.post('/api/admin/camunda/task/:taskId/complete', requireAdminAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { variables, claimId } = req.body;

    const response = await camundaRequest(`${CAMUNDA_TASKLIST_URL}/v1/tasks/${taskId}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ variables })
    });

    res.json({ success: true, result: response });
  } catch (error) {
    // Demo mode - update claim status based on decision
    const { variables, claimId } = req.body;
    const claim = await Claim.findByPk(claimId);

    if (claim && variables) {
      let newStatus = claim.status;
      const decision = variables.adjusterDecision?.value ||
                       variables.reviewDecision?.value ||
                       variables.managerDecision?.value ||
                       variables.investigationOutcome?.value;

      if (decision === 'approve' || decision === 'approved' || decision === 'CLEARED') {
        newStatus = 'Approved';
      } else if (decision === 'deny' || decision === 'FRAUD_CONFIRMED') {
        newStatus = 'Denied';
      } else if (decision === 'escalate') {
        newStatus = 'Escalated';
      } else if (decision === 'request_more_docs') {
        newStatus = 'Pending Documents';
      }

      const statusHistory = claim.statusHistory || [];
      statusHistory.unshift({
        status: newStatus,
        date: new Date().toISOString(),
        note: `Task completed with decision: ${decision}`,
        updatedBy: req.session.adminUser?.name || 'System'
      });

      await claim.update({ status: newStatus, statusHistory });
    }

    res.json({
      success: true,
      result: { completed: true, taskId: req.params.taskId },
      demo: true
    });
  }
});

// Claim a task
app.post('/api/admin/camunda/task/:taskId/claim', requireAdminAuth, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { assignee } = req.body;

    const response = await camundaRequest(`${CAMUNDA_TASKLIST_URL}/v1/tasks/${taskId}/claim`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee: assignee || req.session.adminUser?.id })
    });

    res.json({ success: true, result: response });
  } catch (error) {
    res.json({
      success: true,
      result: { claimed: true, assignee: req.body.assignee || req.session.adminUser?.id },
      demo: true
    });
  }
});

// Publish a message (e.g., document uploaded, signature complete)
app.post('/api/admin/camunda/message', requireAdminAuth, async (req, res) => {
  try {
    const { messageName, correlationKey, variables } = req.body;

    const response = await camundaRequest('/v2/messages', {
      method: 'POST',
      body: JSON.stringify({
        name: messageName,
        correlationKey,
        variables
      })
    });

    res.json({ success: true, result: response });
  } catch (error) {
    res.json({
      success: true,
      result: { published: true, messageName: req.body.messageName },
      demo: true
    });
  }
});

// Get BPMN XML for rendering
app.get('/api/admin/camunda/process-definition/bpmn', requireAdminAuth, async (req, res) => {
  try {
    const bpmnPath = path.join(__dirname, 'public', 'claims-processing-c8.bpmn');
    const bpmnContent = fs.readFileSync(bpmnPath, 'utf8');
    res.set('Content-Type', 'application/xml');
    res.send(bpmnContent);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load BPMN' });
  }
});

// Get Camunda connection status
app.get('/api/admin/camunda/status', requireAdminAuth, async (req, res) => {
  try {
    const response = await camundaRequest('/v2/topology');
    res.json({
      success: true,
      connected: true,
      topology: response,
      config: {
        restUrl: CAMUNDA_REST_URL,
        operateUrl: CAMUNDA_OPERATE_URL,
        tasklistUrl: CAMUNDA_TASKLIST_URL
      }
    });
  } catch (error) {
    res.json({
      success: true,
      connected: false,
      demo: true,
      message: 'Running in demo mode - Camunda server not connected',
      config: {
        restUrl: CAMUNDA_REST_URL,
        operateUrl: CAMUNDA_OPERATE_URL,
        tasklistUrl: CAMUNDA_TASKLIST_URL
      }
    });
  }
});

// ============================================
// ADMIN API ROUTES
// ============================================

// Admin users (in production, these would be in the database)
const adminUsers = {
  'admin@suresafe.com': {
    id: 'ADM001',
    name: 'Admin User',
    email: 'admin@suresafe.com',
    password: 'admin123'
  },
  'adjuster@suresafe.com': {
    id: 'ADM002',
    name: 'Sarah Mitchell',
    email: 'adjuster@suresafe.com',
    password: 'admin123'
  },
  'supervisor@suresafe.com': {
    id: 'ADM003',
    name: 'Michael Chen',
    email: 'supervisor@suresafe.com',
    password: 'admin123'
  },
  'investigator@suresafe.com': {
    id: 'ADM004',
    name: 'David Thompson',
    email: 'investigator@suresafe.com',
    password: 'admin123'
  },
  'legal@suresafe.com': {
    id: 'ADM005',
    name: 'Jennifer Roberts',
    email: 'legal@suresafe.com',
    password: 'admin123'
  },
  'executive@suresafe.com': {
    id: 'ADM006',
    name: 'Robert Williams',
    email: 'executive@suresafe.com',
    password: 'admin123'
  }
};

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password, role } = req.body;

  // Check for any admin user with correct password
  const adminUser = adminUsers[email] || adminUsers['admin@suresafe.com'];

  if (adminUser && (password === 'admin123' || adminUser.password === password)) {
    req.session.adminUser = {
      ...adminUser,
      role: role || 'adjuster',
      password: undefined
    };
    res.json({ success: true, user: req.session.adminUser });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Admin Logout
app.post('/api/admin/logout', (req, res) => {
  req.session.adminUser = null;
  res.json({ success: true });
});

// Get current admin user
app.get('/api/admin/user', (req, res) => {
  if (req.session.adminUser) {
    res.json({ success: true, user: req.session.adminUser });
  } else {
    res.status(401).json({ success: false, message: 'Not authenticated' });
  }
});

// Get all claims (admin)
app.get('/api/admin/claims', requireAdminAuth, async (req, res) => {
  try {
    const { limit, status, type } = req.query;

    let whereClause = {};
    if (status) {
      whereClause.status = status;
    }
    if (type) {
      whereClause.claimType = { [Sequelize.Op.like]: `%${type}%` };
    }

    const claims = await Claim.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: limit ? parseInt(limit) : undefined
    });

    const formattedClaims = claims.map(claim => ({
      id: claim.id,
      userId: claim.userId,
      userName: claim.userName,
      policyNumber: claim.policyNumber,
      claimType: claim.claimType,
      description: claim.description,
      incidentDate: claim.incidentDate,
      estimatedAmount: parseFloat(claim.estimatedAmount),
      status: claim.status,
      statusHistory: claim.statusHistory,
      boxFolderId: claim.boxFolderId,
      documents: claim.documents,
      aiExtraction: claim.aiExtraction,
      processInstanceKey: claim.processInstanceKey,
      workflowStatus: claim.workflowStatus,
      riskScore: claim.riskScore,
      assignedAdjusterId: claim.assignedAdjusterId,
      assignedAdjusterName: claim.assignedAdjusterName,
      createdAt: claim.createdAt,
      updatedAt: claim.updatedAt
    }));

    res.json({ success: true, claims: formattedClaims });
  } catch (error) {
    console.error('Error fetching admin claims:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch claims' });
  }
});

// Get single claim (admin)
app.get('/api/admin/claims/:id', requireAdminAuth, async (req, res) => {
  try {
    const claim = await Claim.findByPk(req.params.id);

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found' });
    }

    res.json({
      success: true,
      claim: {
        id: claim.id,
        userId: claim.userId,
        userName: claim.userName,
        policyNumber: claim.policyNumber,
        claimType: claim.claimType,
        description: claim.description,
        incidentDate: claim.incidentDate,
        estimatedAmount: parseFloat(claim.estimatedAmount),
        status: claim.status,
        statusHistory: claim.statusHistory,
        boxFolderId: claim.boxFolderId,
        documents: claim.documents,
        aiExtraction: claim.aiExtraction,
        processInstanceKey: claim.processInstanceKey,
        workflowStatus: claim.workflowStatus,
        riskScore: claim.riskScore,
        assignedAdjusterId: claim.assignedAdjusterId,
        assignedAdjusterName: claim.assignedAdjusterName,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching claim:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch claim' });
  }
});

// Update claim status (admin)
app.put('/api/admin/claims/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const claim = await Claim.findByPk(req.params.id);

    if (!claim) {
      return res.status(404).json({ success: false, message: 'Claim not found' });
    }

    // Update status history
    const statusHistory = claim.statusHistory || [];
    statusHistory.unshift({
      status,
      date: new Date().toISOString(),
      note: notes || `Status updated to ${status} by ${req.session.adminUser.name}`,
      updatedBy: req.session.adminUser.name
    });

    await claim.update({
      status,
      statusHistory,
      updatedAt: new Date()
    });

    res.json({ success: true, claim });
  } catch (error) {
    console.error('Error updating claim status:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update claim' });
  }
});

// Get Box token (admin)
// Accepts optional folderId query param to scope token to specific folder
app.get('/api/admin/box/token', requireAdminAuth, async (req, res) => {
  if (!boxClient) {
    return res.status(500).json({ success: false, message: 'Box client not initialized' });
  }

  try {
    const folderId = req.query.folderId;
    const scopes = ['base_explorer', 'base_preview', 'item_download', 'item_preview', 'item_upload', 'item_share', 'item_rename', 'item_delete'];

    let tokenInfo;
    if (folderId) {
      // Scope token to specific folder for better security
      const resource = `https://api.box.com/2.0/folders/${folderId}`;
      tokenInfo = await boxClient.exchangeToken(scopes, resource);
    } else {
      // Fallback: get unscoped token (use service account token directly)
      const token = await boxClient._session.getAccessToken();
      return res.json({
        success: true,
        accessToken: token,
        expiresIn: 3600
      });
    }

    res.json({
      success: true,
      accessToken: tokenInfo.accessToken,
      expiresIn: tokenInfo.accessTokenTTLMS ? Math.floor(tokenInfo.accessTokenTTLMS / 1000) : 3600
    });
  } catch (error) {
    console.error('Failed to get Box token:', error.message);
    try {
      // Fallback: use service account token directly
      const token = await boxClient._session.getAccessToken();
      res.json({
        success: true,
        accessToken: token,
        expiresIn: 3600
      });
    } catch (fallbackError) {
      console.error('Fallback token fetch also failed:', fallbackError.message);
      res.status(500).json({ success: false, message: 'Failed to get access token' });
    }
  }
});

// Get files from a Box folder (admin)
app.get('/api/admin/box/folder/:folderId/files', requireAdminAuth, async (req, res) => {
  if (!boxClient) {
    return res.status(500).json({ success: false, message: 'Box client not initialized' });
  }

  try {
    const folderId = req.params.folderId;
    const folderItems = await boxClient.folders.getItems(folderId, {
      fields: 'id,name,size,type,modified_at,created_at',
      limit: 100
    });

    const files = folderItems.entries
      .filter(item => item.type === 'file')
      .map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        modifiedAt: file.modified_at,
        createdAt: file.created_at
      }));

    res.json({ success: true, files });
  } catch (error) {
    console.error('Failed to get folder files:', error.message);
    res.status(500).json({ success: false, message: 'Failed to get folder files' });
  }
});

// Upload AI result as text file to Box folder
app.post('/api/admin/box/upload-ai-result', requireAdminAuth, async (req, res) => {
  if (!boxClient) {
    return res.status(500).json({ success: false, message: 'Box client not initialized' });
  }

  try {
    const { folderId, claimId, type, title, data, timestamp } = req.body;

    if (!folderId || !claimId || !type || !data) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Document classification mapping (hardcoded for demo)
    const classificationMap = {
      extraction: {
        category: 'AI_Analysis',
        subCategory: 'Information_Extraction',
        confidentiality: 'Internal',
        priority: 'Normal'
      },
      summary: {
        category: 'AI_Analysis',
        subCategory: 'Document_Summary',
        confidentiality: 'Internal',
        priority: 'Normal'
      },
      fraud: {
        category: 'AI_Analysis',
        subCategory: 'Fraud_Detection',
        confidentiality: 'Confidential',
        priority: 'High'
      },
      question: {
        category: 'AI_Analysis',
        subCategory: 'Q_and_A',
        confidentiality: 'Internal',
        priority: 'Normal'
      },
      upsell: {
        category: 'Sales',
        subCategory: 'Upsell_Opportunity',
        confidentiality: 'Internal',
        priority: 'High'
      }
    };

    const classification = classificationMap[type] || classificationMap.extraction;

    // Generate formatted text content
    const formattedDate = new Date(timestamp || Date.now()).toLocaleString();
    const fileContent = `
================================================================================
                         BOX AI ANALYSIS REPORT
================================================================================

CLAIM ID:        ${claimId}
ANALYSIS TYPE:   ${title}
CATEGORY:        ${classification.category}
SUB-CATEGORY:    ${classification.subCategory}
CONFIDENTIALITY: ${classification.confidentiality}
PRIORITY:        ${classification.priority}
GENERATED:       ${formattedDate}
GENERATED BY:    Box AI / SureSafe Claims Intelligence

================================================================================
                              ANALYSIS RESULTS
================================================================================

${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}

================================================================================
                              END OF REPORT
================================================================================

This document was automatically generated by Box AI as part of the SureSafe
Claims Intelligence Platform. The analysis is provided for informational
purposes and should be reviewed by a qualified claims adjuster.

Classification: ${classification.confidentiality}
Document Type: ${classification.subCategory}
`;

    // Create filename based on type and timestamp
    const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_');
    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `BoxAI_${safeTitle}_${claimId}_${dateStr}.txt`;

    // Upload to Box
    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const uploadedFile = await boxClient.files.uploadFile(folderId, fileName, fileBuffer);

    const fileId = uploadedFile.entries[0].id;

    // Try to apply metadata (classification) - this is optional and may fail if template doesn't exist
    try {
      await boxClient.files.addMetadata(fileId, 'enterprise', 'claimsClassification', {
        category: classification.category,
        subCategory: classification.subCategory,
        confidentiality: classification.confidentiality,
        priority: classification.priority,
        claimId: claimId,
        generatedBy: 'Box AI',
        analysisType: type
      });
    } catch (metadataError) {
      // Metadata template may not exist, that's okay for demo
      console.log('Could not apply metadata (template may not exist):', metadataError.message);
    }

    res.json({
      success: true,
      file: {
        id: fileId,
        name: fileName,
        classification: classification
      },
      message: `AI analysis saved to Box as "${fileName}"`
    });

  } catch (error) {
    console.error('Failed to upload AI result:', error.message);
    res.status(500).json({ success: false, message: 'Failed to upload AI result to Box' });
  }
});

// ============================================
// SALESFORCE INTEGRATION
// ============================================

// Salesforce credentials from environment variables
const SALESFORCE_CONFIG = {
  clientId: process.env.SALESFORCE_CLIENT_ID,
  clientSecret: process.env.SALESFORCE_CLIENT_SECRET,
  username: process.env.SALESFORCE_USERNAME,
  password: process.env.SALESFORCE_PASSWORD,
  securityToken: process.env.SALESFORCE_SECURITY_TOKEN,
  loginUrl: process.env.SALESFORCE_LOGIN_URL || 'https://login.salesforce.com'
};

// Get Salesforce access token
async function getSalesforceToken() {
  const { clientId, clientSecret, username, password, securityToken, loginUrl } = SALESFORCE_CONFIG;

  if (!clientId || !clientSecret || !username || !password) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username: username,
      password: password + (securityToken || '')
    });

    const response = await fetch(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await response.json();

    if (data.access_token) {
      return {
        accessToken: data.access_token,
        instanceUrl: data.instance_url
      };
    }

    console.error('Salesforce auth failed:', data);
    return null;
  } catch (error) {
    console.error('Salesforce token error:', error.message);
    return null;
  }
}

// Create Salesforce Lead from upsell opportunity
app.post('/api/admin/salesforce/create-lead', requireAdminAuth, async (req, res) => {
  try {
    const {
      claimId,
      claimType,
      customerName,
      customerEmail,
      policyNumber,
      upsellRecommendations,
      estimatedValue,
      source
    } = req.body;

    // Check if Salesforce is configured
    if (!SALESFORCE_CONFIG.clientId) {
      return res.json({
        success: false,
        message: 'Salesforce not configured. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_USERNAME, and SALESFORCE_PASSWORD environment variables.'
      });
    }

    // Get Salesforce access token
    const sfAuth = await getSalesforceToken();
    if (!sfAuth) {
      return res.json({
        success: false,
        message: 'Failed to authenticate with Salesforce. Check credentials.'
      });
    }

    // Parse customer name into first/last
    const nameParts = customerName.split(' ');
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || 'Customer';

    // Create Lead in Salesforce
    const leadData = {
      FirstName: firstName,
      LastName: lastName,
      Email: customerEmail,
      Company: `Policy: ${policyNumber}`,
      LeadSource: source || 'Box AI Analysis',
      Status: 'New',
      Description: `Upsell Opportunity from Claim ${claimId}\n\nClaim Type: ${claimType}\nPolicy Number: ${policyNumber}\n\n--- AI Recommendations ---\n${upsellRecommendations}`,
      Rating: estimatedValue > 400 ? 'Hot' : estimatedValue > 200 ? 'Warm' : 'Cold',
      Industry: 'Insurance',
      // Custom fields (if they exist in your Salesforce org)
      // Claim_ID__c: claimId,
      // Estimated_Value__c: estimatedValue,
      // Claim_Type__c: claimType
    };

    const createResponse = await fetch(`${sfAuth.instanceUrl}/services/data/v59.0/sobjects/Lead`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sfAuth.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(leadData)
    });

    const result = await createResponse.json();

    if (result.success || result.id) {
      console.log('Salesforce Lead created:', result.id);
      res.json({
        success: true,
        leadId: result.id,
        message: 'Lead created successfully in Salesforce'
      });
    } else {
      console.error('Salesforce create failed:', result);
      res.json({
        success: false,
        message: result.message || result[0]?.message || 'Failed to create lead',
        errors: result
      });
    }

  } catch (error) {
    console.error('Salesforce lead creation error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Error creating Salesforce lead'
    });
  }
});

// Admin HTML routes
app.get('/admin', (req, res) => {
  if (req.session.adminUser) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

app.get('/admin/dashboard', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/admin/claims', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-claims.html'));
});

app.get('/admin/claim/:id', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-claim-detail.html'));
});

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/submit-claim', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'submit-claim.html'));
});

app.get('/claims', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claims.html'));
});

app.get('/claim/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'claim-detail.html'));
});

// Start server
async function startServer() {
  // Initialize database
  dbConnected = await initDatabase();

  app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('SureSafe Insurance Member Portal');
    console.log('='.repeat(60));
    console.log(`Server running at: http://localhost:${PORT}`);
    console.log(`Box SDK: ${boxClient ? 'Connected' : 'Not connected'}`);
    console.log(`Database: ${dbConnected ? 'Connected' : 'Not connected'}`);
    console.log(`Cloud Run API: ${CLOUD_RUN_API}`);
    console.log(`Claims Folder ID: ${CLAIMS_FOLDER_ID}`);
    console.log('='.repeat(60));
    console.log('\nMember Portal credentials:');
    console.log('  Email: john.smith@email.com');
    console.log('  Password: demo123');
    console.log('\nAdmin Portal credentials:');
    console.log('  URL: /admin');
    console.log('  Email: admin@suresafe.com');
    console.log('  Password: admin123');
    console.log('='.repeat(60) + '\n');
  });
}

startServer();
