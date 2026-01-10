# SureSafe Insurance - Box AI Integration Demo

This repository contains the complete integration code for the SureSafe Insurance claims processing demo, leveraging Box's AI capabilities, Cloud Run services, and n8n workflow automation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SureSafe Demo                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │   Box.com    │───▶│  Cloud Run   │───▶│    n8n       │     │
│  │  (Storage)   │    │  (AI APIs)   │    │ (Workflows)  │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│         │                   │                   │              │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐     │
│  │  Box AI      │    │  Extracted   │    │  Automated   │     │
│  │  Extraction  │    │  JSON Data   │    │  Processing  │     │
│  └──────────────┘    └──────────────┘    └──────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Cloud Run Service (`/cloud-run`)
A Google Cloud Run service that:
- Receives file IDs from Box webhooks or direct API calls
- Calls Box AI Extract API to extract structured data from documents
- Returns extracted data as JSON
- Handles multiple document types (FNOL, Medical Records, Estimates, Police Reports)

**Deployment URL**: `https://suresafe-box-ai-[PROJECT_ID].run.app`

### 2. Box AI Agents (`/box-scripts`)
Scripts to create and manage Box AI Studio agents:
- **Claims Intelligence Agent**: Comprehensive claims analysis
- **Fraud Detection Agent**: Identifies potential fraud indicators
- **Policy Coverage Agent**: Analyzes coverage questions

### 3. n8n Workflows (`/n8n-workflows`)
Automated workflows for:
- **box-file-upload-workflow.json** - New document intake and AI extraction
- **fraud-alert-workflow.json** - High-risk fraud detection and SIU escalation
- **metadata-sync-workflow.json** - Sync metadata changes to external CMS
- **box-sign-workflow.json** - Settlement signature processing
- **task-handler-workflow.json** - Task assignment and completion handling

### 4. Box Webhooks
Event handlers for:
- `FILE.UPLOADED` - Trigger AI extraction on new documents
- `METADATA_INSTANCE.CREATED/UPDATED/DELETED` - Handle metadata changes
- `TASK_ASSIGNMENT.CREATED/UPDATED` - Task workflow automation
- `SIGN_REQUEST.COMPLETED/DECLINED/EXPIRED` - Process Box Sign events
- `COLLABORATION.CREATED/REMOVED` - Track collaboration changes for audit

## Quick Start

### Prerequisites
- Node.js 18+
- Google Cloud CLI (`gcloud`)
- Box Developer Account with JWT App configured
- n8n instance (cloud or self-hosted)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/mystroanalytics/suresafe-demo.git
   cd suresafe-demo
   ```

2. **Configure Box credentials**
   ```bash
   cp cloud-run/.env.example cloud-run/.env
   # Edit .env with your Box JWT credentials
   ```

3. **Deploy Cloud Run service**
   ```bash
   cd cloud-run
   npm install
   gcloud run deploy suresafe-box-ai --source .
   ```

4. **Create Box AI Agents**
   ```bash
   cd box-scripts
   npm install
   node create-ai-agents.js
   ```

5. **Import n8n workflows**
   - Import the JSON files from `/n8n-workflows` into your n8n instance
   - Configure the Box and Cloud Run credentials

## API Endpoints

### Cloud Run Service

#### POST `/extract`
Extract structured data from a Box file.

**Request:**
```json
{
  "fileId": "123456789",
  "extractionType": "fnol"
}
```

**Response:**
```json
{
  "success": true,
  "fileId": "123456789",
  "extractionType": "fnol",
  "data": {
    "claimNumber": "CLM-2026-00001",
    "claimantName": "John Smith",
    "dateOfLoss": "2026-01-03",
    "estimatedAmount": 12500
  }
}
```

#### POST `/webhook/box`
Receive Box webhook events and trigger processing.

#### GET `/health`
Health check endpoint.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BOX_CLIENT_ID` | Box OAuth2 Client ID |
| `BOX_CLIENT_SECRET` | Box OAuth2 Client Secret |
| `BOX_ENTERPRISE_ID` | Box Enterprise ID |
| `BOX_JWT_KEY_ID` | JWT Public Key ID |
| `BOX_PRIVATE_KEY` | JWT Private Key (base64 encoded) |
| `BOX_PASSPHRASE` | JWT Private Key Passphrase |
| `N8N_WEBHOOK_URL` | n8n webhook base URL |
| `WEBHOOK_SECRET` | Secret for webhook signature verification |

## Document Types Supported

| Type | Template Key | Description |
|------|--------------|-------------|
| FNOL | `fnol` | First Notice of Loss forms |
| Medical | `medical` | Medical records and bills |
| Estimate | `estimate` | Repair estimates |
| Police | `police` | Police/accident reports |
| Invoice | `invoice` | Vendor invoices |

## Box AI Agents

### Claims Intelligence Agent
- **Purpose**: Comprehensive claims analysis
- **Capabilities**: Document Q&A, multi-document analysis, summarization
- **Scope**: `/SureSafe Insurance/Claims/`

### Fraud Detection Agent
- **Purpose**: Identify fraud indicators
- **Risk Scoring**: 0-100 scale
- **Indicators Detected**: Timing issues, documentation concerns, inconsistencies

### Policy Coverage Agent
- **Purpose**: Policy interpretation and coverage analysis
- **Capabilities**: Quote policy language, explain coverage, identify exclusions

## Webhook Configuration

The following webhooks should be configured in Box Developer Console:

| Event | Target URL | Purpose |
|-------|------------|---------|
| `FILE.UPLOADED` | `https://[CLOUD_RUN_URL]/webhook/box` | Trigger extraction |
| `METADATA_INSTANCE.UPDATED` | `https://[N8N_URL]/webhook/box-metadata` | Sync changes |
| `SIGN_REQUEST.COMPLETED` | `https://[N8N_URL]/webhook/box-sign` | Process signatures |

## Testing

```bash
# Test Cloud Run locally
cd cloud-run
npm run dev

# Test extraction
curl -X POST http://localhost:8080/extract \
  -H "Content-Type: application/json" \
  -d '{"fileId": "123456789", "extractionType": "fnol"}'
```

## Deployment

### Cloud Run
```bash
cd cloud-run
gcloud run deploy suresafe-box-ai \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

### n8n Workflows
Import the workflow JSON files via the n8n UI or API.

## License

Proprietary - Mystro Analytics Inc.

## Support

For questions or issues, contact the development team.
