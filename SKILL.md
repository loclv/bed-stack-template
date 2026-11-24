# BED Stack Development Skill
## Overview
BED Stack is a modern full-stack TypeScript web application framework combining:

- Bun - Ultra-fast JavaScript runtime and package manager
- Elysia.js - Modern, TypeScript-first web framework
- Drizzle - Type-safe ORM with excellent performance
- TypeScript - Type safety throughout the stack
- TailwindCSS - Utility-first CSS framework

This skill provides comprehensive guidance for developing scalable, performant web applications using this stack.
## Architecture
### Monorepo Structure
```text
bed-stack/
├─packages/
│   ├─api/ # Elysia.js backend
│   └─web/ # React frontend
├─docs/ # Documentation
└─scripts/ # Build and utility scripts
```
### Core Components
#### Backend (packages/api)
- Runtime: Bun with native TypeScript support
- Framework: Elysia.js with plugin system
- Database: SQLite with Drizzle ORM
- Authentication: JWT with Google OAuth integration
- Validation: TypeBox schemas integrated with Elysia
- Documentation: Auto-generated OpenAPI/Swagger
#### Frontend (packages/web)
- Framework: React with TypeScript
- Build Tool: Rsbuild (fast Vite alternative)
- Styling: TailwindCSS with PostCSS
- State Management: React hooks and context
- Testing: Jest with React Testing Library
## Development Workflow
### Environment Setup
```bash
# Clone and install dependencies
git clone <repository>
cd bed-stack
bun install

# Setup environment variables
cp packages/api/.env.example packages/api/.env
cp packages/web/.env.example packages/web/.env
```
### Development Commands
```bash
# Start both API and web in development mode
bun run dev

# Start individual services
bun run dev:api # API on port 3000
bun run dev:web # Web on port 4097

# Build for production
bun run build

# Run tests
bun run test

# Code formatting and linting
bun run fmt
bun run lint
```
## Database Schema & Migrations
### Core Tables
```typescript
// Users table with OAuth integration
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  googleId: text("google_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name"),
  picture: text("picture"),
  apiKey: text("api_key").unique(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// Tasks with relationships
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  dueDate: integer("due_date", { mode: "timestamp" }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// Work logs for time tracking
export const workLogs = sqliteTable("work_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").references(() => tasks.id),
  userId: integer("user_id").references(() => users.id),
  startTime: integer("start_time", { mode: "timestamp" }).notNull(),
  endTime: integer("end_time", { mode: "timestamp" }),
  duration: integer("duration"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});
```
### Database Operations
Use the `DatabaseWrapper` class for consistent database operations:

```typescript
import { DatabaseWrapper } from "./utils/database";

const dbWrapper = new DatabaseWrapper(db);

// Select with typing
const users = await dbWrapper.selectMany<User>(
  db.select().from(schema.users).where(eq(schema.users.email, email))
);

// Insert with validation
const newUser = await dbWrapper.insertOne(schema.users, {
  email: "user@example.com",
  name: "John Doe"
});
```
## API Development Patterns
### Route Structure
```typescript
// routes/users.ts
export const usersPlugin = new Elysia({ prefix: "/users" })
  .use(authPlugin)  // Add authentication
  .get("/", async ({ db }) => {
    // Get all users for authenticated user
  })
  .get("/me", async ({ user, db }) => {
    // Get current user profile
  })
  .patch("/me", async ({ body, user, db }) => {
    // Update current user profile
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      email: t.Optional(t.String())
    })
  });
```
### Validation with TypeBox
```typescript
import { t } from "@elysiajs/typebox";

const TaskSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
  description: t.Optional(t.String({ maxLength: 2000 })),
  priority: t.Enum({ low: "low", medium: "medium", high: "high" }),
  status: t.Enum({ 
    todo: "todo", 
    in_progress: "in_progress", 
    done: "done", 
    archived: "archived" 
  }),
  dueDate: t.Optional(t.Integer())
});
```
### Authentication Flow
```typescript
// JWT Configuration
app.use(jwt({
  name: "jwt",
  secret: config.jwtSecret,
}));

// Authentication Plugin
export const authPlugin = new Elysia()
  .derive(async ({ jwt, cookie: { auth } }) => {
    const token = await jwt.verify(auth.value);
    return {
      user: token,
      isAuthenticated: !!token
    };
  })
  .guard({
    beforeHandle({ user, set }) {
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    }
  });
```
### Error Handling
```typescript
// Consistent error responses
app.onError(({ error, code, set }) => {
  logger.error("API Error", { error: error as Error, code });
  
  switch (code) {
    case "VALIDATION":
      set.status = 400;
      return ResponseBuilder.error("Validation failed", "VALIDATION_ERROR", {
        details: error.all
      });
    case "NOT_FOUND":
      set.status = 404;
      return ResponseBuilder.error("Resource not found", "NOT_FOUND");
    default:
      set.status = 500;
      return ResponseBuilder.internal("An unexpected error occurred");
  }
});
```
## Frontend Development Patterns
### Component Structure
```typescript
// Type-safe API calls
interface Task {
  id: number;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done" | "archived";
  priority: "low" | "medium" | "high";
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number;
}

// API service functions
export const taskService = {
  async getTasks(filters?: TaskFilters): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append("status", filters.status);
    if (filters?.priority) params.append("priority", filters.priority);
    
    const response = await fetch(`${API_URL}/tasks?${params}`, {
      credentials: "include"
    });
    
    const data = await response.json();
    return data.success ? data.data.tasks : [];
  }
};
```
### State Management
```typescript
// React hooks for state management
function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchTasks = useCallback(async (filters?: TaskFilters) => {
    try {
      setLoading(true);
      const tasks = await taskService.getTasks(filters);
      setTasks(tasks);
    } catch (err) {
      setError("Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  return { tasks, loading, error, fetchTasks };
}
```
### TailwindCSS Integration
```css
/* App.css - Custom utilities with Tailwind */
.app-container {
  @apply min-h-screen bg-gray-50 text-gray-900;
}

.app-header {
  @apply flex justify-between items-center p-4 bg-white shadow-sm border-b;
}

.btn {
  @apply px-4 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500;
}

.btn-secondary {
  @apply bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500;
}
```
## Testing Strategy
### Backend Testing
```typescript
// tests/auth.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { app } from "../src/index";

describe("Authentication", () => {
  it("should protect protected routes", async () => {
    const response = await app
      .handle(new Request("http://localhost/users/me"))
      .then(res => res.json());
    
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe("UNAUTHORIZED");
  });

  it("should authenticate with valid JWT", async () => {
    const token = await generateTestJWT();
    const response = await app
      .handle(new Request("http://localhost/users/me", {
        headers: { "Authorization": `Bearer ${token}` }
      }))
      .then(res => res.json());
    
    expect(response.success).toBe(true);
    expect(response.data.user).toBeDefined();
  });
});
```
### Frontend Testing
```typescript
// tests/components/TaskCard.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskCard } from "../src/components/TaskCard";

describe("TaskCard", () => {
  const mockTask = {
    id: 1,
    title: "Test Task",
    description: "Test description",
    status: "todo" as const,
    priority: "medium" as const,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    createdBy: 1
  };

  it("renders task information correctly", () => {
    render(<TaskCard task={mockTask} onClick={jest.fn()} />);
    
    expect(screen.getByText("Test Task")).toBeInTheDocument();
    expect(screen.getByText("Test description")).toBeInTheDocument();
    expect(screen.getByText("todo")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const handleClick = jest.fn();
    render(<TaskCard task={mockTask} onClick={handleClick} />);
    
    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledWith(mockTask);
  });
});
```
## Deployment
### Production Build
```bash
# Build both packages
bun run build

# Start production servers
bun run start
```
### Environment Configuration
```typescript
// utils/const.ts
export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  apiPort: Number(process.env.API_PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || "your-secret-key",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redisUrl: process.env.REDIS_URL,
  databaseUrl: process.env.DATABASE_URL || "./database.db"
};
```
### Docker Deployment
```dockerfile
# Dockerfile
FROM oven/bun:1.3.9-alpine

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Copy source code
COPY . .

# Build application
RUN bun run build

# Expose port
EXPOSE 3000

# Start application
CMD ["bun", "run", "start"]
```
## Best Practices
### Code Organization
1. Modular Routes: Keep routes in separate files with clear responsibilities
2. Type Safety: Use TypeScript throughout - no `any` types
3. Validation: Validate all inputs using TypeBox schemas
4. Error Handling: Use consistent error response format
5. Database Operations: Use `DatabaseWrapper` for all DB operations
### Security
1. Input Validation: Validate all inputs on both client and server
2. Authentication: Use JWT with secure secret keys
3. CORS: Configure CORS properly for production
4. Rate Limiting: Implement rate limiting for API endpoints
5. Environment Variables: Never commit secrets to repository
### Performance
1. Database Optimization: Use proper indexes and query optimization
2. Caching: Implement Redis caching for frequently accessed data
3. Bundle Optimization: Use Rsbuild's optimization features
4. Lazy Loading: Implement code splitting for large applications
5. Image Optimization: Use modern image formats and lazy loading
## Common Patterns
### API Response Format
```typescript
// Standard API response structure
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  meta?: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
    };
  };
}
```
### Database Queries
```typescript
// Complex queries with joins and filtering
async function getUserTasks(userId: number, filters: TaskFilters) {
  return await dbWrapper.selectMany<Task>(
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.createdBy, userId),
          filters.status ? eq(tasks.status, filters.status) : undefined,
          filters.priority ? eq(tasks.priority, filters.priority) : undefined,
          filters.search ? like(tasks.title, `%${filters.search}%`) : undefined
        )
      )
      .orderBy(desc(tasks.createdAt))
  );
}
```
### React Component Patterns
```typescript
// Generic component with proper typing
interface ListComponentProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

function ListComponent<T>({
  items,
  renderItem,
  loading = false,
  emptyMessage = "No items found",
  className = ""
}: ListComponentProps<T>) {
  if (loading) return <div>Loading...</div>;
  if (items.length === 0) return <div>{emptyMessage}</div>;
  
  return (
    <div className={className}>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {renderItem(item)}
        </React.Fragment>
      ))}
    </div>
  );
}
```
## Troubleshooting
### Common Issues
1. Database Connection Errors
   - Check SQLite file permissions
   - Verify database path in environment variables
   - Ensure proper migration execution

2. Authentication Failures
   - Verify JWT secret configuration
   - Check token expiration
   - Ensure proper cookie handling

3. CORS Issues
   - Verify CORS configuration in development vs production
   - Check frontend API URL configuration
   - Ensure credentials are included in requests

4. Build Errors
   - Clear node_modules and reinstall dependencies
   - Check TypeScript configuration
   - Verify import paths and module resolution
### Debugging Tools
```typescript
// Logger utility
import { logger } from "./utils/logger";

// Debug database queries
logger.debug("Database query", { query: sql, params: values });

// Debug API requests
logger.info("API request", { method, url, userId });

// Debug errors
logger.error("Application error", { error: error as Error, context });
```
## Performance Monitoring
### Metrics to Track
1. API Response Times: Monitor endpoint performance
2. Database Query Times: Track slow queries
3. Error Rates: Monitor application errors
4. User Activity: Track authentication and usage patterns
5. Resource Usage: Monitor memory and CPU usage
### Optimization Techniques
1. Database Indexing: Add indexes for frequently queried columns
2. Query Optimization: Use efficient query patterns
3. Caching: Implement Redis caching for expensive operations
4. Bundle Splitting: Use dynamic imports for code splitting
5. Image Optimization: Compress and optimize images

This comprehensive skill documentation provides the foundation for developing robust, scalable applications using the BED Stack technology stack.
