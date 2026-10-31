const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Fail fast on missing configuration instead of failing on the first request.
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name} (see backend/.env.example)`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5002', 10),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3307', 10),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME')
  },
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: '8h',
  bcryptCost: parseInt(process.env.BCRYPT_COST || '12', 10),
  aiServiceUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001'
};
