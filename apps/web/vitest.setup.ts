import "@testing-library/jest-dom";
import "fake-indexeddb/auto"; // patches global indexedDB for all tests

// Auth.js
process.env.AUTH_SECRET = "test-secret-32-chars-minimum-xx";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.AUTH_GOOGLE_ID = "test-client-id";
process.env.AUTH_GOOGLE_SECRET = "test-client-secret";

// Neon: las pruebas mockean @/src/db, pero algún import podría evaluar la URL.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// Google: las pruebas corren en modo cuenta de servicio, como producción.
// Si quien ejecuta tiene esta variable exportada en su terminal, el modo
// cambiaría bajo los pies de las pruebas de Drive; la que necesite el otro
// modo la define ella misma.
delete process.env.GOOGLE_OAUTH_CLIENTE;
