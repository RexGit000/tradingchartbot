// Shared UI helpers used across menu/admin/subscribe handlers.

function mainMenuKeyboard(isAdminUser = false) {
  const rows = [
    [{ text: "❓ Help", callback_data: "menu_help" }],
    [{ text: "🖼 Samples", callback_data: "menu_samples" }],
  ];
  if (!isAdminUser) {
    rows.push([{ text: "💳 Subscribe", callback_data: "menu_subscribe" }]);
  }
  rows.push([{ text: "🛠 Admin Panel", callback_data: "menu_admin" }]);
  return { inline_keyboard: rows };
}

function backButton(callback_data = "menu_back") {
  return { inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data }]] };
}

// Edits the message the button lives on when possible, so the chat stays clean
// instead of filling up with a new message per tap. Falls back to a fresh reply
// when there's no callback to edit (a typed /command) or the edit itself fails
// (e.g. the source message is a photo and can't become plain text).
async function editOrReply(ctx, text, extra = {}) {
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (err) {
      return ctx.reply(text, extra);
    }
  }
  return ctx.reply(text, extra);
}

// For nudges/errors that only matter for a few seconds — sends then self-deletes.
async function sendEphemeral(ctx, text, seconds = 8, extra = {}) {
  const msg = await ctx.reply(text, extra);
  setTimeout(() => {
    ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
  }, seconds * 1000);
  return msg;
}

module.exports = { mainMenuKeyboard, backButton, editOrReply, sendEphemeral };
