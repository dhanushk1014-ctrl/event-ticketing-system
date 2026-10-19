
const { createClient } = require("redis");

const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:16379"
});

redis.on("error", (error) => {
  console.error("Redis error:", error.message);
});

module.exports = redis;
