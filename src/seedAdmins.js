const Admin = require("./models/Admin");

const SEED_ADMINS = [
  { telegramId: 1632962204, username: "@endurenow", isSuperAdmin: true },
  { telegramId: 8486646787, username: null, isSuperAdmin: false },
  { telegramId: 7433937250, username: null, isSuperAdmin: false },
  { telegramId: null, username: "@Cristina0069", isSuperAdmin: false },
  { telegramId: 8394641070, username: null, isSuperAdmin: false },
];

async function seedAdmins() {
  const count = await Admin.countDocuments();
  if (count > 0) {
    console.log("Admins already seeded, skipping.");
    return;
  }
  await Admin.insertMany(SEED_ADMINS);
  console.log(`Seeded ${SEED_ADMINS.length} admins.`);
}

module.exports = { seedAdmins };
