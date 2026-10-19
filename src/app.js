
const express = require("express");
const prisma = require("./db");
const redis = require("./redis");
const { allowRoles } = require("./middleware/auth");

const app = express();

redis.connect().catch((error) => {
  console.error("Redis connection failed:", error.message);
});

// CORS for local frontend development
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-role");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// List events with Redis caching
app.get("/events", async (req, res) => {
  try {
    const cached = await redis.get("events:all");
    if (cached) return res.json(JSON.parse(cached));

    const events = await prisma.event.findMany({
      include: { ticketTiers: true }
    });

    await redis.set("events:all", JSON.stringify(events), { EX: 60 });
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// Demo event creation: Admin or Organizer
app.post("/test-event", allowRoles("ADMIN", "ORGANIZER"), async (req, res) => {
  try {
    const user = await prisma.user.create({
      data: {
        name: "Test Organizer",
        email: `organizer-${Date.now()}@example.com`,
        password: "temporary-demo-password",
        role: "ORGANIZER"
      }
    });

    const event = await prisma.event.create({
      data: {
        title: "Tech Fest 2026",
        description: "College technology event",
        venue: "College Auditorium",
        startTime: new Date("2026-12-15T10:00:00"),
        salesCutoff: new Date("2026-12-14T18:00:00"),
        organizerId: user.id
      }
    });

    await redis.del("events:all");

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      event
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create demo event" });
  }
});

// Create ticket tier: Admin or Organizer
app.post(
  "/events/:eventId/ticket-tiers",
  allowRoles("ADMIN", "ORGANIZER"),
  async (req, res) => {
    try {
      const eventId = Number(req.params.eventId);
      const { name, price, quantity } = req.body || {};
      const numericPrice = Number(price);

      if (
        !Number.isInteger(eventId) || eventId <= 0 ||
        typeof name !== "string" || !name.trim() ||
        price === undefined || price === null ||
        !Number.isFinite(numericPrice) || numericPrice < 0 ||
        !Number.isInteger(quantity) || quantity <= 0
      ) {
        return res.status(400).json({
          error: "Provide a valid event ID, name, non-negative price, and positive quantity"
        });
      }

      const event = await prisma.event.findUnique({ where: { id: eventId } });
      if (!event) return res.status(404).json({ error: "Event not found" });

      if (new Date() >= event.salesCutoff) {
        return res.status(400).json({ error: "Ticket sales have closed" });
      }

      const ticketTier = await prisma.ticketTier.create({
        data: {
          name: name.trim(),
          price: numericPrice,
          totalQuantity: quantity,
          availableQuantity: quantity,
          eventId
        }
      });

      await redis.del("events:all");
      res.status(201).json(ticketTier);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to create ticket tier" });
    }
  }
);

// List ticket tiers: GET, not POST
app.get("/events/:eventId/ticket-tiers", async (req, res) => {
  try {
    const eventId = Number(req.params.eventId);

    if (!Number.isInteger(eventId) || eventId <= 0) {
      return res.status(400).json({ error: "Invalid event ID" });
    }

    const ticketTiers = await prisma.ticketTier.findMany({
      where: { eventId }
    });

    res.json(ticketTiers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch ticket tiers" });
  }
});

// Create a 10-minute reservation with inventory locking
app.post("/reservations", async (req, res) => {
  try {
    const { userId, ticketTierId, quantity } = req.body || {};

    if (
      !Number.isInteger(userId) || userId <= 0 ||
      !Number.isInteger(ticketTierId) || ticketTierId <= 0 ||
      !Number.isInteger(quantity) || quantity <= 0
    ) {
      return res.status(400).json({
        error: "userId, ticketTierId, and positive integer quantity are required"
      });
    }

    const reservation = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`
        SELECT "id" FROM "TicketTier"
        WHERE "id" = ${ticketTierId}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        const error = new Error("Ticket tier not found");
        error.statusCode = 404;
        throw error;
      }

      const tier = await tx.ticketTier.findUnique({
        where: { id: ticketTierId },
        include: { event: true }
      });

      if (!tier) {
        const error = new Error("Ticket tier not found");
        error.statusCode = 404;
        throw error;
      }

      const now = new Date();
      if (now >= tier.event.salesCutoff) {
        const error = new Error("Ticket sales have closed");
        error.statusCode = 400;
        throw error;
      }

      const expired = await tx.reservation.findMany({
        where: {
          ticketTierId,
          status: "HELD",
          expiresAt: { lte: now }
        },
        select: { id: true, quantity: true }
      });

      if (expired.length) {
        const ids = expired.map((r) => r.id);
        const total = expired.reduce((sum, r) => sum + r.quantity, 0);

        await tx.reservation.updateMany({
          where: { id: { in: ids }, status: "HELD" },
          data: { status: "EXPIRED" }
        });

        await tx.ticketTier.update({
          where: { id: ticketTierId },
          data: { availableQuantity: { increment: total } }
        });
      }

      const currentTier = await tx.ticketTier.findUnique({
        where: { id: ticketTierId }
      });

      if (currentTier.availableQuantity < quantity) {
        const error = new Error("Not enough tickets available");
        error.statusCode = 409;
        throw error;
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true }
      });

      if (!user) {
        const error = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }

      await tx.ticketTier.update({
        where: { id: ticketTierId },
        data: { availableQuantity: { decrement: quantity } }
      });

      return tx.reservation.create({
        data: {
          userId,
          ticketTierId,
          quantity,
          status: "HELD",
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
        }
      });
    }, {
      isolationLevel: "ReadCommitted",
      maxWait: 5000,
      timeout: 10000
    });

    await redis.del("events:all");

    res.status(201).json({
      message: "Tickets held for 10 minutes",
      reservation
    });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Failed to reserve tickets"
    });
  }
});

// Development/testing endpoint: list reservations
app.get("/reservations", async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        ticketTier: { select: { name: true, price: true, eventId: true } },
        user: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(reservations);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch reservations" });
  }
});

// Mock payment gateway
const paymentInProgress = new Set();

app.post("/reservations/:id/payment", async (req, res) => {
  const reservationId = Number(req.params.id);

  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return res.status(400).json({ error: "Invalid reservation ID" });
  }

  if (paymentInProgress.has(reservationId)) {
    return res.status(409).json({ error: "Payment already in progress" });
  }

  paymentInProgress.add(reservationId);

  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const result = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id: reservationId }
      });

      if (!reservation) {
        const error = new Error("Reservation not found");
        error.statusCode = 404;
        throw error;
      }

      await tx.$queryRaw`
        SELECT "id" FROM "TicketTier"
        WHERE "id" = ${reservation.ticketTierId}
        FOR UPDATE
      `;

      const current = await tx.reservation.findUnique({
        where: { id: reservationId }
      });

      if (current.status !== "HELD" || current.expiresAt <= new Date()) {
        const error = new Error("Reservation expired or is no longer payable");
        error.statusCode = 409;
        throw error;
      }

      const approved = Math.random() < 0.8;

      if (approved) {
        const updated = await tx.reservation.updateMany({
          where: {
            id: reservationId,
            status: "HELD",
            expiresAt: { gt: new Date() }
          },
          data: { status: "CONFIRMED" }
        });

        if (updated.count !== 1) {
          const error = new Error("Reservation is no longer payable");
          error.statusCode = 409;
          throw error;
        }

        return { approved: true };
      }

      const updated = await tx.reservation.updateMany({
        where: {
          id: reservationId,
          status: "HELD",
          expiresAt: { gt: new Date() }
        },
        data: { status: "PAYMENT_FAILED" }
      });

      if (updated.count !== 1) {
        const error = new Error("Reservation is no longer payable");
        error.statusCode = 409;
        throw error;
      }

      await tx.ticketTier.update({
        where: { id: reservation.ticketTierId },
        data: { availableQuantity: { increment: reservation.quantity } }
      });

      return { approved: false };
    });

    await redis.del("events:all");

    if (result.approved) {
      return res.json({
        message: "Payment successful",
        reservationId,
        status: "CONFIRMED"
      });
    }

    return res.status(402).json({
      message: "Payment rejected by mock gateway",
      reservationId,
      status: "PAYMENT_FAILED"
    });
  } catch (error) {
    console.error("Payment error:", error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : "Payment processing failed"
    });
  } finally {
    paymentInProgress.delete(reservationId);
  }
});

app.get(
  "/organizer/analytics",
  allowRoles("ADMIN", "ORGANIZER"),
  async (req, res) => {
    try {
      const confirmed = await prisma.reservation.findMany({
        where: { status: "CONFIRMED" },
        include: {
          ticketTier: {
            include: { event: true }
          }
        }
      });

      const revenue = confirmed.reduce((total, reservation) => {
        return total +
          Number(reservation.ticketTier.price) * reservation.quantity;
      }, 0);

      const totalTicketsSold = confirmed.reduce(
        (total, reservation) => total + reservation.quantity,
        0
      );

      const totalReservations = await prisma.reservation.count();
      const confirmedReservations = confirmed.length;

      res.json({
        totalTicketsSold,
        totalRevenue: Number(revenue.toFixed(2)),
        totalReservations,
        confirmedReservations,
        conversionRate: totalReservations
          ? Number(
              ((confirmedReservations / totalReservations) * 100).toFixed(2)
            )
          : 0
      });
    } catch (error) {
      console.error("Analytics error:", error);
      res.status(500).json({ error: "Failed to load analytics" });
    }
  }
);


app.get(
  "/organizer/analytics",
  allowRoles("ADMIN", "ORGANIZER"),
  async (req, res) => {
    try {
      const confirmed = await prisma.reservation.findMany({
        where: { status: "CONFIRMED" },
        include: { ticketTier: true },
      });

      const totalTicketsSold = confirmed.reduce(
        (sum, reservation) => sum + reservation.quantity,
        0
      );

      const totalRevenue = confirmed.reduce(
        (sum, reservation) =>
          sum +
          Number(reservation.ticketTier.price) * reservation.quantity,
        0
      );

      const totalReservations = await prisma.reservation.count();
      const confirmedReservations = confirmed.length;

      const conversionRate = totalReservations
        ? (confirmedReservations / totalReservations) * 100
        : 0;

      res.json({
        totalTicketsSold,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalReservations,
        confirmedReservations,
        conversionRate: Number(conversionRate.toFixed(2)),
      });
    } catch (error) {
      console.error("Analytics error:", error);
      res.status(500).json({ error: "Failed to load analytics" });
    }
  }
);

module.exports = app;

