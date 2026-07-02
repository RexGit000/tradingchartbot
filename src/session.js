// Determines current trading session based on UTC hour. No API needed.
function getCurrentSession() {
  const utcHour = new Date().getUTCHours();

  const inRange = (start, end, hour) => {
    if (start < end) return hour >= start && hour < end;
    return hour >= start || hour < end; // wraps past midnight
  };

  const sydney = inRange(22, 7, utcHour);
  const tokyo = inRange(0, 9, utcHour);
  const london = inRange(8, 17, utcHour);
  const newYork = inRange(13, 22, utcHour);
  const overlap = inRange(13, 17, utcHour); // London + NY overlap

  if (overlap) {
    return {
      name: "London + New York Overlap 🟣",
      note: "Highest liquidity period. Expect large moves, stop hunts, strong breakouts."
    };
  }
  if (newYork) {
    return { name: "New York Session 🔴", note: "Highest liquidity, strong trends." };
  }
  if (london) {
    return { name: "London Session 🟢", note: "High volatility, major breakouts." };
  }
  if (tokyo) {
    return { name: "Tokyo Session 🟡", note: "Asian liquidity, watch for fake breakouts." };
  }
  if (sydney) {
    return { name: "Sydney Session 🔵", note: "Low volatility, range bound." };
  }
  return { name: "Unknown", note: "" };
}

module.exports = { getCurrentSession };
