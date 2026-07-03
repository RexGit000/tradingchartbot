const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, index: true },
    username: { type: String, default: null },
    screenshotFileId: { type: String, required: true },
    status: { type: String, enum: ["pending", "approved", "declined"], default: "pending" },
    financeAdminId: { type: Number, default: null },
    financeAdminMessageId: { type: Number, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
