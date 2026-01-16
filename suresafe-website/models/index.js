import { Sequelize } from 'sequelize';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const DB_HOST = process.env.DB_HOST || '34.174.21.134';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'Desksort_Marz_123';
const DB_NAME = process.env.DB_NAME || 'box_demo';
const DB_PORT = process.env.DB_PORT || 3306;

// For Cloud Run with Cloud SQL, use Unix socket if available
const DB_SOCKET_PATH = process.env.DB_SOCKET_PATH; // e.g., /cloudsql/PROJECT:REGION:INSTANCE

let sequelizeConfig = {
  host: DB_HOST,
  port: DB_PORT,
  dialect: 'mysql',
  logging: process.env.NODE_ENV === 'production' ? false : console.log,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
};

// Use Unix socket for Cloud SQL if available
if (DB_SOCKET_PATH) {
  sequelizeConfig = {
    dialect: 'mysql',
    dialectOptions: {
      socketPath: DB_SOCKET_PATH
    },
    logging: process.env.NODE_ENV === 'production' ? false : console.log,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  };
}

const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, sequelizeConfig);

// Define User model
const User = sequelize.define('User', {
  id: {
    type: Sequelize.STRING(50),
    primaryKey: true
  },
  name: {
    type: Sequelize.STRING(100),
    allowNull: false
  },
  email: {
    type: Sequelize.STRING(100),
    allowNull: false,
    unique: true
  },
  password: {
    type: Sequelize.STRING(255),
    allowNull: false
  },
  policyNumber: {
    type: Sequelize.STRING(50),
    allowNull: true
  },
  memberSince: {
    type: Sequelize.DATEONLY,
    allowNull: true
  }
}, {
  tableName: 'users',
  timestamps: true
});

// Define Claim model
const Claim = sequelize.define('Claim', {
  id: {
    type: Sequelize.STRING(50),
    primaryKey: true
  },
  userId: {
    type: Sequelize.STRING(50),
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  userName: {
    type: Sequelize.STRING(100),
    allowNull: false
  },
  policyNumber: {
    type: Sequelize.STRING(50),
    allowNull: true
  },
  claimType: {
    type: Sequelize.STRING(100),
    allowNull: false
  },
  description: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  incidentDate: {
    type: Sequelize.DATEONLY,
    allowNull: false
  },
  estimatedAmount: {
    type: Sequelize.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  status: {
    type: Sequelize.STRING(50),
    defaultValue: 'Submitted'
  },
  statusHistory: {
    type: Sequelize.JSON,
    defaultValue: []
  },
  boxFolderId: {
    type: Sequelize.STRING(50),
    allowNull: true
  },
  documents: {
    type: Sequelize.JSON,
    defaultValue: []
  },
  aiExtraction: {
    type: Sequelize.JSON,
    allowNull: true
  },
  // Camunda workflow fields
  processInstanceKey: {
    type: Sequelize.STRING(100),
    allowNull: true
  },
  workflowStatus: {
    type: Sequelize.STRING(50),
    allowNull: true,
    defaultValue: 'NOT_STARTED'
  },
  riskScore: {
    type: Sequelize.INTEGER,
    allowNull: true
  },
  assignedAdjusterId: {
    type: Sequelize.STRING(50),
    allowNull: true
  },
  assignedAdjusterName: {
    type: Sequelize.STRING(100),
    allowNull: true
  }
}, {
  tableName: 'claims',
  timestamps: true
});

// Define associations
User.hasMany(Claim, { foreignKey: 'userId', as: 'claims' });
Claim.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Initialize database
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connection established successfully.');

    // Sync models (creates tables if they don't exist)
    await sequelize.sync({ alter: true });
    console.log('Database models synchronized.');

    // Seed default users if they don't exist
    const existingUsers = await User.count();
    if (existingUsers === 0) {
      await User.bulkCreate([
        {
          id: 'USR001',
          name: 'John Smith',
          email: 'john.smith@email.com',
          password: 'demo123',
          policyNumber: 'POL-2024-001234',
          memberSince: '2020-03-15'
        },
        {
          id: 'USR002',
          name: 'Sarah Johnson',
          email: 'sarah.johnson@email.com',
          password: 'demo123',
          policyNumber: 'POL-2024-005678',
          memberSince: '2019-08-22'
        }
      ]);
      console.log('Default users created.');
    }

    return true;
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    return false;
  }
}

export { sequelize, User, Claim, initDatabase };
