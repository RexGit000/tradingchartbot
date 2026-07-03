const cron = require("node-cron");
const User = require("./models/User");

const SUB_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getOrCreateUser(telegramId, username) {
  return User.findOneAndUpdate(
    { telegramId },
    { $setOnInsert: { telegramId, username: username || null } },
    { upsert: true, new: true }
  );
}

async function hasActiveSubscription(telegramId) {
  const user = await User.findOne({ telegramId });
  return !!(user && user.subscriptionExpiresAt && user.subscriptionExpiresAt > new Date());
}

// Activates a fresh subscription, or extends by 30 days if still active
// (renewal before expiry stacks on top instead of resetting the clock).
async function activateSubscription(telegramId, username) {
  const user = await getOrCreateUser(telegramId, username);
  const now = new Date();
  const base =
    user.subscriptionExpiresAt && user.subscriptionExpiresAt > now ? user.subscriptionExpiresAt : now;

  user.subscriptionExpiresAt = new Date(base.getTime() + SUB_DAYS * DAY_MS);
  user.reminded2Day = false;
  user.reminded1Day = false;
  user.remindedExpired = false;
  await user.save();
  return user;
}

async function safeNotify(bot, telegramId, text, extra) {
  try {
    await bot.telegram.sendMessage(telegramId, text, extra);
  } catch (err) {
    console.error(`Failed to notify user ${telegramId}:`, err.message);
  }
}

// Runs hourly: sends 2-day / 1-day / expired notices exactly once each per cycle.
function startReminderJob(bot) {
  cron.schedule("0 * * * *", async () => {
    const now = new Date();
    const in2Days = new Date(now.getTime() + 2 * DAY_MS);
    const in1Day = new Date(now.getTime() + 1 * DAY_MS);

    const twoDayUsers = await User.find({
      subscriptionExpiresAt: { $gt: now, $lte: in2Days },
      reminded2Day: false,
    });
    for (const user of twoDayUsers) {
      await safeNotify(
        bot,
        user.telegramId,
        "⏳ Your subscription expires in 2 days. Use /subscribe to renew and avoid interruption."
      );
      user.reminded2Day = true;
      await user.save();
    }

    const oneDayUsers = await User.find({
      subscriptionExpiresAt: { $gt: now, $lte: in1Day },
      reminded1Day: false,
    });
    for (const user of oneDayUsers) {
      await safeNotify(
        bot,
        user.telegramId,
        "⏳ Your subscription expires in 1 day. Use /subscribe to renew and avoid interruption."
      );
      user.reminded1Day = true;
      await user.save();
    }

    const expiredUsers = await User.find({
      subscriptionExpiresAt: { $lte: now, $ne: null },
      remindedExpired: false,
    });
    for (const user of expiredUsers) {
      await safeNotify(
        bot,
        user.telegramId,
        "❌ Your subscription has expired. Use /subscribe to renew and continue using the bot."
      );
      user.remindedExpired = true;
      await user.save();
    }
  });

  console.log("Subscription reminder job scheduled (hourly).");
}

module.exports = { getOrCreateUser, hasActiveSubscription, activateSubscription, startReminderJob };
