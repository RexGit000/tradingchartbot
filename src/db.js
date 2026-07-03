const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing from .env");
  }
  await mongoose.connect(uri, { dbName: "clientRexTradeAnalysisBot" });
  console.log("MongoDB connected (db: clientRexTradeAnalysisBot)");
}

module.exports = { connectDB };
