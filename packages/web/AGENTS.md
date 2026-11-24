# AGENTS.md
You are an expert in JavaScript, Rsbuild, and web application development. You write maintainable, performant, and accessible code.
## MARKDOWN WRITING RULE
RULE: When writing markdown, do not use bold text formatting (text). Use plain text or other formatting options instead.
## Commands
- `bun run dev` - Start the dev server
- `bun run build` - Build the app for production
- `bun run preview` - Preview the production build locally
## Docs
- Rsbuild: <https://rsbuild.rs/llms.txt>
- Rspack: <https://rspack.rs/llms.txt>
## Tools
### Biome
- Run `bun run lint` to lint your code
- Run `bun run format` to format your code

## Tech Stack and Folder Structure
This guide provides a comprehensive overview of the project's technology stack, architecture, and folder structure.
## Tech Stack Overview
### Frontend (packages/web)
- Framework: React with TypeScript
- Build Tool: Vite
- Styling: TailwindCSS
- UI Components: shadcn/ui components
- Icons: Lucide React
- State Management: React hooks and context
- Routing: React Router (likely)
### Backend (packages/api)
- Runtime: Bun (JavaScript runtime)
- Framework: Elysia (TypeScript web framework)
- Database: SQLite with Drizzle ORM
- Authentication: Google OAuth2
- Validation: TypeBox and Elysia validation
- CORS: @elysiajs/cors
- JWT: @elysiajs/jwt
- API Documentation: @elysiajs/openapi
- Caching: Redis (ioredis)
- ID Generation: nanoid
### Development Tools
- Package Manager: Bun
- Testing: Bun's built-in test runner
- Linting: Biome (configured in .cursor/rules/)
- TypeScript: Strict TypeScript configuration
- Git Hooks: Standard git hooks setup
## Project Structure
```text
project-name/
├─.agent/ # Agent-specific configurations
├─.agents/ # Multiple agent configurations
├─.claude/ # Claude AI configurations
├─.codex/ # OpenAI Codex configurations
├─.cursor/ # Cursor IDE configurations
│   └─rules/ # Cursor-specific rules
│       └─use-bun-instead-of-node-vite-npm-pnpm.mdc
├─.gemini/ # Google Gemini configurations
├─.git/ # Git version control
├─.opencode/ # OpenCode configurations
├─.qwen/ # Qwen AI configurations
├─.ralph/ # Ralph AI configurations
│   ├─ralph-opencode.config.json
│   └─ralph-tasks.md
├─.vscode/ # VS Code settings
│   └─settings.json
├─.windsurf/ # Windsurf configurations
│   └─skills/ # Windsurf-specific skills
├─docs/ # Project documentation
│   └─features.md
├─packages/ # Monorepo packages
│   ├─.ralph/ # Ralph-specific package configs
│   ├─api/ # Backend API package
│   │   ├─src/ # Source code
│   │   │   ├─auth/ # Authentication logic
│   │   │   ├─db/ # Database setup and schemas
│   │   │   │   └─schema.ts
│   │   │   ├─routes/ # API route handlers
│   │   │   │   ├─agent.ts # Agent API endpoints
│   │   │   ├─utils/ # Utility functions
│   │   │   │   ├─database.ts
│   │   │   │   ├─logger.ts
│   │   │   │   └─response.ts
│   │   │   └─index.ts # Main entry point
│   │   ├─tests/ # Test files
│   │   │   ├─agent-unit.test.ts
│   │   │   ├─auth.test.ts
│   │   │   ├─response.test.ts
│   │   │   ├─validation-elysia.test.ts
│   │   │   ├─validation.test.ts
│   │   │   └─README.md
│   │   ├─.env.example # Environment variables template
│   │   ├─.env.test # Test environment variables
│   │   ├─.gitignore # Git ignore patterns
│   │   ├─package.json # Package configuration
│   │   └─tsconfig.json # TypeScript configuration
│   ├─docs/ # Documentation package
│   │   └─features.md
│   └─web/ # Frontend web package
│       ├─public/ # Static assets
│       ├─src/ # Source code
│       ├─.env.example # Environment variables template
│       ├─.gitignore # Git ignore patterns
│       ├─AGENTS.md # Agent documentation
│       ├─package.json # Package configuration
│       └─tsconfig.json # TypeScript configuration
├─.gitignore # Root git ignore
├─.markdownlint.json # Markdown linting rules
├─.npmrc # npm configuration
├─bun.lock # Bun lock file
├─package.json # Root package configuration
├─tsconfig.json # Root TypeScript configuration
├─validation.md # Validation guidelines
└─README.md # Project README
```
## Key Architectural Patterns
### Monorepo Structure
- Packages: Separate packages for frontend (web) and backend (api)
- Shared Configuration: Root-level TypeScript and npm configurations
- Independent Testing: Each package has its own test suite
### Backend Architecture (packages/api)
#### Database Layer
- ORM: Drizzle ORM with SQLite
- Schema: Defined in `src/db/schema.ts`
- Tables: `users`, `seats`, `reservations`
- Wrapper: Custom `DatabaseWrapper` class for database operations
#### API Layer
- Framework: Elysia with TypeScript
- Routes: Modular route handlers in `src/routes/`
- Validation: TypeBox schemas for request/response validation
- Authentication: JWT-based with Google OAuth2 integration
#### Agent API
- Purpose: External system integration for AI agents
- Authentication: API key-based authentication
- Endpoints: Seat reservation endpoints for external systems
- Security: User-scoped access control
#### Utility Layer
- DatabaseWrapper: Abstracted database operations
- ResponseBuilder: Consistent API response formatting
- Logger: Structured logging utility
### Frontend Architecture (packages/web)
- Framework: React with TypeScript
- Styling: TailwindCSS for utility-first styling
- Components: shadcn/ui component library
- Build: Vite for fast development and building
## Development Workflow
### Environment Setup
1. Install Bun: JavaScript runtime and package manager
2. Install Dependencies: `bun install` from root
3. Environment Variables: Copy `.env.example` to `.env` in relevant packages
4. Database Setup: SQLite database with Drizzle migrations
### Development Commands
```bash
# Install dependencies
bun install

# Run API in development mode
cd packages/api && bun run dev

# Run web in development mode
cd packages/web && bun run dev

# Run tests
bun test

# Run tests for specific package
cd packages/api && bun test
```
### Testing Strategy
- Unit Tests: Focus on business logic and validation
- Integration Tests: Test component interactions
- Mocking: Comprehensive mocking for external dependencies
- Coverage: High test coverage for critical paths
## Key Files and Their Purposes
### Configuration Files
- `package.json`: Root package configuration and scripts
- `tsconfig.json`: TypeScript configuration with strict settings
- `bun.lock`: Dependency lock file for Bun
- `.gitignore`: Git ignore patterns for the entire project
### API Package Files
- `src/index.ts`: Main API entry point
- `src/db/schema.ts`: Database schema definitions
- `src/routes/agent.ts`: Agent API endpoints
- `src/utils/database.ts`: Database abstraction layer
- `src/utils/response.ts`: Response formatting utility
### Test Files
- `tests/agent-unit.test.ts`: Comprehensive Agent API tests
- `tests/validation.test.ts`: Input validation tests
- `tests/response.test.ts`: Response formatting tests
## Technology Choices Rationale
### Bun as Runtime
- Performance: Faster than Node.js for both runtime and package management
- TypeScript: Native TypeScript support
- Testing: Built-in test runner with good performance
- Compatibility: Node.js ecosystem compatibility
### Elysia as Framework
- TypeScript First: Full TypeScript support with type safety
- Performance: High performance with low overhead
- Validation: Built-in validation with TypeBox
- Documentation: Auto-generated OpenAPI documentation
### Drizzle ORM
- TypeScript: Type-safe database operations
- Performance: Lightweight and fast
- SQL-like: Familiar query syntax
- Migration: Built-in migration system
### React + TailwindCSS
- Component-Based: Modular, reusable components
- Utility-First: Rapid styling with TailwindCSS
- TypeScript: Type-safe frontend development
- Ecosystem: Large ecosystem and community support
## Best Practices Implemented
### Code Organization
- Modular Structure: Clear separation of concerns
- Type Safety: Comprehensive TypeScript usage
- Testing: High test coverage with meaningful tests
- Documentation: Clear documentation and comments
### Security
- Authentication: Secure JWT-based authentication
- Validation: Comprehensive input validation
- API Keys: Secure API key management for external access
- CORS: Proper CORS configuration
### Performance
- Bun Runtime: Fast JavaScript runtime
- Lightweight Dependencies: Minimal dependency footprint
- Efficient Database: Optimized database queries
- Caching: Redis caching for performance
## Future Considerations
### Scalability
- Database: Consider PostgreSQL for larger scale
- Caching: Enhanced Redis usage patterns
- Load Balancing: Multiple API instances
- CDN: Static asset delivery optimization
### Monitoring
- Logging: Enhanced structured logging
- Metrics: Performance and error monitoring
- Health Checks: API health monitoring
- Analytics: Usage analytics and insights
### Security Enhancements
- Rate Limiting: API rate limiting
- Audit Logs: Comprehensive audit logging
- Security Headers: Enhanced security headers
- Input Sanitization: Additional input sanitization layers
