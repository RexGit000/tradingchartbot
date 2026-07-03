const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, default: null, index: true },
    username: { type: String, default: null }, // stored with leading @
    isSuperAdmin: { type: Boolean, default: false },
    isFinanceAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Admin", adminSchema);
