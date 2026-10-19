
const { createClient } = require("redis");

const redis = createClient({
  url: "redis://localhost:16379"
});

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

module.exports = redis;
