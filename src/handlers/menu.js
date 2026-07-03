const fs = require("fs");
const path = require("path");
const { isAdmin } = require("../adminAuth");
const { mainMenuKeyboard, backButton, editOrReply } = require("../ui");
const { sendSubscribePrompt } = require("./subscribe");
const { renderAdminMenu } = require("./adminPanel");
const { getAdminStats } = require("../stats");

const ASSETS_DIR = path.join(__dirname, "..", "..", "assets");
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const HELP_TEXT =
  "1. Screenshot your chart (TradingView, Binance, Bybit, etc)\n2. Send it here as a photo\n3. Wait a few seconds for the full analysis\n\nUse /samples to see example screenshots.\nUse /subscribe if you're not subscribed yet.";

async function mainMenuText(ctx) {
  let text =
    "Send me a chart screenshot and I'll give you a full trade analysis — market structure, entry, stop loss, take profit, and a clear buy/sell/wait call.";

  if (await isAdmin(ctx)) {
    const stats = await getAdminStats();
    text += `\n\n📊 *Quick stats*\nUsers: ${stats.totalUsers}\nActive subs: ${stats.activeSubs}\nPending payments: ${stats.pendingPayments}\nAdmins: ${stats.totalAdmins}`;
  }
  return text;
}

async function sendSamples(ctx) {
  if (!fs.existsSync(ASSETS_DIR)) {
    return editOrReply(ctx, "No sample screenshots have been added yet.", { reply_markup: backButton() });
  }
  const files = fs
    .readdirSync(ASSETS_DIR)
    .filter((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .slice(0, 5);

  if (files.length === 0) {
    return editOrReply(ctx, "No sample screenshots have been added yet.", { reply_markup: backButton() });
  }

  // Photos can't be edited in from a text message — legitimate case to send new messages.
  await editOrReply(
    ctx,
    `Here ${files.length === 1 ? "is an example" : "are examples"} of the kind of screenshot to send:`,
    {}
  );
  for (const file of files) {
    await ctx.replyWithPhoto({ source: path.join(ASSETS_DIR, file) });
  }
  await ctx.reply("🔙 Back to menu", { reply_markup: backButton() });
}

function registerMenuHandlers(bot) {
  bot.action("menu_back", async (ctx) => {
    await ctx.answerCbQuery();
    const admin = await isAdmin(ctx);
    const text = await mainMenuText(ctx);
    await editOrReply(ctx, text, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard(admin) });
  });

  bot.action("menu_help", async (ctx) => {
    await ctx.answerCbQuery();
    await editOrReply(ctx, HELP_TEXT, { reply_markup: backButton() });
  });

  bot.action("menu_samples", async (ctx) => {
    await ctx.answerCbQuery();
    await sendSamples(ctx);
  });

  bot.action("menu_subscribe", async (ctx) => {
    await ctx.answerCbQuery();
    await sendSubscribePrompt(ctx);
  });

  bot.action("menu_admin", async (ctx) => {
    if (!(await isAdmin(ctx))) {
      return ctx.answerCbQuery("You're not an admin.", { show_alert: true });
    }
    await ctx.answerCbQuery();
    await renderAdminMenu(ctx);
  });
}

module.exports = { registerMenuHandlers, mainMenuText, HELP_TEXT, sendSamples };
