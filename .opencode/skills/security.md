---
name: security
description: Security best practices for Bun + Elysia.js + Drizzle + TypeScript + TailwindCSS stack. Use when implementing authentication, authorization, input validation, CSRF protection, rate limiting, or any security-related features.
---
# Security Guide for BED Stack
## Authentication
### JWT Configuration
Always use strong secrets and proper configuration:

```typescript
// utils/const.ts
export const config = {
  jwtSecret: process.env.JWT_SECRET || "your-secret-key", // Use 32+ char random string
  jwtExpiresIn: "7d",
};
```

```typescript
// index.ts
app.use(
  jwt({
    name: "jwt",
    secret: config.jwtSecret,
    exp: config.jwtExpiresIn,
  })
);
```
### Google OAuth
```typescript
// routes/auth.ts
const oauth2Client = new OAuth2Client(
  config.googleClientId,
  config.googleClientSecret,
  config.googleRedirectUri
);
```

Validate OAuth tokens server-side:

```typescript
async function verifyGoogleToken(token: string) {
  const ticket = await oauth2Client.verifyIdToken({
    idToken: token,
    audience: config.googleClientId,
  });
  return ticket.getPayload();
}
```
## Authorization
### Route Guards
Use Elysia's guard for protected routes:

```typescript
export const protectedPlugin = new Elysia()
  .use(jwt({ name: "jwt", secret: config.jwtSecret }))
  .derive(async ({ cookie: { auth }, jwt }) => {
    const token = await jwt.verify(auth.value);
    if (!token) {
      throw new Error("UNAUTHORIZED");
    }
    return { user: token };
  })
  .onBeforeHandle(({ user, set }) => {
    if (!user) {
      set.status = 401;
      return ResponseBuilder.unauthorized("Authentication required");
    }
  });
```
### User-Scoped Access
Always verify resource ownership:

```typescript
// routes/tasks.ts
app.get("/:id", async ({ params, user, db }) => {
  const task = await dbWrapper.selectOne(
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, Number(params.id)), eq(tasks.createdBy, user.id)))
      .limit(1)
  );

  if (!task) {
    return ResponseBuilder.notFound("Task not found");
  }
  return ResponseBuilder.success({ task });
});
```
## Input Validation
### TypeBox Schemas
Validate all inputs with TypeBox:

```typescript
import { t } from "@elysiajs/typebox";

const CreateTaskSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 5000 })),
  priority: t.Enum({ low: "low", medium: "medium", high: "high" }),
  status: t.Optional(
    t.Enum({
      todo: "todo",
      in_progress: "in_progress",
      done: "done",
      archived: "archived",
    })
  ),
  dueDate: t.Optional(t.Integer()),
});
```

Apply validation in routes:

```typescript
app.post("/", async ({ body, user, db }) => {
  const task = await dbWrapper.insertOne(schema.tasks, {
    ...body,
    createdBy: user.id,
  });
  return ResponseBuilder.success({ task });
}, {
  body: CreateTaskSchema,
});
```
### Sanitization
Sanitize user inputs, especially for Markdown content:

```typescript
import DOMPurify from "isomorphic-dompurify";

// When rendering user content
const sanitizedContent = DOMPurify.sanitize(markdownContent);
```
## Token Storage (localStorage + Authorization Header)
When storing JWT in localStorage and sending via Authorization header, CSRF is not needed. The token must be explicitly attached via JavaScript.
### Authorization Header Pattern
```typescript
// Frontend - Store token after login
localStorage.setItem("token", response.data.token);

// Frontend - Attach to all API calls
const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
};

// Usage
const tasks = await apiFetch(`${API_URL}/tasks`).then(r => r.json());
```
## XSS Protection
localStorage is vulnerable to XSS attacks. If an attacker can inject JavaScript, they can read the token.
### Input Sanitization
Sanitize all user inputs, especially for Markdown content:

```typescript
import DOMPurify from "isomorphic-dompurify";

// When rendering user content
const sanitizedContent = DOMPurify.sanitize(markdownContent);

// In React - sanitize before rendering
<ReactMarkdown remarkPlugins={[remarkGfm]}>
  {DOMPurify.sanitize(task.description)}
</ReactMarkdown>
```
### Output Encoding
React escapes by default. Be careful with `dangerouslySetInnerHTML`:

```typescript
// Safe - React escapes automatically
<div>{userInput}</div>

// Dangerous - only use with sanitized content
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />
```
## Content Security Policy (CSP)
Add CSP headers to prevent XSS and data injection:

```typescript
// index.ts
app.use(
  cors({ /* ... */ })
)
  .onBeforeHandle(({ set }) => {
    set.headers.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self' http://localhost:3000 https://www.googleapis.com",
      "frame-ancestors 'none'",
    ].join("; "));
  })
);
```
### CSP Directives
- `default-src 'self'` - Default fallback
- `script-src 'self'` - Only allow own scripts
- `style-src 'self' 'unsafe-inline'` - Own styles + inline (for Tailwind)
- `img-src 'self' data: https:` - Images from self, data URLs, HTTPS
- `connect-src 'self'` - API calls only to self
- `frame-ancestors 'none'` - Prevent embedding in iframes
## Rate Limiting
### In-Memory Rate Limiter
```typescript
// utils/rate-limiter.ts
interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  resetTime: Date;
}

class RateLimiter {
  private requests = new Map<string, { count: number; resetTime: number }>();

  check(key: string, options: RateLimitOptions): RateLimitResult {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      this.requests.set(key, {
        count: 1,
        resetTime: now + options.windowMs,
      });
      return { allowed: true, totalHits: 1, resetTime: new Date(now + options.windowMs) };
    }

    if (record.count >= options.maxRequests) {
      return { allowed: false, totalHits: record.count, resetTime: new Date(record.resetTime) };
    }

    record.count++;
    return { allowed: true, totalHits: record.count, resetTime: new Date(record.resetTime) };
  }
}
```
### Apply to Routes
```typescript
const authRateLimiter = new RateLimiter();
const authRateLimitOptions = { windowMs: 15 * 60 * 1000, maxRequests: 5 };

app.derive(({ request, set }) => {
  const clientIP =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  const result = authRateLimiter.check(clientIP, authRateLimitOptions);

  if (!result.allowed) {
    set.status = 429;
    set.headers.set("Retry-After", String(Math.ceil((result.resetTime.getTime() - Date.now()) / 1000)));
    return ResponseBuilder.error("Too many requests", "RATE_LIMIT_EXCEEDED");
  }

  return { rateLimitResult: result };
});
```
## Database Security
### Parameterized Queries
Drizzle uses parameterized queries by default, preventing SQL injection:

```typescript
// Safe - uses parameterized queries
const users = await dbWrapper.selectMany(
  db.select().from(users).where(eq(users.email, email))
);

// Never interpolate user input directly into SQL
// const query = `SELECT * FROM users WHERE email = '${email}'`; // DANGER!
```
### API Key Storage
Store API keys securely with hashing:

```typescript
import { hash, verify } from "@node-rs/argon2";

// When creating API key
const hashedKey = await hash(rawApiKey);
await dbWrapper.insertOne(schema.apiKeys, {
  userId: user.id,
  key: hashedKey,
  name: "My API Key",
});

// When verifying
const [storedKey] = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId));
const isValid = await verify(storedKey.key, providedKey);
```
## Environment Security
### Environment Variables
Never commit secrets:

```bash
# .gitignore
.env
.env.local
*.db
```

```bash
# .env.example (no real values)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=your-super-secret-jwt-key
REDIS_URL=redis://localhost:6379
```
### Validation
Validate required environment variables at startup:

```typescript
// utils/const.ts
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  googleClientId: requireEnv("GOOGLE_CLIENT_ID"),
  googleClientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
  jwtSecret: requireEnv("JWT_SECRET"),
  // ... other config
};
```
## CORS Configuration
```typescript
app.use(
  cors({
    origin: config.nodeEnv === "production" 
      ? ["https://yourdomain.com"] 
      : true, // Allow all in dev
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  })
);
```
## Error Handling
### Never Expose Internal Details
```typescript
app.onError(({ error, code, set }) => {
  logger.error("Unhandled error", { error: error as Error, code });

  switch (code) {
    case "VALIDATION":
      set.status = 400;
      return ResponseBuilder.validation("Invalid input", error.all);
    case "NOT_FOUND":
      set.status = 404;
      return ResponseBuilder.notFound("Resource not found");
    case "UNAUTHORIZED":
      set.status = 401;
      return ResponseBuilder.unauthorized("Authentication required");
    default:
      set.status = 500;
      return ResponseBuilder.internal("An unexpected error occurred");
  }
});
```
## Frontend Security
### API Calls with Authorization Header
When using localStorage for JWT storage, use Authorization header:

```typescript
const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("token");
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
};

// Usage
const response = await apiFetch(`${API_URL}/tasks`);
const data = await response.json();
```
### Secure Token Storage
```typescript
// Store token after successful login
const handleLogin = async (credentials: Credentials) => {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = await response.json();
  if (data.success) {
    localStorage.setItem("token", data.data.token);
    window.location.href = "/dashboard";
  }
};

// Clear token on logout
const handleLogout = () => {
  localStorage.removeItem("token");
  window.location.href = "/login";
};
```
