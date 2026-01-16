import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import BoxSDK from 'box-node-sdk';
import swaggerUi from 'swagger-ui-express';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// OpenAPI/Swagger documentation
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'SureSafe Box AI Extraction API',
    version: '1.0.0',
    description: 'API for extracting structured data from insurance documents using Box AI',
    contact: { name: 'Mystro Analytics', email: 'support@mystroanalytics.com' }
  },
  servers: [
    { url: process.env.CLOUD_RUN_URL || 'http://localhost:8080', description: 'API Server' }
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: { '200': { description: 'Service is healthy' } }
      }
    },
    '/extract': {
      post: {
        summary: 'Extract structured data from a document',
        tags: ['Extraction'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fileId', 'extractionType'],
                properties: {
                  fileId: { type: 'string', description: 'Box file ID' },
                  extractionType: { type: 'string', enum: ['fnol', 'medical', 'estimate', 'police', 'invoice'] }
                }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Extraction successful' },
          '400': { description: 'Invalid request' },
          '500': { description: 'Extraction failed' }
        }
      }
    },
    '/ask': {
      post: {
        summary: 'Ask a question about a document',
        tags: ['AI'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fileId', 'question'],
                properties: {
                  fileId: { type: 'string' },
                  question: { type: 'string' }
                }
              }
            }
          }
        },
        responses: { '200': { description: 'Answer returned' } }
      }
    },
    '/summarize': {
      post: {
        summary: 'Summarize a document',
        tags: ['AI'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fileId'],
                properties: {
                  fileId: { type: 'string' },
                  summaryType: { type: 'string', enum: ['claim', 'medical', 'general'] }
                }
              }
            }
          }
        },
        responses: { '200': { description: 'Summary returned' } }
      }
    },
    '/analyze-fraud': {
      post: {
        summary: 'Analyze document for fraud indicators',
        tags: ['AI'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['fileId'],
                properties: { fileId: { type: 'string' } }
              }
            }
          }
        },
        responses: { '200': { description: 'Fraud analysis returned' } }
      }
    },
    '/extraction-types': {
      get: {
        summary: 'List supported extraction types',
        tags: ['Extraction'],
        responses: { '200': { description: 'List of extraction types' } }
      }
    },
    '/webhook/box': {
      post: {
        summary: 'Box webhook handler',
        tags: ['Webhooks'],
        responses: { '200': { description: 'Webhook received' } }
      }
    }
  }
};

// Serve Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));

// Box SDK Configuration
let boxClient = null;

function initializeBoxClient() {
  let config;

  // Try to load from BOX_CONFIG JSON string first
  if (process.env.BOX_CONFIG) {
    config = JSON.parse(process.env.BOX_CONFIG);
  } else {
    // Build config from individual environment variables
    let privateKey = process.env.BOX_PRIVATE_KEY || '';

    // If it's base64 encoded, decode it
    if (privateKey && !privateKey.includes('-----BEGIN')) {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
    }

    config = {
      boxAppSettings: {
        clientID: process.env.BOX_CLIENT_ID,
        clientSecret: process.env.BOX_CLIENT_SECRET,
        appAuth: {
          publicKeyID: process.env.BOX_JWT_KEY_ID,
          privateKey: privateKey,
          passphrase: process.env.BOX_PASSPHRASE
        }
      },
      enterpriseID: process.env.BOX_ENTERPRISE_ID
    };
  }

  const sdk = BoxSDK.getPreconfiguredInstance(config);
  boxClient = sdk.getAppAuthClient('enterprise');
  console.log('Box client initialized');
}

// Extraction field definitions for different document types
const EXTRACTION_CONFIGS = {
  fnol: {
    name: 'FNOL_Extraction',
    prompt: `Extract the following information from this First Notice of Loss document:

1. Claimant full name
2. Date of loss (incident date)
3. Time of loss
4. Location of incident (address)
5. Description of incident
6. Type of loss (auto collision, property damage, injury, etc.)
7. Policy number
8. Contact phone number
9. Contact email
10. Injuries reported (yes/no, description if yes)
11. Police report filed (yes/no, report number if yes)
12. Other parties involved (names, contact info)
13. Witnesses (names, contact info)
14. Estimated damage amount
15. Vehicle information (if auto claim: year, make, model, VIN)

Return the extracted data in a structured JSON format.`,
    fields: [
      { key: 'claimantName', type: 'string', description: 'Full name of the claimant' },
      { key: 'dateOfLoss', type: 'date', description: 'Date when the incident occurred' },
      { key: 'timeOfLoss', type: 'string', description: 'Time when the incident occurred' },
      { key: 'incidentLocation', type: 'string', description: 'Full address where incident occurred' },
      { key: 'incidentDescription', type: 'string', description: 'Detailed description of what happened' },
      { key: 'lossType', type: 'string', description: 'Type of loss (auto collision, property damage, etc.)' },
      { key: 'policyNumber', type: 'string', description: 'Insurance policy number' },
      { key: 'contactPhone', type: 'string', description: 'Claimant phone number' },
      { key: 'contactEmail', type: 'string', description: 'Claimant email address' },
      { key: 'injuriesReported', type: 'string', description: 'Were injuries reported (yes/no)' },
      { key: 'injuryDescription', type: 'string', description: 'Description of injuries if any' },
      { key: 'policeReportFiled', type: 'string', description: 'Was police report filed (yes/no)' },
      { key: 'policeReportNumber', type: 'string', description: 'Police report number if filed' },
      { key: 'otherParties', type: 'string', description: 'Names of other parties involved' },
      { key: 'witnesses', type: 'string', description: 'Names of witnesses' },
      { key: 'estimatedDamage', type: 'string', description: 'Estimated damage amount in dollars' },
      { key: 'vehicleYear', type: 'string', description: 'Vehicle year' },
      { key: 'vehicleMake', type: 'string', description: 'Vehicle make' },
      { key: 'vehicleModel', type: 'string', description: 'Vehicle model' },
      { key: 'vehicleVIN', type: 'string', description: 'Vehicle identification number' }
    ]
  },

  medical: {
    name: 'Medical_Record_Extraction',
    prompt: `Extract the following information from this medical record:

1. Patient name
2. Date of service
3. Provider name and facility
4. Provider type (ER, physician, specialist, etc.)
5. Chief complaint
6. Diagnosis (ICD-10 codes if available)
7. Treatment provided
8. Procedures performed (CPT codes if available)
9. Medications prescribed
10. Follow-up instructions
11. Work restrictions (if any)
12. Prognosis
13. Total charges
14. Is this related to an accident/injury? (yes/no)

Return structured JSON format.`,
    fields: [
      { key: 'patientName', type: 'string', description: 'Patient full name' },
      { key: 'dateOfService', type: 'date', description: 'Date of medical service' },
      { key: 'providerName', type: 'string', description: 'Doctor or provider name' },
      { key: 'facilityName', type: 'string', description: 'Hospital or clinic name' },
      { key: 'providerType', type: 'string', description: 'Type of provider (ER, specialist, etc.)' },
      { key: 'chiefComplaint', type: 'string', description: 'Primary reason for visit' },
      { key: 'diagnoses', type: 'string', description: 'Medical diagnoses' },
      { key: 'icd10Codes', type: 'string', description: 'ICD-10 diagnosis codes' },
      { key: 'treatmentProvided', type: 'string', description: 'Treatment provided' },
      { key: 'procedures', type: 'string', description: 'Procedures performed' },
      { key: 'cptCodes', type: 'string', description: 'CPT procedure codes' },
      { key: 'medications', type: 'string', description: 'Medications prescribed' },
      { key: 'followUpInstructions', type: 'string', description: 'Follow-up care instructions' },
      { key: 'workRestrictions', type: 'string', description: 'Work restrictions if any' },
      { key: 'prognosis', type: 'string', description: 'Expected recovery prognosis' },
      { key: 'totalCharges', type: 'string', description: 'Total charges in dollars' },
      { key: 'accidentRelated', type: 'string', description: 'Is treatment accident related (yes/no)' }
    ]
  },

  estimate: {
    name: 'Repair_Estimate_Extraction',
    prompt: `Extract the following from this repair estimate:

1. Estimate provider (shop name)
2. Estimate date
3. Estimate number
4. Vehicle/Property information
5. Line items (description, quantity, unit price, total)
6. Parts total
7. Labor total
8. Labor hours
9. Labor rate
10. Materials/supplies total
11. Sublet work
12. Tax
13. Grand total
14. Repair vs Replace decisions
15. Supplemental estimate? (yes/no)

Return structured JSON.`,
    fields: [
      { key: 'estimateProvider', type: 'string', description: 'Name of repair shop' },
      { key: 'estimateDate', type: 'date', description: 'Date estimate was created' },
      { key: 'estimateNumber', type: 'string', description: 'Estimate reference number' },
      { key: 'vehicleInfo', type: 'string', description: 'Vehicle year/make/model' },
      { key: 'lineItems', type: 'string', description: 'Description of repair items' },
      { key: 'partsTotal', type: 'string', description: 'Total cost of parts' },
      { key: 'laborTotal', type: 'string', description: 'Total labor cost' },
      { key: 'laborHours', type: 'string', description: 'Total labor hours' },
      { key: 'laborRate', type: 'string', description: 'Labor rate per hour' },
      { key: 'materialsTotal', type: 'string', description: 'Materials and supplies total' },
      { key: 'subletTotal', type: 'string', description: 'Sublet work total' },
      { key: 'tax', type: 'string', description: 'Tax amount' },
      { key: 'grandTotal', type: 'string', description: 'Grand total amount' },
      { key: 'repairVsReplace', type: 'string', description: 'Repair or replace decision' },
      { key: 'isSupplemental', type: 'string', description: 'Is this a supplemental estimate (yes/no)' }
    ]
  },

  police: {
    name: 'Police_Report_Extraction',
    prompt: `Extract the following from this police/accident report:

1. Report number
2. Report date and time
3. Incident date and time
4. Incident location (full address)
5. Reporting officer name and badge number
6. Agency name
7. Involved parties (names, DOB, addresses, driver license)
8. Vehicles involved (year, make, model, plate, VIN)
9. Narrative/description of incident
10. Citations issued (to whom, violation)
11. Fault determination (if stated)
12. Injuries reported
13. Witnesses
14. Damage description
15. Weather/road conditions
16. Diagram included? (yes/no)

Return structured JSON.`,
    fields: [
      { key: 'reportNumber', type: 'string', description: 'Police report number' },
      { key: 'reportDate', type: 'date', description: 'Date report was filed' },
      { key: 'incidentDateTime', type: 'string', description: 'Date and time of incident' },
      { key: 'incidentLocation', type: 'string', description: 'Full address of incident' },
      { key: 'officerName', type: 'string', description: 'Reporting officer name' },
      { key: 'badgeNumber', type: 'string', description: 'Officer badge number' },
      { key: 'agencyName', type: 'string', description: 'Police department name' },
      { key: 'involvedParties', type: 'string', description: 'Names of all involved parties' },
      { key: 'vehicles', type: 'string', description: 'Vehicle information' },
      { key: 'narrative', type: 'string', description: 'Description of what happened' },
      { key: 'citations', type: 'string', description: 'Citations issued' },
      { key: 'faultDetermination', type: 'string', description: 'Fault determination if stated' },
      { key: 'injuries', type: 'string', description: 'Injuries reported' },
      { key: 'witnesses', type: 'string', description: 'Witness names' },
      { key: 'damageDescription', type: 'string', description: 'Description of damages' },
      { key: 'weatherConditions', type: 'string', description: 'Weather conditions' },
      { key: 'roadConditions', type: 'string', description: 'Road conditions' },
      { key: 'diagramIncluded', type: 'string', description: 'Diagram included (yes/no)' }
    ]
  },

  invoice: {
    name: 'Vendor_Invoice_Extraction',
    prompt: `Extract the following from this vendor invoice:

1. Vendor name
2. Vendor address
3. Invoice number
4. Invoice date
5. Due date
6. Service description
7. Line items with amounts
8. Subtotal
9. Tax
10. Total amount
11. Payment terms
12. Reference/claim number

Return structured JSON.`,
    fields: [
      { key: 'vendorName', type: 'string', description: 'Vendor company name' },
      { key: 'vendorAddress', type: 'string', description: 'Vendor address' },
      { key: 'invoiceNumber', type: 'string', description: 'Invoice number' },
      { key: 'invoiceDate', type: 'date', description: 'Invoice date' },
      { key: 'dueDate', type: 'date', description: 'Payment due date' },
      { key: 'serviceDescription', type: 'string', description: 'Description of services' },
      { key: 'lineItems', type: 'string', description: 'Line items and amounts' },
      { key: 'subtotal', type: 'string', description: 'Subtotal amount' },
      { key: 'tax', type: 'string', description: 'Tax amount' },
      { key: 'totalAmount', type: 'string', description: 'Total invoice amount' },
      { key: 'paymentTerms', type: 'string', description: 'Payment terms' },
      { key: 'claimReference', type: 'string', description: 'Related claim number' }
    ]
  },

  insurance_claim: {
    name: 'Insurance_Claim_Extraction',
    prompt: `Extract the following information from this insurance claim document:

1. Claimant full name
2. Policy number
3. Claim type (auto, property, health, life, etc.)
4. Date of incident/loss
5. Location of incident
6. Description of incident
7. Estimated claim amount
8. Contact information (phone, email, address)
9. Injuries reported (if any)
10. Property damage description (if any)
11. Third parties involved (names, contact info)
12. Witnesses (names, contact info)
13. Police/fire report filed (yes/no, report number)
14. Supporting documents listed
15. Claim status

Return the extracted data in a structured JSON format.`,
    fields: [
      { key: 'claimantName', type: 'string', description: 'Full name of the claimant' },
      { key: 'policyNumber', type: 'string', description: 'Insurance policy number' },
      { key: 'claimType', type: 'string', description: 'Type of insurance claim' },
      { key: 'dateOfIncident', type: 'date', description: 'Date when the incident occurred' },
      { key: 'incidentLocation', type: 'string', description: 'Location where incident occurred' },
      { key: 'incidentDescription', type: 'string', description: 'Detailed description of the incident' },
      { key: 'estimatedAmount', type: 'string', description: 'Estimated claim amount in dollars' },
      { key: 'contactPhone', type: 'string', description: 'Claimant phone number' },
      { key: 'contactEmail', type: 'string', description: 'Claimant email address' },
      { key: 'contactAddress', type: 'string', description: 'Claimant address' },
      { key: 'injuriesReported', type: 'string', description: 'Description of injuries if any' },
      { key: 'propertyDamage', type: 'string', description: 'Description of property damage' },
      { key: 'thirdParties', type: 'string', description: 'Third parties involved' },
      { key: 'witnesses', type: 'string', description: 'Witness names and contact info' },
      { key: 'policeReportFiled', type: 'string', description: 'Police/fire report filed (yes/no)' },
      { key: 'reportNumber', type: 'string', description: 'Police/fire report number' },
      { key: 'supportingDocuments', type: 'string', description: 'List of supporting documents' },
      { key: 'claimStatus', type: 'string', description: 'Current status of the claim' }
    ]
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main extraction endpoint
app.post('/extract', async (req, res) => {
  try {
    // Support both camelCase and snake_case parameter names
    const fileId = req.body.fileId || req.body.file_id;
    const extractionType = req.body.extractionType || req.body.extraction_type;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    if (!extractionType || !EXTRACTION_CONFIGS[extractionType]) {
      return res.status(400).json({
        error: 'Invalid extractionType',
        validTypes: Object.keys(EXTRACTION_CONFIGS)
      });
    }

    if (!boxClient) {
      initializeBoxClient();
    }

    const config = EXTRACTION_CONFIGS[extractionType];

    console.log(`Extracting ${extractionType} data from file ${fileId}`);

    // Call Box AI Extract API
    const extractResponse = await boxClient.post('/ai/extract_structured', {
      body: {
        items: [{ type: 'file', id: fileId }],
        fields: config.fields.map(f => ({
          key: f.key,
          type: f.type === 'date' ? 'string' : f.type,
          description: f.description,
          prompt: `What is the ${f.description.toLowerCase()}?`
        }))
      }
    });

    const result = {
      success: true,
      fileId: fileId,
      extractionType: extractionType,
      timestamp: new Date().toISOString(),
      data: extractResponse.body.answer || extractResponse.body,
      aiInfo: extractResponse.body.ai_agent_info
    };

    console.log(`Extraction successful for file ${fileId}`);
    res.json(result);

  } catch (error) {
    console.error('Extraction error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.body
    });
  }
});

// Document Q&A endpoint
app.post('/ask', async (req, res) => {
  try {
    // Support both camelCase and snake_case parameter names
    const fileId = req.body.fileId || req.body.file_id;
    const question = req.body.question;

    if (!fileId || !question) {
      return res.status(400).json({ error: 'fileId and question are required' });
    }

    if (!boxClient) {
      initializeBoxClient();
    }

    console.log(`Asking question about file ${fileId}: ${question}`);

    const askResponse = await boxClient.post('/ai/ask', {
      body: {
        mode: 'single_item_qa',
        prompt: question,
        items: [{ type: 'file', id: fileId }]
      }
    });

    res.json({
      success: true,
      fileId: fileId,
      question: question,
      answer: askResponse.body.answer,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Ask error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.body
    });
  }
});

// Summarize document endpoint
app.post('/summarize', async (req, res) => {
  try {
    // Support both camelCase and snake_case parameter names
    const fileId = req.body.fileId || req.body.file_id;
    const summaryType = req.body.summaryType || req.body.summary_type;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    if (!boxClient) {
      initializeBoxClient();
    }

    const summaryPrompts = {
      claim: `Summarize this claim document with the following structure:

**CLAIM SUMMARY**

1. **Incident Overview**: Brief description of what happened (2-3 sentences)
2. **Key Facts**: Date/Time of Loss, Location, Parties Involved, Type of Claim
3. **Damages/Injuries**: Summary of reported damages or injuries
4. **Current Status**: Where the claim stands in the process
5. **Key Documents**: List of important documents in the file
6. **Red Flags/Concerns**: Any inconsistencies or items requiring attention
7. **Recommended Next Steps**: Suggested actions for the adjuster

Keep the summary concise but comprehensive.`,
      medical: `Summarize this medical record for insurance claims review:

**MEDICAL SUMMARY**

1. **Patient & Provider**: Who and where
2. **Date of Treatment**: When services were provided
3. **Chief Complaint**: Why the patient sought treatment
4. **Diagnosis**: Primary and secondary diagnoses with ICD-10 codes
5. **Treatment Provided**: Procedures and medications
6. **Injury Causation**: Is the treatment related to the claimed incident?
7. **Prognosis & Follow-up**: Expected recovery and next steps
8. **Charges**: Total billed amount
9. **Claims Relevance**: How this relates to the insurance claim`,
      general: 'Provide a comprehensive summary of this document, highlighting the key information relevant to insurance claims processing.'
    };

    const prompt = summaryPrompts[summaryType] || summaryPrompts.general;

    const askResponse = await boxClient.post('/ai/ask', {
      body: {
        mode: 'single_item_qa',
        prompt: prompt,
        items: [{ type: 'file', id: fileId }]
      }
    });

    res.json({
      success: true,
      fileId: fileId,
      summaryType: summaryType || 'general',
      summary: askResponse.body.answer,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Summarize error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.body
    });
  }
});

// Fraud analysis endpoint
app.post('/analyze-fraud', async (req, res) => {
  try {
    // Support both camelCase and snake_case parameter names
    const fileId = req.body.fileId || req.body.file_id;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    if (!boxClient) {
      initializeBoxClient();
    }

    const fraudPrompt = `Analyze this document for potential fraud indicators. Check for:

1. **Timing Issues**: Friday losses, claims filed just before policy expiration, delayed reporting
2. **Documentation Concerns**: Missing documents, inconsistent dates, altered documents
3. **Statement Inconsistencies**: Conflicting accounts, changed stories, vague details
4. **Financial Red Flags**: Inflated damages, pre-existing damage, round dollar amounts
5. **Prior History**: Multiple prior claims, similar claims, coverage increase timing
6. **Provider Concerns**: Unusual provider patterns, excessive treatment

For each potential indicator found:
- Rate severity (Low/Medium/High)
- Cite specific evidence from the document
- Recommend investigation steps

Provide a summary risk score (0-100) with justification.

Return as JSON with structure:
{
  "riskScore": number,
  "riskLevel": "LOW|MEDIUM|HIGH",
  "indicators": [{"type": string, "severity": string, "evidence": string, "recommendation": string}],
  "summary": string
}`;

    const askResponse = await boxClient.post('/ai/ask', {
      body: {
        mode: 'single_item_qa',
        prompt: fraudPrompt,
        items: [{ type: 'file', id: fileId }]
      }
    });

    res.json({
      success: true,
      fileId: fileId,
      analysis: askResponse.body.answer,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fraud analysis error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.body
    });
  }
});

// Box webhook handler
app.post('/webhook/box', async (req, res) => {
  try {
    // Verify webhook signature
    const signature = req.headers['x-box-signature'];
    const primaryKey = process.env.BOX_WEBHOOK_PRIMARY_KEY;

    if (primaryKey && signature) {
      const expectedSignature = crypto
        .createHmac('sha256', primaryKey)
        .update(JSON.stringify(req.body))
        .digest('base64');

      if (signature !== expectedSignature) {
        console.warn('Invalid webhook signature');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { trigger, source } = req.body;
    console.log(`Received webhook: ${trigger} for ${source?.type} ${source?.id}`);

    // Handle different event types
    if (trigger === 'FILE.UPLOADED') {
      const fileId = source.id;
      const fileName = source.name;

      // Determine extraction type based on filename
      let extractionType = 'fnol';
      if (fileName.toLowerCase().includes('medical')) extractionType = 'medical';
      else if (fileName.toLowerCase().includes('estimate')) extractionType = 'estimate';
      else if (fileName.toLowerCase().includes('police')) extractionType = 'police';
      else if (fileName.toLowerCase().includes('invoice')) extractionType = 'invoice';

      // Forward to n8n for further processing
      if (process.env.N8N_WEBHOOK_URL) {
        const n8nPayload = {
          event: 'file.uploaded',
          fileId: fileId,
          fileName: fileName,
          extractionType: extractionType,
          source: source,
          timestamp: new Date().toISOString()
        };

        await fetch(`${process.env.N8N_WEBHOOK_URL}/box-file-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n8nPayload)
        });
      }
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// List supported extraction types
app.get('/extraction-types', (req, res) => {
  const types = Object.entries(EXTRACTION_CONFIGS).map(([key, config]) => ({
    type: key,
    name: config.name,
    fieldCount: config.fields.length,
    fields: config.fields.map(f => f.key)
  }));
  res.json({ extractionTypes: types });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`SureSafe Box AI Service running on port ${PORT}`);

  // Initialize Box client if credentials are available
  if (process.env.BOX_CLIENT_ID) {
    try {
      initializeBoxClient();
    } catch (error) {
      console.warn('Box client initialization deferred:', error.message);
    }
  }
});
