const Admin = require("../models/Admin");
const { getAdmin, isAdmin, isSuperAdmin } = require("../adminAuth");
const { editOrReply } = require("../ui");

// telegramId -> { step, chatId, messageId } — tracks the "waiting for a text reply"
// step of the CRUD flow, and which message to morph into a confirmation once it arrives.
const pendingInput = new Map();

function adminBackButton() {
  return { inline_keyboard: [[{ text: "🔙 Back to Admin Panel", callback_data: "admin_menu" }]] };
}

function backRow() {
  return [{ text: "🔙 Back to Admin Panel", callback_data: "admin_menu" }];
}

async function renderAdminMenu(ctx) {
  const admin = await getAdmin(ctx);
  if (!admin) return editOrReply(ctx, "You're not an admin.", {});

  const buttons = [[{ text: "📋 List Admins", callback_data: "admin_list" }]];
  if (admin.isSuperAdmin) {
    buttons.push(
      [{ text: "➕ Add Admin", callback_data: "admin_add" }],
      [{ text: "➖ Remove Admin", callback_data: "admin_remove" }],
      [{ text: "💰 Set Finance Admin", callback_data: "admin_set_finance" }],
      [{ text: "👑 Transfer Superadmin", callback_data: "admin_transfer_super" }]
    );
  }
  buttons.push([{ text: "🔙 Back to Menu", callback_data: "menu_back" }]);

  const roleLabel = admin.isSuperAdmin ? "Superadmin" : admin.isFinanceAdmin ? "Finance Admin" : "Admin";
  await editOrReply(
    ctx,
    `🛠 *Admin panel* — ${roleLabel}\nYou get free chart analysis, no subscription needed.`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
  );
}

function registerAdminPanelHandlers(bot) {
  bot.command("admin", async (ctx) => {
    if (!(await isAdmin(ctx))) return ctx.reply("You're not an admin.");
    await renderAdminMenu(ctx);
  });

  bot.action("admin_menu", async (ctx) => {
    await ctx.answerCbQuery();
    await renderAdminMenu(ctx);
  });

  bot.action("admin_list", async (ctx) => {
    await ctx.answerCbQuery();
    const admins = await Admin.find({});
    const lines = admins.map(
      (a) =>
        `${a.isSuperAdmin ? "👑" : a.isFinanceAdmin ? "💰" : "🔧"} ${a.username || "(no username)"} — ${a.telegramId || "(id unknown)"}`
    );
    await editOrReply(ctx, lines.join("\n") || "No admins found.", { reply_markup: adminBackButton() });
  });

  bot.action("admin_add", async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const msg = await editOrReply(ctx, "Send the Telegram ID or @username of the new admin.", {
      reply_markup: adminBackButton(),
    });
    pendingInput.set(ctx.from.id, {
      step: "add_admin",
      chatId: ctx.chat.id,
      messageId: msg.message_id,
    });
  });

  bot.action("admin_remove", async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const admins = await Admin.find({});
    await editOrReply(ctx, "Select an admin to remove:", {
      reply_markup: { inline_keyboard: [...adminButtonRows(admins, "admin_remove_confirm"), backRow()] },
    });
  });

  bot.action(/^admin_remove_confirm:(.+)$/, async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const target = await Admin.findById(ctx.match[1]);
    if (!target) return ctx.answerCbQuery("Not found.", { show_alert: true });
    await Admin.deleteOne({ _id: target._id });
    await ctx.answerCbQuery("Removed.");
    await editOrReply(ctx, `Removed admin: ${target.username || target.telegramId}`, {
      reply_markup: adminBackButton(),
    });
  });

  bot.action("admin_set_finance", async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const admins = await Admin.find({});
    await editOrReply(ctx, "Select the finance admin (receives payment approvals):", {
      reply_markup: { inline_keyboard: [...adminButtonRows(admins, "admin_finance_confirm"), backRow()] },
    });
  });

  bot.action(/^admin_finance_confirm:(.+)$/, async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const target = await Admin.findById(ctx.match[1]);
    if (!target) return ctx.answerCbQuery("Not found.", { show_alert: true });
    await Admin.updateMany({}, { isFinanceAdmin: false });
    target.isFinanceAdmin = true;
    await target.save();
    await ctx.answerCbQuery("Finance admin set.");
    await editOrReply(ctx, `💰 Finance admin is now: ${target.username || target.telegramId}`, {
      reply_markup: adminBackButton(),
    });
  });

  bot.action("admin_transfer_super", async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const admins = await Admin.find({ telegramId: { $ne: ctx.from.id } });
    await editOrReply(ctx, "Select the new superadmin:", {
      reply_markup: { inline_keyboard: [...adminButtonRows(admins, "admin_transfer_confirm"), backRow()] },
    });
  });

  bot.action(/^admin_transfer_confirm:(.+)$/, async (ctx) => {
    if (!(await requireSuperAdmin(ctx))) return;
    const currentSuper = await getAdmin(ctx);
    const target = await Admin.findById(ctx.match[1]);
    if (!target) return ctx.answerCbQuery("Not found.", { show_alert: true });

    currentSuper.isSuperAdmin = false;
    target.isSuperAdmin = true;
    await currentSuper.save();
    await target.save();

    await ctx.answerCbQuery("Superadmin transferred.");
    await editOrReply(ctx, `👑 Superadmin transferred to: ${target.username || target.telegramId}`, {
      reply_markup: adminBackButton(),
    });
    await ctx.telegram
      .sendMessage(target.telegramId, "👑 You are now the superadmin of this bot.")
      .catch(() => {});
  });
}

// Handles the free-text reply after "admin_add" was pressed. Returns true if it consumed the message.
async function handlePendingAdminInput(ctx) {
  const pending = pendingInput.get(ctx.from.id);
  if (!pending) return false;
  pendingInput.delete(ctx.from.id);

  if (pending.step === "add_admin") {
    const input = ctx.message.text.trim();
    const isNumeric = /^\d+$/.test(input);
    const doc = isNumeric
      ? { telegramId: Number(input), username: null, isSuperAdmin: false }
      : { telegramId: null, username: input.startsWith("@") ? input : `@${input}`, isSuperAdmin: false };

    await Admin.create(doc);

    await ctx.telegram
      .editMessageText(
        pending.chatId,
        pending.messageId,
        undefined,
        `Added admin: ${doc.username || doc.telegramId}`,
        { reply_markup: adminBackButton() }
      )
      .catch(() => {});
  }
  return true;
}

async function requireSuperAdmin(ctx) {
  if (await isSuperAdmin(ctx)) return true;
  await ctx.answerCbQuery("Superadmin only.", { show_alert: true });
  return false;
}

function adminButtonRows(admins, actionPrefix) {
  return admins.map((a) => [
    { text: a.username || String(a.telegramId), callback_data: `${actionPrefix}:${a._id}` },
  ]);
}

module.exports = { registerAdminPanelHandlers, handlePendingAdminInput, renderAdminMenu };
