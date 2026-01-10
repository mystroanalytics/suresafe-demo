/**
 * n8n Workflow Import Script
 *
 * Imports all SureSafe workflows to n8n instance via API
 *
 * Usage:
 *   N8N_API_URL=https://your-n8n.com N8N_API_KEY=your_key node import-workflows.js
 *
 * Or set environment variables and run:
 *   node import-workflows.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const N8N_API_URL = process.env.N8N_API_URL || 'https://n8n.suresafe.com';
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_KEY) {
  console.error('Error: N8N_API_KEY environment variable is required');
  console.log('');
  console.log('Usage:');
  console.log('  N8N_API_URL=https://your-n8n.com N8N_API_KEY=your_key node import-workflows.js');
  process.exit(1);
}

const WORKFLOW_FILES = [
  'box-file-upload-workflow.json',
  'fraud-alert-workflow.json',
  'metadata-sync-workflow.json',
  'box-sign-workflow.json',
  'task-handler-workflow.json'
];

async function importWorkflow(workflowFile) {
  const filePath = path.join(__dirname, workflowFile);

  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP: File not found: ${workflowFile}`);
    return null;
  }

  const workflowData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  try {
    // First, check if workflow already exists by name
    const listResponse = await fetch(`${N8N_API_URL}/api/v1/workflows`, {
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!listResponse.ok) {
      throw new Error(`Failed to list workflows: ${listResponse.status}`);
    }

    const existingWorkflows = await listResponse.json();
    const existing = existingWorkflows.data?.find(w => w.name === workflowData.name);

    if (existing) {
      // Update existing workflow
      const updateResponse = await fetch(`${N8N_API_URL}/api/v1/workflows/${existing.id}`, {
        method: 'PATCH',
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(workflowData)
      });

      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to update: ${error}`);
      }

      const updated = await updateResponse.json();
      return { id: updated.id, action: 'updated' };
    } else {
      // Create new workflow
      const createResponse = await fetch(`${N8N_API_URL}/api/v1/workflows`, {
        method: 'POST',
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(workflowData)
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new Error(`Failed to create: ${error}`);
      }

      const created = await createResponse.json();
      return { id: created.id, action: 'created' };
    }
  } catch (error) {
    throw error;
  }
}

async function activateWorkflow(workflowId) {
  try {
    const response = await fetch(`${N8N_API_URL}/api/v1/workflows/${workflowId}/activate`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('N8N WORKFLOW IMPORT');
  console.log('='.repeat(60));
  console.log('');
  console.log(`n8n URL: ${N8N_API_URL}`);
  console.log('');

  const results = [];

  for (const file of WORKFLOW_FILES) {
    const workflowName = file.replace('.json', '').replace(/-/g, ' ');
    console.log(`Importing: ${workflowName}`);

    try {
      const result = await importWorkflow(file);
      if (result) {
        console.log(`  SUCCESS: ${result.action} (ID: ${result.id})`);

        // Activate the workflow
        const activated = await activateWorkflow(result.id);
        if (activated) {
          console.log('  ACTIVATED: Workflow is now active');
        }

        results.push({ file, ...result, status: 'success' });
      }
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      results.push({ file, status: 'error', error: error.message });
    }
    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'error');

  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (successful.length > 0) {
    console.log('');
    console.log('Imported workflows:');
    successful.forEach(r => console.log(`  ✓ ${r.file} (${r.action})`));
  }

  if (failed.length > 0) {
    console.log('');
    console.log('Failed workflows:');
    failed.forEach(r => console.log(`  ✗ ${r.file}: ${r.error}`));
  }

  console.log('');
  console.log('Webhook URLs for Box configuration:');
  console.log(`  File Upload:    ${N8N_API_URL}/webhook/box-file-upload`);
  console.log(`  Metadata Sync:  ${N8N_API_URL}/webhook/box-metadata`);
  console.log(`  Box Sign:       ${N8N_API_URL}/webhook/box-sign`);
  console.log(`  Task Handler:   ${N8N_API_URL}/webhook/box-tasks`);
  console.log(`  Fraud Alert:    ${N8N_API_URL}/webhook/fraud-alert`);
}

main().catch(console.error);
