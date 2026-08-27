import "@testing-library/jest-dom";
import "fake-indexeddb/auto"; // patches global indexedDB for all tests

// Auth.js
process.env.AUTH_SECRET = "test-secret-32-chars-minimum-xx";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.AUTH_GOOGLE_ID = "test-client-id";
process.env.AUTH_GOOGLE_SECRET = "test-client-secret";

// Neon: las pruebas mockean @/src/db, pero algún import podría evaluar la URL.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
