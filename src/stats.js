const User = require("./models/User");
const Admin = require("./models/Admin");
const Payment = require("./models/Payment");

async function getAdminStats() {
  const now = new Date();
  const [totalUsers, activeSubs, pendingPayments, totalAdmins] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ subscriptionExpiresAt: { $gt: now } }),
    Payment.countDocuments({ status: "pending" }),
    Admin.countDocuments({}),
  ]);
  return { totalUsers, activeSubs, pendingPayments, totalAdmins };
}

module.exports = { getAdminStats };
