const { createClient } = require("@clickhouse/client");

if (!process.env.CLICKHOUSE_PASSWORD) {
  try { require("dotenv").config({ path: require("path").join(__dirname, "../../.env") }); } catch {}
}

const client = createClient({
  url: process.env.CLICKHOUSE_URL || "http://127.0.0.1:8123",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: "default",
  clickhouse_settings: {
    async_insert: 1,
    wait_for_async_insert: 0,
  }
});

let isInitialized = false;

async function initClickHouse() {
  try {
    await client.exec({
      query: `
        CREATE TABLE IF NOT EXISTS attacks (
          id UUID,
          timestamp DateTime64(3),
          srcIP String,
          srcPort UInt16,
          service String,
          type String,
          username String,
          password String,
          details String,
          severity String
        ) ENGINE = MergeTree()
        ORDER BY (timestamp, service, srcIP)
      `
    });
    isInitialized = true;
    console.log("✅ ClickHouse DB Initialized Successfully");
  } catch (error) {
    console.error("⚠️ ClickHouse DB Initialization Failed (Will retry later):", error.message);
  }
}

async function insertAttack(attack) {
  if (!isInitialized) return; // Skip if DB is not up
  try {
    await client.insert({
      table: 'attacks',
      values: [
        {
          id: attack.id,
          timestamp: new Date(attack.timestamp).getTime(),
          srcIP: attack.srcIP || 'unknown',
          srcPort: attack.srcPort || 0,
          service: attack.service || 'unknown',
          type: attack.type || 'unknown',
          username: attack.username || '',
          password: attack.password || '',
          details: (attack.details || '').substring(0, 500),
          severity: attack.analysis?.severity || 'INFO'
        }
      ],
      format: 'JSONEachRow',
    });
  } catch (error) {
    console.error("⚠️ Failed to insert attack into ClickHouse:", error.message);
  }
}

module.exports = {
  client,
  initClickHouse,
  insertAttack
};
