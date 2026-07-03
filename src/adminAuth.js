const Admin = require("./models/Admin");

// Looks up the sender against the admin list, checking telegramId first, then username.
// If a username-only seed record (telegramId was null) matches, backfills the id
// now that we've seen it, so future lookups are id-based.
async function getAdmin(ctx) {
  const id = ctx.from.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : null;

  let admin = await Admin.findOne({ telegramId: id });
  if (admin) return admin;

  if (username) {
    admin = await Admin.findOne({ username });
    if (admin) {
      if (!admin.telegramId) {
        admin.telegramId = id;
        await admin.save();
      }
      return admin;
    }
  }
  return null;
}

async function isAdmin(ctx) {
  return !!(await getAdmin(ctx));
}

async function isSuperAdmin(ctx) {
  const admin = await getAdmin(ctx);
  return !!admin && admin.isSuperAdmin;
}

async function getFinanceAdmin() {
  return Admin.findOne({ isFinanceAdmin: true });
}

module.exports = { getAdmin, isAdmin, isSuperAdmin, getFinanceAdmin };
