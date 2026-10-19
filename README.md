# Eventify — Multi-Tenant Event & Ticket Reservation System

A full-stack event booking platform that allows users to explore events, reserve tickets, and complete a simulated payment process. It includes ticket inventory management, temporary reservation holds, and organizer analytics.

## Project Overview

Eventify is designed to simplify event management and ticket booking while preventing multiple users from booking the same remaining tickets concurrently.

### Key Features

- **Event Discovery:** Browse events, search by title or venue, and explore ticket options.
- **Event & Ticket Management:** Store events, ticket tiers, prices, and ticket quantities.
- **Temporary Reservations:** Hold tickets for 10 minutes while checkout is completed.
- **Concurrency Control:** Use PostgreSQL transactions and row-level locking to protect ticket inventory.
- **Mock Payment Gateway:** Simulate payment approval or failure and update reservation status.
- **Automatic Reservation Expiry:** Background job releases inventory from expired holds.
- **Redis Caching:** Cache event listings to reduce repeated database queries.
- **Organizer Analytics:** Display confirmed tickets sold, revenue, total reservations, and booking conversion.
- **Responsive UI:** Dark-themed interface designed for desktop and mobile screens.

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| ORM | Prisma |
| Caching | Redis |
| Containerization | Docker Compose |
| API Testing | Postman |

## Architecture

1. The frontend sends HTTP requests to the Express API.
2. Express validates requests and invokes the required business logic.
3. Prisma communicates with PostgreSQL to store and retrieve data.
4. PostgreSQL transactions and row-level locks protect ticket inventory during reservations.
5. Redis caches event listing data.
6. A background job checks for expired reservations and restores ticket availability.
7. The analytics endpoint calculates sales and booking metrics from reservation data.

## Database Models

- **User:** Stores user details and role information.
- **Event:** Stores event details and organizer ownership.
- **TicketTier:** Stores ticket categories, prices, total quantities, and available quantities.
- **Reservation:** Stores the quantity, status, expiry time, user, and ticket tier for each booking.

## Getting Started

### Prerequisites

- Node.js and npm
- Docker Desktop
- Git (for version control)

### 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd event-ticketing
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://app:app@localhost:5432/ticketing?schema=public"
```

Use appropriate credentials for your own environment. Do not commit secrets to GitHub.

### 4. Start PostgreSQL and Redis

```bash
docker compose up -d
```

### 5. Initialize the database

If the project's Prisma migrations are included:

```bash
npx prisma migrate deploy
npx prisma generate
```

For a new local development database without existing migrations, create and apply a migration using the project's development workflow.

### 6. Start the backend

```bash
npm run dev
```

The API runs at:

`http://localhost:3000`

### 7. Open the frontend

Open `frontend/index.html` using the VS Code Live Server extension. The local development URL is commonly:

`http://127.0.0.1:5500/frontend/index.html`

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/events` | List events |
| POST | `/test-event` | Create a demo event |
| GET | `/events/:eventId/ticket-tiers` | List ticket tiers |
| POST | `/events/:eventId/ticket-tiers` | Create a ticket tier |
| POST | `/reservations` | Create a temporary reservation |
| GET | `/reservations` | List reservations for development/testing |
| POST | `/reservations/:id/payment` | Simulate payment |
| GET | `/organizer/analytics` | Retrieve organizer analytics |

## Reservation Workflow

1. The attendee selects a ticket tier and quantity.
2. The server locks the relevant ticket-tier row and checks available inventory.
3. Available tickets are reserved and held for 10 minutes.
4. The attendee attempts simulated payment.
5. A successful payment confirms the reservation; a failed payment releases its tickets.
6. Expired holds are processed by the background expiry job.

## Testing

Test the following scenarios:

- Retrieve event listings and ticket tiers.
- Reserve an available quantity of tickets.
- Attempt to reserve more tickets than are available.
- Confirm that temporary holds expire after 10 minutes.
- Test successful and failed mock payments.
- Verify that concurrent reservations do not oversell inventory.
- Verify organizer analytics after confirmed bookings.

## Important Limitations

This project is a demonstration MVP. Payments are simulated; no real money is processed. The current role-header mechanism is for prototype testing and is not secure production authentication. Before production deployment, implement authenticated sessions or tokens, authorization based on verified users and event ownership, request validation, rate limiting, and secure secret management.

The organizer analytics endpoint currently aggregates reservations across the application; production use should scope analytics to the authenticated organizer and their events.

## Future Enhancements

- Secure authentication and role-based authorization.
- Event editing and cancellation.
- Organizer-specific dashboards and revenue charts.
- Persistent payment transaction records.
- Automated API tests and CI/CD.

## Author

Developed as a full-stack event ticketing system project.
