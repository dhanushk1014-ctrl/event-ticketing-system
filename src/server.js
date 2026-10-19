
require("dotenv").config();

const app = require("./app");
const { startReservationExpiryJob } = require("./jobs/expireReservations");

app.listen(3000, () => {
  console.log("Server running on port 3000");

  // Check for expired reservations every 30 seconds.
 startReservationExpiryJob();

  console.log("Reservation expiry job started");
});
