const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, default: null },
    subscriptionExpiresAt: { type: Date, default: null },
    awaitingPaymentScreenshot: { type: Boolean, default: false },
    paymentPromptChatId: { type: Number, default: null },
    paymentPromptMessageId: { type: Number, default: null },
    reminded2Day: { type: Boolean, default: false },
    reminded1Day: { type: Boolean, default: false },
    remindedExpired: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
