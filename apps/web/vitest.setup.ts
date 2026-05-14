import "@testing-library/jest-dom";
import "fake-indexeddb/auto"; // patches global indexedDB for all tests

// Silence AWS SDK credential warnings in test output
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.AWS_REGION = "us-east-1";

// next-auth env
process.env.NEXTAUTH_SECRET = "test-secret-32-chars-minimum-xx";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

// DynamoDB table names
process.env.USERS_TABLE = "proyinstelec-users";
process.env.INVITACIONES_TABLE = "proyinstelec-invitaciones";
process.env.MAIN_TABLE = "proyinstelec-main";
