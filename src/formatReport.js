function formatReport(r) {
  return `📊 *PAIR:* ${r.pair}
🕐 *Session:* ${r.session}
📈 *Market Structure:* ${r.marketStructure}
🌀 *Market Phase:* ${r.marketPhase}
📦 *Volume:* ${r.volumeAnalysis}
🧮 *Indicator Score:* ${r.indicatorScore}
🎯 *Confidence:* ${r.confidenceScore}

*Trade Decision: ${r.tradeDecision}*

Entry: ${r.entry || "—"}
Stop Loss: ${r.stopLoss || "—"}
TP1: ${r.tp1 || "—"}
TP2: ${r.tp2 || "—"}
TP3: ${r.tp3 || "—"}
Risk/Reward: ${r.riskRewardRatio || "—"}
Position Size: ${r.positionSize || "—"}

*Reason:* ${r.reasonForTrade || "—"}
*Bullish Scenario:* ${r.bullishScenario || "—"}
*Bearish Scenario:* ${r.bearishScenario || "—"}
*Invalidation:* ${r.invalidationLevel || "—"}
*Psychology:* ${r.psychologyInsight || "—"}

🧠 *Final Verdict:*
${r.finalVerdict}`;
}

module.exports = { formatReport };
