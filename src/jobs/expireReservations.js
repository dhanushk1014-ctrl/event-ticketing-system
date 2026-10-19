
const prisma = require("../db");

async function expireReservations() {
  const now = new Date();

  // Find ticket tiers that may have expired reservations.
  const tiers = await prisma.$queryRaw`
    SELECT DISTINCT "ticketTierId"
    FROM "Reservation"
    WHERE "status" = 'HELD'
      AND "expiresAt" <= ${now}
  `;

  let expiredCount = 0;

  for (const item of tiers) {
    const count = await prisma.$transaction(async (tx) => {
      // Use the same inventory lock as the booking endpoint.
      const lockedTier = await tx.$queryRaw`
        SELECT "id"
        FROM "TicketTier"
        WHERE "id" = ${item.ticketTierId}
        FOR UPDATE
      `;

      if (lockedTier.length === 0) {
        return 0;
      }

      // Recheck after obtaining the lock.
      const expired = await tx.reservation.findMany({
        where: {
          ticketTierId: item.ticketTierId,
          status: "HELD",
          expiresAt: { lte: now }
        },
        select: {
          id: true,
          quantity: true
        }
      });

      if (expired.length === 0) {
        return 0;
      }

      const ids = expired.map((reservation) => reservation.id);
      const quantityToRestore = expired.reduce(
        (total, reservation) => total + reservation.quantity,
        0
      );

      const result = await tx.reservation.updateMany({
        where: {
          id: { in: ids },
          status: "HELD"
        },
        data: { status: "EXPIRED" }
      });

      // Restore inventory only for rows actually changed.
      if (result.count > 0) {
        // The tier lock prevents competing booking/expiry jobs
        // from changing these reservations at the same time.
        await tx.ticketTier.update({
          where: { id: item.ticketTierId },
          data: {
            availableQuantity: { increment: quantityToRestore }
          }
        });
      }

      return result.count;
    });

    expiredCount += count;
  }

  if (expiredCount > 0) {
    console.log(`Expired ${expiredCount} reservation(s)`);
  }
}

function startReservationExpiryJob() {
  let running = false;

  const runSafely = async () => {
    if (running) return;

    running = true;

    try {
      await expireReservations();
    } catch (error) {
      console.error("Reservation expiry job failed:", error);
    } finally {
      running = false;
    }
  };

  // Run once on startup, then every 30 seconds.
  void runSafely();
  const timer = setInterval(runSafely, 30_000);

  return timer;
}

module.exports = { startReservationExpiryJob };
