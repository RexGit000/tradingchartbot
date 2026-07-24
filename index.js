require("dotenv").config();
const { Telegraf } = require("telegraf");
const OpenAI = require("openai");
const systemPrompt = require("./src/systemPrompt");
const { getCurrentSession } = require("./src/session");
const { formatReport } = require("./src/formatReport");
const { connectDB } = require("./src/db");
const { seedAdmins } = require("./src/seedAdmins");
const { isAdmin } = require("./src/adminAuth");
const { hasActiveSubscription, startReminderJob } = require("./src/subscription");
const { mainMenuKeyboard, sendEphemeral } = require("./src/ui");
const User = require("./src/models/User");
const { registerSubscriptionHandlers, sendSubscribePrompt, submitPaymentScreenshot } = require("./src/handlers/subscribe");
const { registerAdminPanelHandlers } = require("./src/handlers/adminPanel");
const { registerMenuHandlers, mainMenuText, HELP_TEXT, sendSamples } = require("./src/handlers/menu");
const { handlePendingAdminInput } = require("./src/handlers/adminPanel");
const express = require("express");

const app = express();
app.get("/ping", (req, res) => {
  res.send("Hello");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("We are listening on PORT ", port);

  const requiredEnv = ["BOT_TOKEN", "OPENAI_API_KEY", "MONGODB_URI"];
  const missingEnv = requiredEnv.filter((k) => !process.env[k]);

  if (missingEnv.length) {
    console.error(`Missing required env var(s): ${missingEnv.join(", ")}.`);
    console.error("Bot initialization skipped. /ping server is still running.");
    return;
  }

  console.log("Starting bot...");
  console.log("Environment variables loaded OK.");

  const bot = new Telegraf(process.env.BOT_TOKEN);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const MODEL = "gpt-5.4-mini";

// ---------- Per-chat sequential queue ----------
// Ensures multiple images sent in a row are analyzed one at a time, in the order received,
// instead of firing concurrently and replying out of order.
const chatQueues = new Map();

function enqueue(chatId, taskFn) {
  const prev = chatQueues.get(chatId) || Promise.resolve();
  const next = prev
    .catch(() => {}) // don't let a previous failure block the queue
    .then(() => taskFn())
    .catch((err) => console.error("Queued task failed:", err));
  chatQueues.set(chatId, next);
  return next;
}

registerSubscriptionHandlers(bot);
registerAdminPanelHandlers(bot);
registerMenuHandlers(bot);

// /start is exempt from the inline-button pattern per spec — it's the entry point
// that hands out the buttons for everything else. Admins additionally see quick stats.
bot.start(async (ctx) => {
  const admin = await isAdmin(ctx);
  const text = await mainMenuText(ctx);
  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard(admin) });
});

bot.command("help", (ctx) => ctx.reply(HELP_TEXT));
bot.command("samples", (ctx) => sendSamples(ctx));

// ---------- Core analysis logic (shared by photo + document handlers) ----------
async function analyzeChart(ctx, fileLink) {
  const replyTarget = { reply_parameters: { message_id: ctx.message.message_id } };
  let statusMsg;
  try {
    statusMsg = await ctx.reply("📥 Chart received. Processing...", replyTarget);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "🔎 Reading chart structure..."
    );

    const session = getCurrentSession();

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "🧠 Running full analysis (this can take a few seconds)..."
    );

    const response = await openai.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Current Trading Session: ${session.name}. ${session.note}\n\nAnalyze this chart and return the JSON report.`,
            },
            {
              type: "image_url",
              image_url: { url: fileLink.href },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0].message.content;

    let report;
    try {
      report = JSON.parse(raw);
    } catch (parseErr) {
      console.error("Failed to parse GPT JSON response:", raw);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        "❌ Got an unreadable response from the analyst. Please try sending the chart again."
      );
      return;
    }

    if (!report.isChart) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⚠️ ${report.rejectionReason || "That doesn't look like a chart screenshot. Please send a valid chart — use /samples to see examples."}`
      );
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "✅ Analysis ready"
    );

    await ctx.replyWithMarkdown(formatReport(report), replyTarget);
  } catch (err) {
    console.error("Error processing chart:", err);
    const errorText = "❌ Something went wrong while analyzing that chart. Please try again.";
    if (statusMsg) {
      await ctx.telegram
        .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorText)
        .catch(() => {});
    } else {
      await ctx.reply(errorText, replyTarget);
    }
  }
}

// ---------- Access control ----------
// Decides what an incoming image should do: admin -> free analysis, awaiting payment -> submit
// for review, subscribed -> analysis, otherwise -> blocked with a subscribe prompt.
async function routeIncomingImage(ctx, fileId, fileLink) {
  if (await isAdmin(ctx)) {
    return enqueue(ctx.chat.id, () => analyzeChart(ctx, fileLink));
  }

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (user && user.awaitingPaymentScreenshot) {
    return submitPaymentScreenshot(ctx, fileId);
  }

  if (await hasActiveSubscription(ctx.from.id)) {
    return enqueue(ctx.chat.id, () => analyzeChart(ctx, fileLink));
  }

  await ctx.reply("🔒 You need an active subscription to use this bot.", {
    reply_markup: { inline_keyboard: [[{ text: "💳 Subscribe", callback_data: "menu_subscribe" }]] },
  });
}

// ---------- Input handlers ----------
bot.on("photo", async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id; // highest resolution
  const fileLink = await ctx.telegram.getFileLink(fileId);
  await routeIncomingImage(ctx, fileId, fileLink);
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const mimeType = doc.mime_type || "";

  if (!mimeType.startsWith("image/")) {
    return sendEphemeral(ctx, "That file isn't an image. Please send your chart as a photo or image file.");
  }

  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
  await routeIncomingImage(ctx, doc.file_id, fileLink);
});

bot.on("text", async (ctx) => {
  const consumed = await handlePendingAdminInput(ctx);
  if (consumed) return;
  await sendEphemeral(ctx, "Send me a chart screenshot to get your trade analysis. Use /samples if you're not sure what to send.");
});

async function startBot() {
  try {
    await connectDB();
    await seedAdmins();

    console.log("Verifying bot token with Telegram...");
    const me = await bot.telegram.getMe();
    console.log(`Token OK. Logged in as @${me.username}`);

    await bot.telegram.setMyCommands([
      { command: "start", description: "Main menu" },
      { command: "help", description: "How to use the bot" },
      { command: "samples", description: "See example chart screenshots to send" },
      { command: "subscribe", description: "Subscribe to use the bot" },
      { command: "admin", description: "Admin panel (admins only)" },
    ]);
    console.log("Menu commands set.");

    startReminderJob(bot);

    await bot.launch();
    console.log(`Bot launched. Listening for messages as @${me.username}`);
  } catch (err) {
    console.error("Failed to start bot:", err.message || err);
    console.error("Check: 1) BOT_TOKEN is correct, 2) MONGODB_URI is reachable, 3) internet access to api.telegram.org.");
  }
}

startBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
});
