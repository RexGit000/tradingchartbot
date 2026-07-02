require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Telegraf } = require("telegraf");
const OpenAI = require("openai");
const systemPrompt = require("./src/systemPrompt");
const { getCurrentSession } = require("./src/session");
const { formatReport } = require("./src/formatReport");
const express = require("express");

const app = express();

app.get("/ping", (req, res) => {
  res.send("Hello world");
});

console.log("Starting bot...");

if (!process.env.BOT_TOKEN) {
  console.error(
    "BOT_TOKEN is missing. Check that your .env file exists in this folder and has BOT_TOKEN set.",
  );
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error(
    "OPENAI_API_KEY is missing. Check that your .env file exists in this folder and has OPENAI_API_KEY set.",
  );
  process.exit(1);
}
console.log("Environment variables loaded OK.");

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = "gpt-5.4-mini";
const ASSETS_DIR = path.join(__dirname, "assets");
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

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

bot.start((ctx) => {
  ctx.reply(
    "Send me a chart screenshot and I'll give you a full trade analysis — market structure, entry, stop loss, take profit, and a clear buy/sell/wait call.\n\nNot sure what kind of screenshot to send? Use /samples.",
  );
});

bot.command("help", (ctx) => {
  ctx.reply(
    "1. Screenshot your chart (TradingView, Binance, Bybit, etc)\n2. Send it here as a photo\n3. Wait a few seconds for the full analysis\n\nUse /samples to see example screenshots.",
  );
});

bot.command("samples", async (ctx) => {
  if (!fs.existsSync(ASSETS_DIR)) {
    return ctx.reply("No sample screenshots have been added yet.");
  }
  const files = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .slice(0, 5);

  if (files.length === 0) {
    return ctx.reply("No sample screenshots have been added yet.");
  }

  await ctx.reply(
    `Here ${files.length === 1 ? "is an example" : "are examples"} of the kind of screenshot to send:`,
  );
  for (const file of files) {
    await ctx.replyWithPhoto({ source: path.join(ASSETS_DIR, file) });
  }
});

// ---------- Core analysis logic (shared by photo + document handlers) ----------
async function analyzeChart(ctx, fileLink) {
  const replyTarget = {
    reply_parameters: { message_id: ctx.message.message_id },
  };
  let statusMsg;
  try {
    statusMsg = await ctx.reply(
      "📥 Chart received. Processing...",
      replyTarget,
    );

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "🔎 Reading chart structure...",
    );

    const session = getCurrentSession();

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "🧠 Running full analysis (this can take a few seconds)...",
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
        "❌ Got an unreadable response from the analyst. Please try sending the chart again.",
      );
      return;
    }

    if (!report.isChart) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⚠️ ${report.rejectionReason || "That doesn't look like a chart screenshot. Please send a valid chart — use /samples to see examples."}`,
      );
      return;
    }

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      undefined,
      "✅ Analysis ready",
    );

    await ctx.replyWithMarkdown(formatReport(report), replyTarget);
  } catch (err) {
    console.error("Error processing chart:", err);
    const errorText =
      "❌ Something went wrong while analyzing that chart. Please try again.";
    if (statusMsg) {
      await ctx.telegram
        .editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          errorText,
        )
        .catch(() => {});
    } else {
      await ctx.reply(errorText, replyTarget);
    }
  }
}

// ---------- Input handlers ----------
bot.on("photo", async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id; // highest resolution
  const fileLink = await ctx.telegram.getFileLink(fileId);
  enqueue(ctx.chat.id, () => analyzeChart(ctx, fileLink));
});

bot.on("document", async (ctx) => {
  const doc = ctx.message.document;
  const mimeType = doc.mime_type || "";

  if (!mimeType.startsWith("image/")) {
    return ctx.reply(
      "That file isn't an image. Please send your chart as a photo or image file.",
    );
  }

  const fileLink = await ctx.telegram.getFileLink(doc.file_id);
  enqueue(ctx.chat.id, () => analyzeChart(ctx, fileLink));
});

bot.on("text", (ctx) => {
  ctx.reply(
    "Send me a chart screenshot to get your trade analysis. Use /samples if you're not sure what to send.",
  );
});

async function startBot() {
  try {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log("App is listening on port..:", port);
    });
    console.log("Verifying bot token with Telegram...");
    const me = await bot.telegram.getMe();
    console.log(`Token OK. Logged in as @${me.username}`);

    await bot.telegram.setMyCommands([
      { command: "start", description: "How this bot works" },
      { command: "help", description: "How to use the bot" },
      {
        command: "samples",
        description: "See example chart screenshots to send",
      },
    ]);
    console.log("Menu commands set.");

    await bot.launch();
    console.log(`Bot launched. Listening for messages as @${me.username}`);
  } catch (err) {
    console.error("Failed to start bot:", err.message || err);
    console.error(
      "Check: 1) BOT_TOKEN is correct, 2) you have internet access to api.telegram.org, 3) no firewall/VPN is blocking it.",
    );
    process.exit(1);
  }
}

startBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
