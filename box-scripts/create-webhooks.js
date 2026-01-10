/**
 * SureSafe Box Webhooks Creation Script
 *
 * Creates webhooks for:
 * - File uploads (trigger AI extraction)
 * - Metadata changes (sync with external systems)
 * - Task events (workflow triggers)
 * - Signature events (settlement processing)
 *
 * Usage: node create-webhooks.js
 */

import BoxSDK from 'box-node-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = process.env.BOX_CONFIG_PATH ||
  path.join(__dirname, '../../demo/574263272_mzb59zcl_config.json');

// Target folder for webhooks - SureSafe Insurance Demo folder
const TARGET_FOLDER_ID = process.env.BOX_FOLDER_ID || '360174903981';

// Cloud Run service URL
const CLOUD_RUN_URL = process.env.CLOUD_RUN_URL || 'https://suresafe-box-ai-XXXXX.run.app';

// n8n webhook URL
const N8N_URL = process.env.N8N_WEBHOOK_URL || 'https://n8n.suresafe.com/webhook';

// Webhook definitions
const WEBHOOKS = [
  {
    name: 'File Upload Handler',
    target: {
      type: 'folder',
      id: TARGET_FOLDER_ID
    },
    triggers: ['FILE.UPLOADED'],
    address: `${CLOUD_RUN_URL}/webhook/box`,
    description: 'Triggers AI extraction on new document uploads'
  },
  {
    name: 'Metadata Change Handler',
    target: {
      type: 'folder',
      id: TARGET_FOLDER_ID
    },
    triggers: [
      'METADATA_INSTANCE.CREATED',
      'METADATA_INSTANCE.UPDATED',
      'METADATA_INSTANCE.DELETED'
    ],
    address: `${N8N_URL}/box-metadata`,
    description: 'Syncs metadata changes with external systems'
  },
  {
    name: 'Task Handler',
    target: {
      type: 'folder',
      id: TARGET_FOLDER_ID
    },
    triggers: [
      'TASK_ASSIGNMENT.CREATED',
      'TASK_ASSIGNMENT.UPDATED'
    ],
    address: `${N8N_URL}/box-tasks`,
    description: 'Handles task workflow events'
  },
  {
    name: 'Box Sign Handler',
    target: {
      type: 'folder',
      id: TARGET_FOLDER_ID
    },
    triggers: [
      'SIGN_REQUEST.COMPLETED',
      'SIGN_REQUEST.DECLINED',
      'SIGN_REQUEST.EXPIRED'
    ],
    address: `${N8N_URL}/box-sign`,
    description: 'Processes signature events for settlements'
  },
  {
    name: 'Collaboration Handler',
    target: {
      type: 'folder',
      id: TARGET_FOLDER_ID
    },
    triggers: [
      'COLLABORATION.CREATED',
      'COLLABORATION.REMOVED'
    ],
    address: `${N8N_URL}/box-collab`,
    description: 'Tracks collaboration changes for audit'
  }
];

async function createWebhooks() {
  console.log('='.repeat(60));
  console.log('SURESAFE BOX WEBHOOKS CREATION');
  console.log('='.repeat(60));
  console.log('');

  // Load Box configuration
  let config;
  try {
    const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(configFile);
    console.log('Loaded Box configuration');
  } catch (error) {
    console.error('Error loading config:', error.message);
    process.exit(1);
  }

  const sdk = BoxSDK.getPreconfiguredInstance(config);
  const client = sdk.getAppAuthClient('enterprise');

  // Verify connection
  const user = await client.users.get('me');
  console.log(`Connected as: ${user.name}`);
  console.log(`Target folder: ${TARGET_FOLDER_ID}`);
  console.log(`Cloud Run URL: ${CLOUD_RUN_URL}`);
  console.log(`n8n URL: ${N8N_URL}`);
  console.log('');

  // List existing webhooks
  console.log('Checking existing webhooks...');
  let existingWebhooks = [];
  try {
    const webhooksResponse = await client.webhooks.getAll();
    existingWebhooks = webhooksResponse.entries || [];
    console.log(`Found ${existingWebhooks.length} existing webhooks`);
  } catch (error) {
    console.log('Could not list webhooks:', error.message);
  }
  console.log('');

  // Create webhooks
  const createdWebhooks = [];

  for (const webhookDef of WEBHOOKS) {
    console.log(`Creating webhook: ${webhookDef.name}`);
    console.log(`  Triggers: ${webhookDef.triggers.join(', ')}`);
    console.log(`  Target: ${webhookDef.address}`);

    // Check if similar webhook exists
    const existing = existingWebhooks.find(w =>
      w.target?.id === webhookDef.target.id &&
      w.triggers?.some(t => webhookDef.triggers.includes(t))
    );

    if (existing) {
      console.log(`  EXISTS: Webhook ${existing.id} already covers these triggers`);
      createdWebhooks.push({
        name: webhookDef.name,
        id: existing.id,
        status: 'exists'
      });
      console.log('');
      continue;
    }

    try {
      const webhook = await client.webhooks.create(
        webhookDef.target.id,
        webhookDef.target.type,
        webhookDef.address,
        webhookDef.triggers
      );

      console.log(`  SUCCESS: Created webhook ${webhook.id}`);
      createdWebhooks.push({
        name: webhookDef.name,
        id: webhook.id,
        status: 'created',
        triggers: webhookDef.triggers,
        address: webhookDef.address
      });

    } catch (error) {
      console.log(`  ERROR: ${error.message}`);

      // Check if it's a URL validation error
      if (error.message.includes('address')) {
        console.log(`  NOTE: Webhook address must be HTTPS and publicly accessible`);
        console.log(`  Save configuration for later deployment...`);
      }

      createdWebhooks.push({
        name: webhookDef.name,
        status: 'error',
        error: error.message,
        config: webhookDef
      });
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  for (const webhook of createdWebhooks) {
    const status = webhook.status === 'created' ? '✓' :
                   webhook.status === 'exists' ? '○' : '✗';
    console.log(`${status} ${webhook.name}: ${webhook.status}`);
    if (webhook.id) console.log(`    ID: ${webhook.id}`);
    if (webhook.error) console.log(`    Error: ${webhook.error}`);
  }

  // Save webhook configuration for reference
  const configOutput = {
    created: new Date().toISOString(),
    targetFolder: TARGET_FOLDER_ID,
    cloudRunUrl: CLOUD_RUN_URL,
    n8nUrl: N8N_URL,
    webhooks: createdWebhooks,
    definitions: WEBHOOKS
  };

  const outputFile = path.join(__dirname, 'webhooks-config.json');
  fs.writeFileSync(outputFile, JSON.stringify(configOutput, null, 2));
  console.log('');
  console.log(`Configuration saved to: ${outputFile}`);

  console.log('');
  console.log('Next Steps:');
  console.log('1. Deploy Cloud Run service and update CLOUD_RUN_URL');
  console.log('2. Configure n8n and update N8N_WEBHOOK_URL');
  console.log('3. Re-run this script to create webhooks');
  console.log('4. Verify webhooks in Box Developer Console');
}

createWebhooks().catch(console.error);
