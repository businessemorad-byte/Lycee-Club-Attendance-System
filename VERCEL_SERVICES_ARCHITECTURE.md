# Vercel Services Architecture Configuration

This repository is configured to deploy on Vercel as a multi-service project using Vercel's Services architecture.

## Services Overview

### 1. `api-server` (Internal Backend)
- **Framework**: Express.js
- **Root**: `artifacts/api-server`
- **Purpose**: Handles API requests, authentication, admin authorization, and business logic
- **Routes**:
  - `/api/healthz` - Health check endpoint
  - `/api/club/overview` - Dashboard overview
  - `/api/students` - Student management
  - `/api/sessions` - Club session management
  - `/api/attendance/scan` - Attendance scanning
  - `/api/reports/{id}` - Session reports
  - `/api/reports/{id}/csv` - CSV export
  - `/api/__clerk/*` - Clerk frontend API proxy

### 2. `club-attendance` (Public Frontend)
- **Framework**: Vite + React
- **Root**: `artifacts/club-attendance`
- **Purpose**: Main user-facing club attendance interface
- **Features**:
  - Dashboard with overview
  - Student management interface
  - Session calendar
  - Attendance scanning
  - Report generation
  - Uses Clerk for authentication

### 3. `mockup-sandbox` (Public Component Preview)
- **Framework**: Vite + React
- **Root**: `artifacts/mockup-sandbox`
- **Purpose**: Component preview and testing environment
- **Features**:
  - Component gallery
  - Real-time component preview
  - Component property controls
  - Used for UI development and testing

## Service Communication

### Internal Service Bindings

Vercel Services allow internal communication between services through bindings:

1. **Club Attendance → API Server**: Club attendance application calls the API server using the `CLUB_ATTENDANCE_URL` binding
2. **Mockup Sandbox → API Server**: Mockup sandbox can call the API server if needed
3. **API Server → Mockup Sandbox**: API server can expose preview endpoints to mockup sandbox

### How Bindings Work

Bindings are declared in the calling service and inject the target's base URL as an environment variable:

```json
{
  "bindings": [
    {
      "type": "service",
      "service": "club-attendance",
      "format": "url",
      "env": "CLUB_ATTENDANCE_URL"
    }
  ]
}
```

This injects `CLUB_ATTENDANCE_URL` into the calling service at runtime, containing the internal URL of the target service.

## Public Routing

### Request Flow

All requests go through the top-level rewrites in `vercel.json`:

1. **API Routes** (`/api/*`) → Directed to `api-server`
2. **Clerk Proxy** (`/api/__clerk/*`) → Directed to `api-server`
3. **Component Preview** (`/components/preview/*`) → Directed to `mockup-sandbox`
4. **Health Check** (`/api/healthz` or `/healthz`) → Directed to `api-server`
5. **All Other Routes** → Directed to `club-attendance` (catch-all)

### Example Request Flow

```
/user-profile/123
├── Matches catch-all rewrite `/ (.*)`
└── Destination: club-attendance
    └── Serves React application
        └── Makes API calls to: https://CLUB_ATTENDANCE_URL/api/user-profile/123
```

## Development

### Local Development

Use `vercel dev` to run all services locally:

```bash
vercel dev
```

This will:
1. Start all three services
2. Configure bindings between services
3. Route requests according to vercel.json configuration
4. Provide a unified local development experience

### Service-to-Service Communication

When a service calls another service:

```typescript
// In club-attendance application
const apiUrl = process.env.CLUB_ATTENDANCE_URL; // This is the binding

if (!apiUrl) {
  throw new Error("CLUB_ATTENDANCE_URL is not set - binding missing");
}

const response = await fetch(`${apiUrl}/api/healthz`);
```

## Environment Variables

### Service Bindings

The following environment variables are injected by Vercel at runtime:

- `CLUB_ATTENDANCE_URL` - Internal URL of the club-attendance service
- `MOCKUP_SANDBOX_URL` - Internal URL of the mockup-sandbox service

### Application Configuration

Services can also define their own environment variables:

- `ADMIN_EMAILS` - Comma-separated list of admin email addresses
- `ADMIN_EMAILS_FALLBACK` - Fallback admin emails if ADMIN_EMAILS is not set
- `CLERK_SECRET_KEY` - Clerk secret key for authentication
- `CLERK_PUBLISHABLE_KEY` - Clerk publishable key

## Deployment

When deploying to Vercel:

1. The configuration in `vercel.json` is automatically detected
2. All services are built and deployed as part of a single Vercel project
3. Service bindings are configured at deployment time
4. Rewrites are set up to route traffic correctly

## Benefits

### Single Project, Multiple Services

- Shared routing, environment variables, and domain across all services
- Unified configuration and management
- Automatic service discovery through bindings

### Independent Builds and Deployments

- Each service is built and deployed independently
- Faster deployment times
- Independent scaling options

### Runtime Service Discovery

- Services discover each other through bindings at runtime
- Flexible service architecture
- Easy to modify service relationships

## Architecture Validation

This configuration ensures:

1. **Correct Routing**: All requests go to the right service
2. **Secure Communication**: Internal service calls use secure internal URLs
3. **Easy Maintenance**: Single configuration file for multi-service setup
4. **Scalable Design**: Each service can be scaled independently
5. **Flexible Development**: Local development mirrors production environment

## Next Steps

1. **Configure Environment Variables**: Set up service-specific environment variables in Vercel dashboard
2. **Test Service Communication**: Verify that services can call each other correctly
3. **Configure Clerk**: Set up Clerk authentication for the club-attendance service
4. **Set Up Monitoring**: Configure monitoring and logging across all services
5. **Performance Optimization**: Fine-tune service configurations for optimal performance
