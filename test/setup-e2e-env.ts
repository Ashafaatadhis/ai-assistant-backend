import * as dotenv from 'dotenv';

dotenv.config();
const testDbUrl = process.env.TEST_DATABASE_URL;
if (!testDbUrl) {
  throw new Error('TEST_DATABASE_URL is not set — check .env');
}
process.env.DATABASE_URL = testDbUrl;
