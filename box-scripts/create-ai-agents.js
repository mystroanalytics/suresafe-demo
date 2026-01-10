/**
 * SureSafe Box AI Agents Creation Script
 *
 * This script creates the Box AI Studio agents for:
 * 1. Claims Intelligence Agent - Comprehensive claims analysis
 * 2. Fraud Detection Agent - Identifies potential fraud indicators
 * 3. Policy Coverage Agent - Analyzes coverage questions
 *
 * Usage: node create-ai-agents.js
 */

import BoxSDK from 'box-node-sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load configuration from demo folder
const CONFIG_PATH = process.env.BOX_CONFIG_PATH ||
  path.join(__dirname, '../../demo/574263272_mzb59zcl_config.json');

// Agent definitions
const AI_AGENTS = [
  {
    name: 'Claims Intelligence Agent',
    description: 'Comprehensive claims analysis and document processing assistant',
    systemPrompt: `You are the SureSafe Insurance Claims Intelligence Agent. Your role is to help claims adjusters analyze claim documents, extract relevant information, identify potential issues, and recommend next steps.

When analyzing documents:
1. Always extract key facts (who, what, when, where, how much)
2. Compare information across multiple documents for consistency
3. Identify any red flags or concerns
4. Reference specific documents and page numbers
5. Provide clear, actionable recommendations

You have access to:
- FNOL forms (First Notice of Loss)
- Police reports
- Medical records
- Repair estimates
- Photos
- Witness statements
- Policy documents

For each document analysis, provide:
- Document type and key identifier
- Extracted data points
- Consistency check with other documents
- Risk indicators (if any)
- Recommended actions

Always be thorough, accurate, and highlight anything requiring immediate attention.`,
    capabilities: ['document_qa', 'multi_document', 'summarization', 'extraction'],
    model: 'azure__openai__gpt_4o_mini'
  },
  {
    name: 'Fraud Detection Agent',
    description: 'Analyzes claims for potential fraud indicators and suspicious patterns',
    systemPrompt: `You are the SureSafe Insurance Fraud Detection Agent. Your role is to analyze claims for potential fraud indicators and suspicious patterns.

Analyze for these fraud indicators:

1. **Timing Issues**:
   - Friday losses
   - Claims filed just before policy expiration
   - Delayed reporting
   - Loss shortly after coverage increase

2. **Documentation Concerns**:
   - Missing documents
   - Inconsistent dates
   - Altered documents
   - Poor quality copies

3. **Statement Inconsistencies**:
   - Conflicting accounts between documents
   - Changed stories over time
   - Vague or rehearsed details

4. **Financial Red Flags**:
   - Inflated damages
   - Pre-existing damage
   - Round dollar amounts
   - Excessive claims for vehicle age

5. **Prior History**:
   - Multiple prior claims
   - Prior similar claims
   - Known associates with fraud history

6. **Provider Concerns**:
   - Unusual provider patterns
   - Excessive treatment
   - Known fraud-associated providers

7. **Social Media Indicators**:
   - Posts contradicting injury claims
   - Photos showing undamaged property

8. **Pattern Matching**:
   - Similar claims by related parties
   - Ring indicators

For each potential indicator:
- Rate severity: LOW / MEDIUM / HIGH
- Cite specific evidence from documents
- Recommend investigation steps

Always provide:
- Summary risk score (0-100)
- Risk level categorization (LOW: 0-25, MEDIUM: 26-50, HIGH: 51-75, CRITICAL: 76-100)
- Detailed justification
- Recommended SIU referral decision (Yes/No)`,
    capabilities: ['document_qa', 'multi_document', 'analysis'],
    model: 'azure__openai__gpt_4o_mini'
  },
  {
    name: 'Policy Coverage Agent',
    description: 'Analyzes coverage questions and policy interpretation',
    systemPrompt: `You are the SureSafe Insurance Policy Coverage Agent. Your role is to help adjusters and underwriters understand policy coverage, limits, and exclusions.

When answering coverage questions:

1. **Quote Policy Language**:
   - Always cite specific policy sections
   - Quote relevant definitions
   - Reference endorsements

2. **Explain Coverage**:
   - Describe coverage in plain terms
   - Identify applicable limits
   - Note any sublimits

3. **Identify Deductibles**:
   - Per-occurrence deductible
   - Aggregate deductible
   - Special deductibles for specific perils

4. **Note Exclusions**:
   - Policy exclusions that may apply
   - Endorsement exclusions
   - Conditions that limit coverage

5. **Reference Endorsements**:
   - Added coverages
   - Coverage modifications
   - Special conditions

6. **Explain Conditions**:
   - Duties after loss
   - Cooperation requirements
   - Timely notice provisions

For coverage disputes:
- Analyze the specific situation and facts
- Apply policy language to the facts
- Identify any ambiguities
- Recommend coverage position with reasoning
- Cite supporting case law concepts if relevant

Always cite policy sections and page numbers. When in doubt, note the ambiguity and recommend review by coverage counsel.`,
    capabilities: ['document_qa', 'multi_document', 'analysis'],
    model: 'azure__openai__gpt_4o_mini'
  }
];

async function createAIAgents() {
  console.log('='.repeat(60));
  console.log('SURESAFE BOX AI AGENTS CREATION');
  console.log('='.repeat(60));
  console.log('');

  // Load Box configuration
  let config;
  try {
    const configFile = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(configFile);
    console.log('Loaded Box configuration from:', CONFIG_PATH);
  } catch (error) {
    console.error('Error loading config:', error.message);
    console.log('Please ensure BOX_CONFIG_PATH is set or config file exists');
    process.exit(1);
  }

  // Initialize Box SDK
  const sdk = BoxSDK.getPreconfiguredInstance(config);
  const client = sdk.getAppAuthClient('enterprise');

  // Verify connection
  try {
    const user = await client.users.get('me');
    console.log(`Connected as: ${user.name} (${user.login})`);
    console.log('');
  } catch (error) {
    console.error('Failed to connect to Box:', error.message);
    process.exit(1);
  }

  // Create each agent
  const createdAgents = [];

  for (const agentDef of AI_AGENTS) {
    console.log(`Creating agent: ${agentDef.name}`);
    console.log('-'.repeat(40));

    try {
      // Box AI Studio Agent creation via API
      // Note: The exact API endpoint may vary based on Box AI Studio availability
      // This uses the general pattern for custom AI configurations

      const agentConfig = {
        type: 'ai_agent',
        name: agentDef.name,
        description: agentDef.description,
        configuration: {
          system_prompt: agentDef.systemPrompt,
          model: agentDef.model,
          capabilities: agentDef.capabilities,
          temperature: 0.3, // Lower for more consistent responses
          max_tokens: 4096
        }
      };

      // Try to create via AI Studio API
      // Note: Box AI Studio API endpoints may require specific access
      try {
        const response = await client.post('/ai_agents', {
          body: agentConfig
        });

        console.log(`  SUCCESS: Agent created`);
        console.log(`  Agent ID: ${response.body.id}`);
        createdAgents.push({
          name: agentDef.name,
          id: response.body.id,
          status: 'created'
        });
      } catch (apiError) {
        // If direct API fails, save configuration for manual import
        console.log(`  NOTE: Direct API creation not available`);
        console.log(`  Saving configuration for manual import...`);

        const configFile = path.join(__dirname, `agent-${agentDef.name.toLowerCase().replace(/\s+/g, '-')}.json`);
        fs.writeFileSync(configFile, JSON.stringify(agentConfig, null, 2));
        console.log(`  Saved to: ${configFile}`);

        createdAgents.push({
          name: agentDef.name,
          configFile: configFile,
          status: 'config_saved'
        });
      }

    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      createdAgents.push({
        name: agentDef.name,
        status: 'error',
        error: error.message
      });
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  for (const agent of createdAgents) {
    const status = agent.status === 'created' ? '✓' :
                   agent.status === 'config_saved' ? '○' : '✗';
    console.log(`${status} ${agent.name}: ${agent.status}`);
    if (agent.id) console.log(`    ID: ${agent.id}`);
    if (agent.configFile) console.log(`    Config: ${agent.configFile}`);
    if (agent.error) console.log(`    Error: ${agent.error}`);
  }

  console.log('');
  console.log('Next Steps:');
  console.log('1. If configs were saved, import them via Box AI Studio UI');
  console.log('2. Navigate to Box AI Studio → Agents → Create Agent');
  console.log('3. Use the saved JSON configuration for each agent');
  console.log('');

  // Save all agents summary
  const summaryFile = path.join(__dirname, 'agents-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify({
    created: new Date().toISOString(),
    agents: createdAgents,
    definitions: AI_AGENTS
  }, null, 2));
  console.log(`Summary saved to: ${summaryFile}`);
}

// Export for use as module
export { AI_AGENTS, createAIAgents };

// Run if executed directly
createAIAgents().catch(console.error);
