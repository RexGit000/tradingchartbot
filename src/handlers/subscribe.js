const fs = require("fs");
const path = require("path");
const User = require("../models/User");
const Payment = require("../models/Payment");
const { getFinanceAdmin } = require("../adminAuth");
const { activateSubscription, getOrCreateUser } = require("../subscription");
const { editOrReply } = require("../ui");

const UPI_IMAGE_PATH = path.join(__dirname, "..", "..", "assets", "upi.png");

function registerSubscriptionHandlers(bot) {
  bot.command("subscribe", (ctx) => sendSubscribePrompt(ctx));

  // Same UPI message morphs: [QR + Confirm Deposit] -> [instructions] -> [pending review]
  bot.action("confirm_deposit", async (ctx) => {
    await ctx.answerCbQuery();
    await getOrCreateUser(ctx.from.id, ctx.from.username ? `@${ctx.from.username}` : null);
    await User.updateOne(
      { telegramId: ctx.from.id },
      {
        awaitingPaymentScreenshot: true,
        paymentPromptChatId: ctx.chat.id,
        paymentPromptMessageId: ctx.callbackQuery.message.message_id,
      }
    );
    await ctx
      .editMessageCaption("💳 Now send a screenshot of your payment as a photo.", {
        reply_markup: { inline_keyboard: [] },
      })
      .catch(() => {});
  });

  bot.action(/^approve_payment:(.+)$/, async (ctx) => handleDecision(ctx, "approved"));
  bot.action(/^decline_payment:(.+)$/, async (ctx) => handleDecision(ctx, "declined"));
}

async function sendSubscribePrompt(ctx) {
  if (!fs.existsSync(UPI_IMAGE_PATH)) {
    return editOrReply(
      ctx,
      "Subscription payments aren't set up yet — the UPI QR image is missing from the bot's assets folder. Contact the admin.",
      {}
    );
  }

  // A photo can't be edited in from a text message, so if this came from a menu
  // button, acknowledge on the original message, then send the QR as a new message.
  if (ctx.callbackQuery) {
    await editOrReply(ctx, "💳 Opening subscription details below 👇", {});
  }

  await ctx.replyWithPhoto(
    { source: UPI_IMAGE_PATH },
    {
      caption:
        "💳 *Subscribe — ₹/month*\n\nScan and pay using the UPI details above, then tap the button below and send your payment screenshot.",
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm Deposit", callback_data: "confirm_deposit" }],
          [{ text: "🔙 Back to Menu", callback_data: "menu_back" }],
        ],
      },
    }
  );
}

// Called from index.js when a photo arrives from a user in "awaiting payment screenshot" state.
async function submitPaymentScreenshot(ctx, fileId) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  await User.updateOne({ telegramId: ctx.from.id }, { awaitingPaymentScreenshot: false });

  // Morph the original UPI message one more time to reflect submission, if it's still around.
  if (user && user.paymentPromptChatId && user.paymentPromptMessageId) {
    await ctx.telegram
      .editMessageCaption(
        user.paymentPromptChatId,
        user.paymentPromptMessageId,
        undefined,
        "📤 Screenshot submitted — pending review."
      )
      .catch(() => {});
  }

  const financeAdmin = await getFinanceAdmin();
  if (!financeAdmin || !financeAdmin.telegramId) {
    return ctx.reply(
      "⚠️ No finance admin is currently configured to review payments. Please contact support directly."
    );
  }

  const username = ctx.from.username ? `@${ctx.from.username}` : null;
  const payment = await Payment.create({
    telegramId: ctx.from.id,
    username,
    screenshotFileId: fileId,
    status: "pending",
    financeAdminId: financeAdmin.telegramId,
  });

  const caption = `💰 *New payment submission*\n\nUser: ${username || "no username"} (ID: ${ctx.from.id})\nPayment ID: ${payment._id}`;

  const sent = await ctx.telegram.sendPhoto(financeAdmin.telegramId, fileId, {
    caption,
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `approve_payment:${payment._id}` },
          { text: "❌ Decline", callback_data: `decline_payment:${payment._id}` },
        ],
      ],
    },
  });

  payment.financeAdminMessageId = sent.message_id;
  await payment.save();

  await ctx.reply("✅ Payment screenshot sent for review. You'll be notified once it's approved or declined.");
}

async function handleDecision(ctx, decision) {
  const paymentId = ctx.match[1];
  const payment = await Payment.findById(paymentId);

  if (!payment) {
    return ctx.answerCbQuery("Payment record not found.", { show_alert: true });
  }
  if (payment.status !== "pending") {
    return ctx.answerCbQuery(`Already ${payment.status}.`, { show_alert: true });
  }

  payment.status = decision;
  await payment.save();

  const statusLabel = decision === "approved" ? "✅ Approved" : "❌ Declined";
  await ctx
    .editMessageCaption(`${ctx.update.callback_query.message.caption}\n\n${statusLabel}`, {
      parse_mode: "Markdown",
    })
    .catch(() => {});
  await ctx.answerCbQuery(statusLabel);

  if (decision === "approved") {
    const user = await activateSubscription(payment.telegramId, payment.username);
    await ctx.telegram.sendMessage(
      payment.telegramId,
      `🎉 Payment approved! Your subscription is active until *${user.subscriptionExpiresAt.toDateString()}*.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await ctx.telegram.sendMessage(
      payment.telegramId,
      "❌ Your payment was declined. Please check that the screenshot clearly shows a valid, successful transaction and the correct amount, then try /subscribe again. Contact support if you believe this is a mistake."
    );
  }
}

module.exports = { registerSubscriptionHandlers, sendSubscribePrompt, submitPaymentScreenshot };
